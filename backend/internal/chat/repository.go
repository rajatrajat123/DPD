package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/auradating/platform/backend/internal/discovery"
	"github.com/auradating/platform/backend/internal/events"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	GetOrCreateConversationForMatch(ctx context.Context, matchID string) (*Conversation, error)
	GetConversation(ctx context.Context, conversationID string) (*Conversation, error)
	ListConversationsForUser(ctx context.Context, userID string) ([]*Conversation, error)
	SaveMessage(ctx context.Context, msg *Message) (*Message, bool, error)
	ListMessages(ctx context.Context, conversationID string, beforeID string, limit int) ([]*Message, string, bool, error)
	MarkMessagesRead(ctx context.Context, conversationID, readerUserID string) (int, error)
	MarkMessageDelivered(ctx context.Context, messageID string) error
	VerifyConversationMembership(ctx context.Context, conversationID, userID string) (bool, error)
	CheckActiveMatchEligibility(ctx context.Context, conversationID, userID string) (bool, error)
	RegisterPushToken(ctx context.Context, userID, token, platform, deviceID string) error
	LogNotification(ctx context.Context, userID, notifType, channel, title, bodyPreview, status, errReason string) error
	CreateMessageRequest(ctx context.Context, senderID, recipientID, body string) (*MessageRequest, error)
	ListMessageRequests(ctx context.Context, recipientID string) ([]*MessageRequest, error)
	GetMessageRequest(ctx context.Context, requestID string) (*MessageRequest, error)
	AcceptMessageRequest(ctx context.Context, requestID, recipientID string) (conversationID, matchID string, err error)
	DeclineMessageRequest(ctx context.Context, requestID, recipientID string) error
	BlockMessageRequest(ctx context.Context, requestID, recipientID string) error
	CanAccessMediaAsset(ctx context.Context, assetID, userID string) (bool, error)
}

// -----------------------------------------------------------------------------
// PostgresRepository
// -----------------------------------------------------------------------------

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) GetOrCreateConversationForMatch(ctx context.Context, matchID string) (*Conversation, error) {
	// First query match to verify it exists and get participants
	var (
		c                 Conversation
		lowID, highID     string
		status            string
	)
	matchQuery := `SELECT id, user_low_id, user_high_id, status FROM matches WHERE id = $1`
	err := r.pool.QueryRow(ctx, matchQuery, matchID).Scan(&c.MatchID, &lowID, &highID, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, discovery.ErrMatchNotFound
		}
		return nil, fmt.Errorf("failed to query match: %w", err)
	}

	if status != "ACTIVE" {
		return nil, ErrMatchInactive
	}

	c.ParticipantLowID = lowID
	c.ParticipantHighID = highID

	// Upsert conversation row
	upsertQuery := `
		INSERT INTO conversations (match_id, created_at)
		VALUES ($1, NOW())
		ON CONFLICT (match_id) DO UPDATE SET match_id = EXCLUDED.match_id
		RETURNING id, last_message_at, created_at
	`
	err = r.pool.QueryRow(ctx, upsertQuery, matchID).Scan(&c.ID, &c.LastMessageAt, &c.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert conversation: %w", err)
	}

	return &c, nil
}

func (r *PostgresRepository) GetConversation(ctx context.Context, conversationID string) (*Conversation, error) {
	query := `
		SELECT c.id, c.match_id, m.user_low_id, m.user_high_id, m.status, c.last_message_at, c.created_at
		FROM conversations c
		JOIN matches m ON m.id = c.match_id
		WHERE c.id = $1 OR c.match_id = $1
	`
	var (
		conv        Conversation
		matchStatus string
	)
	err := r.pool.QueryRow(ctx, query, conversationID).Scan(
		&conv.ID,
		&conv.MatchID,
		&conv.ParticipantLowID,
		&conv.ParticipantHighID,
		&matchStatus,
		&conv.LastMessageAt,
		&conv.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Check if conversationID is a match_id and create/fetch conversation row
			createdConv, createErr := r.GetOrCreateConversationForMatch(ctx, conversationID)
			if createErr == nil && createdConv != nil {
				return createdConv, nil
			}
			return nil, ErrConversationNotFound
		}
		return nil, fmt.Errorf("failed to get conversation: %w", err)
	}

	if matchStatus != "ACTIVE" {
		return nil, ErrMatchInactive
	}

	return &conv, nil
}

func (r *PostgresRepository) ListConversationsForUser(ctx context.Context, userID string) ([]*Conversation, error) {
	// Find all active matches for user, ensuring conversation exists
	query := `
		SELECT c.id, c.match_id, m.user_low_id, m.user_high_id, c.last_message_at, c.created_at,
		       COALESCE(
		           (SELECT COUNT(*) FROM messages msg 
		            WHERE msg.conversation_id = c.id 
		              AND msg.sender_user_id != $1 
		              AND msg.read_at IS NULL 
		              AND msg.deleted_at IS NULL), 0
		       ) as unread_count,
		       (SELECT json_build_object(
		           'id', lm.id,
		           'sender_user_id', lm.sender_user_id,
		           'body', lm.body,
		           'message_type', lm.message_type,
		           'created_at', lm.created_at,
		           'is_read', lm.read_at IS NOT NULL
		       ) FROM messages lm WHERE lm.conversation_id = c.id AND lm.deleted_at IS NULL ORDER BY lm.created_at DESC LIMIT 1) as last_msg
		FROM matches m
		LEFT JOIN conversations c ON c.match_id = m.id
		WHERE (m.user_low_id = $1 OR m.user_high_id = $1)
		  AND m.status = 'ACTIVE'
		  AND NOT EXISTS (
		      SELECT 1 FROM user_blocks b 
		      WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = CASE WHEN m.user_low_id = $1 THEN m.user_high_id ELSE m.user_low_id END)
		         OR (b.blocker_user_id = CASE WHEN m.user_low_id = $1 THEN m.user_high_id ELSE m.user_low_id END AND b.blocked_user_id = $1)
		  )
		ORDER BY COALESCE(c.last_message_at, m.matched_at) DESC
	`

	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to list conversations: %w", err)
	}
	defer rows.Close()

	var convs []*Conversation
	for rows.Next() {
		var (
			c           Conversation
			lastMsgJSON []byte
		)
		var convID *string
		var lastMsgAt *time.Time
		var createdAt *time.Time

		err := rows.Scan(
			&convID,
			&c.MatchID,
			&c.ParticipantLowID,
			&c.ParticipantHighID,
			&lastMsgAt,
			&createdAt,
			&c.UnreadCount,
			&lastMsgJSON,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan conversation: %w", err)
		}

		if convID != nil {
			c.ID = *convID
			c.LastMessageAt = lastMsgAt
			if createdAt != nil {
				c.CreatedAt = *createdAt
			}
		} else {
			// Ensure conversation row exists in DB
			createdConv, cErr := r.GetOrCreateConversationForMatch(ctx, c.MatchID)
			if cErr == nil && createdConv != nil {
				c.ID = createdConv.ID
				c.CreatedAt = createdConv.CreatedAt
			}
		}

		if len(lastMsgJSON) > 0 {
			var summary MessageSummary
			if err := json.Unmarshal(lastMsgJSON, &summary); err == nil {
				c.LastMessage = &summary
			}
		}

		convs = append(convs, &c)
	}

	return convs, nil
}

func (r *PostgresRepository) SaveMessage(ctx context.Context, msg *Message) (*Message, bool, error) {
	// Ensure conversation exists and resolve to real conversation_id if match_id was supplied
	if conv, convErr := r.GetConversation(ctx, msg.ConversationID); convErr == nil && conv != nil {
		msg.ConversationID = conv.ID
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 1. Idempotent insert: ON CONFLICT (sender_user_id, client_message_id) DO NOTHING
	insertQuery := `
		INSERT INTO messages (
			conversation_id, sender_user_id, client_message_id, body, message_type, media_asset_id, delivered_at, created_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, NOW(), NOW()
		)
		ON CONFLICT (sender_user_id, client_message_id) DO NOTHING
		RETURNING id, conversation_id, sender_user_id, client_message_id, body, message_type, media_asset_id, delivered_at, read_at, deleted_at, created_at
	`

	var saved Message
	row := tx.QueryRow(ctx, insertQuery,
		msg.ConversationID,
		msg.SenderUserID,
		msg.ClientMessageID,
		msg.Body,
		msg.MessageType,
		msg.MediaAssetID,
	)

	err = row.Scan(
		&saved.ID,
		&saved.ConversationID,
		&saved.SenderUserID,
		&saved.ClientMessageID,
		&saved.Body,
		&saved.MessageType,
		&saved.MediaAssetID,
		&saved.DeliveredAt,
		&saved.ReadAt,
		&saved.DeletedAt,
		&saved.CreatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Duplicate client_message_id: retrieve existing message row
			existingQuery := `
				SELECT id, conversation_id, sender_user_id, client_message_id, body, message_type, media_asset_id, delivered_at, read_at, deleted_at, created_at
				FROM messages
				WHERE sender_user_id = $1 AND client_message_id = $2
			`
			err2 := tx.QueryRow(ctx, existingQuery, msg.SenderUserID, msg.ClientMessageID).Scan(
				&saved.ID,
				&saved.ConversationID,
				&saved.SenderUserID,
				&saved.ClientMessageID,
				&saved.Body,
				&saved.MessageType,
				&saved.MediaAssetID,
				&saved.DeliveredAt,
				&saved.ReadAt,
				&saved.DeletedAt,
				&saved.CreatedAt,
			)
			if err2 != nil {
				return nil, false, fmt.Errorf("failed to fetch duplicate message: %w", err2)
			}
			_ = tx.Commit(ctx)
			return &saved, true, nil
		}
		return nil, false, fmt.Errorf("failed to insert message: %w", err)
	}

	// 2. Update conversation last_message_at
	updateConvQuery := `UPDATE conversations SET last_message_at = $1 WHERE id = $2`
	if _, err := tx.Exec(ctx, updateConvQuery, saved.CreatedAt, saved.ConversationID); err != nil {
		return nil, false, fmt.Errorf("failed to update conversation last_message_at: %w", err)
	}

	// 3. Emit transactional outbox event `messaging.message.sent.v1`
	outboxPayload := map[string]any{
		"message_id":        saved.ID,
		"conversation_id":   saved.ConversationID,
		"sender_user_id":    saved.SenderUserID,
		"client_message_id": saved.ClientMessageID,
		"message_type":      saved.MessageType,
		"created_at":        saved.CreatedAt.Format(time.RFC3339),
	}
	env, err := events.NewEnvelope(
		"conversation",
		saved.ConversationID,
		"messaging.message.sent.v1",
		saved.ClientMessageID,
		1,
		outboxPayload,
	)
	if err != nil {
		return nil, false, fmt.Errorf("failed to construct outbox event: %w", err)
	}

	outboxInsert := `
		INSERT INTO outbox_events (
			id, aggregate_type, aggregate_id, event_type, schema_version, occurred_at, correlation_id, payload
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8
		)
	`
	if _, err := tx.Exec(ctx, outboxInsert,
		env.ID,
		env.AggregateType,
		env.AggregateID,
		env.EventType,
		env.SchemaVersion,
		env.OccurredAt,
		env.CorrelationID,
		env.Payload,
	); err != nil {
		return nil, false, fmt.Errorf("failed to write outbox event: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, false, fmt.Errorf("failed to commit message transaction: %w", err)
	}

	return &saved, false, nil
}

func (r *PostgresRepository) ListMessages(ctx context.Context, conversationID string, beforeID string, limit int) ([]*Message, string, bool, error) {
	// Resolve conversationID if match_id was supplied
	if conv, convErr := r.GetConversation(ctx, conversationID); convErr == nil && conv != nil {
		conversationID = conv.ID
	}

	if limit <= 0 || limit > 100 {
		limit = 50
	}

	var (
		rows pgx.Rows
		err  error
	)

	if beforeID != "" {
		query := `
			SELECT id, conversation_id, sender_user_id, client_message_id, body, message_type, media_asset_id, delivered_at, read_at, deleted_at, created_at
			FROM messages
			WHERE conversation_id = $1
			  AND deleted_at IS NULL
			  AND (
				created_at < (SELECT created_at FROM messages WHERE id = $2)
				OR (created_at = (SELECT created_at FROM messages WHERE id = $2) AND id < $2)
			  )
			ORDER BY created_at DESC, id DESC
			LIMIT $3
		`
		rows, err = r.pool.Query(ctx, query, conversationID, beforeID, limit+1)
	} else {
		query := `
			SELECT id, conversation_id, sender_user_id, client_message_id, body, message_type, media_asset_id, delivered_at, read_at, deleted_at, created_at
			FROM messages
			WHERE conversation_id = $1 AND deleted_at IS NULL
			ORDER BY created_at DESC, id DESC
			LIMIT $2
		`
		rows, err = r.pool.Query(ctx, query, conversationID, limit+1)
	}

	if err != nil {
		return nil, "", false, fmt.Errorf("failed to query messages: %w", err)
	}
	defer rows.Close()

	var msgs []*Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(
			&m.ID,
			&m.ConversationID,
			&m.SenderUserID,
			&m.ClientMessageID,
			&m.Body,
			&m.MessageType,
			&m.MediaAssetID,
			&m.DeliveredAt,
			&m.ReadAt,
			&m.DeletedAt,
			&m.CreatedAt,
		); err != nil {
			return nil, "", false, fmt.Errorf("failed to scan message: %w", err)
		}
		msgs = append(msgs, &m)
	}

	hasMore := len(msgs) > limit
	if hasMore {
		msgs = msgs[:limit]
	}

	var nextCursor string
	if len(msgs) > 0 {
		nextCursor = msgs[len(msgs)-1].ID
	}

	// Reverse to deliver in chronological order (oldest to newest)
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}

	return msgs, nextCursor, hasMore, nil
}

func (r *PostgresRepository) MarkMessagesRead(ctx context.Context, conversationID, readerUserID string) (int, error) {
	// Resolve conversationID if match_id was supplied
	if conv, convErr := r.GetConversation(ctx, conversationID); convErr == nil && conv != nil {
		conversationID = conv.ID
	}

	query := `
		UPDATE messages
		SET read_at = NOW()
		WHERE conversation_id = $1
		  AND sender_user_id != $2
		  AND read_at IS NULL
		  AND deleted_at IS NULL
	`
	tag, err := r.pool.Exec(ctx, query, conversationID, readerUserID)
	if err != nil {
		return 0, fmt.Errorf("failed to mark messages read: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

func (r *PostgresRepository) MarkMessageDelivered(ctx context.Context, messageID string) error {
	query := `UPDATE messages SET delivered_at = NOW() WHERE id = $1 AND delivered_at IS NULL`
	_, err := r.pool.Exec(ctx, query, messageID)
	return err
}

func (r *PostgresRepository) VerifyConversationMembership(ctx context.Context, conversationID, userID string) (bool, error) {
	query := `
		SELECT 1
		FROM matches m
		LEFT JOIN conversations c ON c.match_id = m.id
		WHERE (c.id = $1 OR m.id = $1) AND (m.user_low_id = $2 OR m.user_high_id = $2)
	`
	var exists int
	err := r.pool.QueryRow(ctx, query, conversationID, userID).Scan(&exists)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (r *PostgresRepository) CheckActiveMatchEligibility(ctx context.Context, conversationID, userID string) (bool, error) {
	query := `
		SELECT m.user_low_id, m.user_high_id, m.status
		FROM matches m
		LEFT JOIN conversations c ON c.match_id = m.id
		WHERE (c.id = $1 OR m.id = $1) AND (m.user_low_id = $2 OR m.user_high_id = $2)
	`
	var (
		lowID, highID, status string
	)
	err := r.pool.QueryRow(ctx, query, conversationID, userID).Scan(&lowID, &highID, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}

	if status != "ACTIVE" {
		return false, nil
	}

	otherID := lowID
	if userID == lowID {
		otherID = highID
	}

	// Verify no bilateral block
	blockQuery := `
		SELECT 1 FROM user_blocks
		WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
		   OR (blocker_user_id = $2 AND blocked_user_id = $1)
	`
	var blocked int
	err = r.pool.QueryRow(ctx, blockQuery, userID, otherID).Scan(&blocked)
	if err == nil {
		return false, nil // Blocked
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}

	return true, nil
}

func (r *PostgresRepository) RegisterPushToken(ctx context.Context, userID, token, platform, deviceID string) error {
	query := `
		INSERT INTO user_push_tokens (user_id, token, platform, device_id, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (user_id, token) DO UPDATE SET updated_at = NOW(), device_id = EXCLUDED.device_id
	`
	_, err := r.pool.Exec(ctx, query, userID, token, platform, deviceID)
	return err
}

func (r *PostgresRepository) LogNotification(ctx context.Context, userID, notifType, channel, title, bodyPreview, status, errReason string) error {
	query := `
		INSERT INTO notification_logs (user_id, notification_type, channel, title, body_preview, status, error_reason)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	_, err := r.pool.Exec(ctx, query, userID, notifType, channel, title, bodyPreview, status, errReason)
	return err
}

func (r *PostgresRepository) CreateMessageRequest(ctx context.Context, senderID, recipientID, body string) (*MessageRequest, error) {
	query := `
		INSERT INTO message_requests (sender_user_id, recipient_user_id, body, status, created_at)
		VALUES ($1, $2, $3, 'PENDING', NOW())
		RETURNING id, created_at
	`
	req := &MessageRequest{
		SenderUserID:    senderID,
		RecipientUserID: recipientID,
		Body:            body,
		Status:          RequestPending,
	}
	err := r.pool.QueryRow(ctx, query, senderID, recipientID, body).Scan(&req.ID, &req.CreatedAt)
	if err != nil {
		return nil, err
	}
	return req, nil
}

func (r *PostgresRepository) ListMessageRequests(ctx context.Context, recipientID string) ([]*MessageRequest, error) {
	query := `
		SELECT mr.id, mr.sender_user_id, mr.recipient_user_id, mr.body, mr.status, mr.created_at, mr.responded_at,
		       p.display_name, EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate))::INT AS age, p.is_photo_verified
		FROM message_requests mr
		JOIN profiles p ON p.user_id = mr.sender_user_id
		WHERE mr.recipient_user_id = $1 AND mr.status = 'PENDING'
		ORDER BY mr.created_at DESC
	`
	rows, err := r.pool.Query(ctx, query, recipientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reqs []*MessageRequest
	for rows.Next() {
		var mr MessageRequest
		var displayName string
		var age int
		var isPhotoVerified bool
		if err := rows.Scan(
			&mr.ID, &mr.SenderUserID, &mr.RecipientUserID, &mr.Body, &mr.Status, &mr.CreatedAt, &mr.RespondedAt,
			&displayName, &age, &isPhotoVerified,
		); err != nil {
			return nil, err
		}
		mr.Sender = &ConversationPartner{
			UserID:          mr.SenderUserID,
			DisplayName:     displayName,
			Age:             age,
			IsPhotoVerified: isPhotoVerified,
		}
		reqs = append(reqs, &mr)
	}
	return reqs, rows.Err()
}

func (r *PostgresRepository) GetMessageRequest(ctx context.Context, requestID string) (*MessageRequest, error) {
	query := `
		SELECT id, sender_user_id, recipient_user_id, body, status, created_at, responded_at
		FROM message_requests
		WHERE id = $1
	`
	var mr MessageRequest
	err := r.pool.QueryRow(ctx, query, requestID).Scan(
		&mr.ID, &mr.SenderUserID, &mr.RecipientUserID, &mr.Body, &mr.Status, &mr.CreatedAt, &mr.RespondedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("message request not found")
		}
		return nil, err
	}
	return &mr, nil
}

func (r *PostgresRepository) AcceptMessageRequest(ctx context.Context, requestID, recipientID string) (string, string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback(ctx)

	var mr MessageRequest
	err = tx.QueryRow(ctx, `
		SELECT id, sender_user_id, recipient_user_id, body, status
		FROM message_requests
		WHERE id = $1 AND recipient_user_id = $2 FOR UPDATE
	`, requestID, recipientID).Scan(&mr.ID, &mr.SenderUserID, &mr.RecipientUserID, &mr.Body, &mr.Status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", errors.New("message request not found or unauthorized")
		}
		return "", "", err
	}

	_, err = tx.Exec(ctx, `UPDATE message_requests SET status = 'ACCEPTED', responded_at = NOW() WHERE id = $1`, requestID)
	if err != nil {
		return "", "", err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO swipes (actor_user_id, target_user_id, direction)
		VALUES ($1, $2, 'LIKE')
		ON CONFLICT (actor_user_id, target_user_id) DO UPDATE SET direction = 'LIKE', undone_at = NULL
	`, recipientID, mr.SenderUserID)
	if err != nil {
		return "", "", err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO swipes (actor_user_id, target_user_id, direction)
		VALUES ($1, $2, 'LIKE')
		ON CONFLICT (actor_user_id, target_user_id) DO UPDATE SET direction = 'LIKE', undone_at = NULL
	`, mr.SenderUserID, recipientID)
	if err != nil {
		return "", "", err
	}

	low, high := canonicalPair(recipientID, mr.SenderUserID)
	var matchID string
	err = tx.QueryRow(ctx, `
		INSERT INTO matches (user_low_id, user_high_id, status, matched_at)
		VALUES ($1, $2, 'ACTIVE', NOW())
		ON CONFLICT (user_low_id, user_high_id) DO UPDATE SET status = 'ACTIVE', matched_at = NOW(), unmatched_at = NULL
		RETURNING id
	`, low, high).Scan(&matchID)
	if err != nil {
		return "", "", err
	}

	var convID string
	err = tx.QueryRow(ctx, `
		INSERT INTO conversations (match_id, created_at, last_message_at)
		VALUES ($1, NOW(), NOW())
		ON CONFLICT (match_id) DO UPDATE SET match_id = EXCLUDED.match_id
		RETURNING id
	`, matchID).Scan(&convID)
	if err != nil {
		return "", "", err
	}

	clientMsgID := fmt.Sprintf("req-%s", requestID)
	_, _ = tx.Exec(ctx, `
		INSERT INTO messages (conversation_id, sender_user_id, client_message_id, body, message_type)
		VALUES ($1, $2, $3, $4, 'TEXT')
		ON CONFLICT (conversation_id, client_message_id) DO NOTHING
	`, convID, mr.SenderUserID, clientMsgID, mr.Body)

	_, _ = tx.Exec(ctx, `
		INSERT INTO user_entitlements (user_id, entitlement_code, source, granted_at, expires_at)
		VALUES ($1, 'UNLIMITED_SWIPES', 'MATCH_REWARD', NOW(), NOW() + INTERVAL '24 hours'),
		       ($2, 'UNLIMITED_SWIPES', 'MATCH_REWARD', NOW(), NOW() + INTERVAL '24 hours')
	`, recipientID, mr.SenderUserID)

	if err := tx.Commit(ctx); err != nil {
		return "", "", err
	}
	return convID, matchID, nil
}

func (r *PostgresRepository) DeclineMessageRequest(ctx context.Context, requestID, recipientID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var senderID string
	err = tx.QueryRow(ctx, `
		UPDATE message_requests
		SET status = 'DECLINED', responded_at = NOW()
		WHERE id = $1 AND recipient_user_id = $2
		RETURNING sender_user_id
	`, requestID, recipientID).Scan(&senderID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("message request not found")
		}
		return err
	}

	_, _ = tx.Exec(ctx, `
		INSERT INTO swipes (actor_user_id, target_user_id, direction)
		VALUES ($1, $2, 'PASS')
		ON CONFLICT (actor_user_id, target_user_id) DO UPDATE SET direction = 'PASS', undone_at = NULL
	`, recipientID, senderID)

	return tx.Commit(ctx)
}

func (r *PostgresRepository) BlockMessageRequest(ctx context.Context, requestID, recipientID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var senderID string
	err = tx.QueryRow(ctx, `
		UPDATE message_requests
		SET status = 'BLOCKED', responded_at = NOW()
		WHERE id = $1 AND recipient_user_id = $2
		RETURNING sender_user_id
	`, requestID, recipientID).Scan(&senderID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("message request not found")
		}
		return err
	}

	_, _ = tx.Exec(ctx, `
		INSERT INTO user_blocks (blocker_user_id, blocked_user_id, reason)
		VALUES ($1, $2, 'MESSAGE_REQUEST_BLOCKED')
		ON CONFLICT DO NOTHING
	`, recipientID, senderID)

	return tx.Commit(ctx)
}

func (r *PostgresRepository) CanAccessMediaAsset(ctx context.Context, assetID, userID string) (bool, error) {
	query := `
		SELECT EXISTS (
			SELECT 1 FROM messages m
			JOIN conversations c ON m.conversation_id = c.id
			JOIN matches match ON match.id = c.match_id
			WHERE m.media_asset_id = $1::uuid
			  AND (match.user_low_id = $2::uuid OR match.user_high_id = $2::uuid)
			  AND m.deleted_at IS NULL
		)
	`
	var exists bool
	err := r.pool.QueryRow(ctx, query, assetID, userID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

// -----------------------------------------------------------------------------
// MemoryRepository
// -----------------------------------------------------------------------------

type MemoryRepository struct {
	mu           sync.RWMutex
	counter      int64
	convs        map[string]*Conversation // key: convID
	convByMatch  map[string]string        // key: matchID -> convID
	messages     map[string][]*Message    // key: convID -> list of messages
	msgByClient  map[string]*Message      // key: senderID:clientMsgID -> Message
	matches      map[string]*discovery.Match
	blocks       map[string]struct{}      // key: blocker:blocked
	pushTokens   map[string][]string      // key: userID -> list of tokens
	requests     map[string]*MessageRequest
	notifLogs    []map[string]any
	outboxEvents []events.Envelope
	identRepo    identity.Repository
}

func NewMemoryRepository(identRepo identity.Repository) *MemoryRepository {
	return &MemoryRepository{
		convs:        make(map[string]*Conversation),
		convByMatch:  make(map[string]string),
		messages:     make(map[string][]*Message),
		msgByClient:  make(map[string]*Message),
		matches:      make(map[string]*discovery.Match),
		blocks:       make(map[string]struct{}),
		pushTokens:   make(map[string][]string),
		requests:     make(map[string]*MessageRequest),
		notifLogs:    make([]map[string]any, 0),
		outboxEvents: make([]events.Envelope, 0),
		identRepo:    identRepo,
	}
}

func (m *MemoryRepository) SeedMatch(match *discovery.Match) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.matches[match.ID] = match
}

func (m *MemoryRepository) SeedBlock(blockerID, blockedID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.blocks[blockerID+":"+blockedID] = struct{}{}
}

func (m *MemoryRepository) GetOrCreateConversationForMatch(ctx context.Context, matchID string) (*Conversation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	match, exists := m.matches[matchID]
	if !exists {
		return nil, discovery.ErrMatchNotFound
	}
	if match.Status != discovery.MatchActive {
		return nil, ErrMatchInactive
	}

	if convID, ok := m.convByMatch[matchID]; ok {
		return m.convs[convID], nil
	}

	convID := fmt.Sprintf("conv_%d", time.Now().UnixNano())
	now := time.Now().UTC()
	c := &Conversation{
		ID:                convID,
		MatchID:           matchID,
		ParticipantLowID:  match.UserLowID,
		ParticipantHighID: match.UserHighID,
		CreatedAt:         now,
	}
	m.convs[convID] = c
	m.convByMatch[matchID] = convID
	m.messages[convID] = make([]*Message, 0)
	return c, nil
}

func (m *MemoryRepository) GetConversation(ctx context.Context, conversationID string) (*Conversation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	c, ok := m.convs[conversationID]
	if !ok {
		if convID, exists := m.convByMatch[conversationID]; exists {
			c, ok = m.convs[convID], true
		} else if _, matchExists := m.matches[conversationID]; matchExists {
			m.mu.Unlock()
			conv, err := m.GetOrCreateConversationForMatch(ctx, conversationID)
			m.mu.Lock()
			if err == nil && conv != nil {
				return conv, nil
			}
		}
	}
	if !ok {
		return nil, ErrConversationNotFound
	}

	match, ok := m.matches[c.MatchID]
	if !ok || match.Status != discovery.MatchActive {
		return nil, ErrMatchInactive
	}

	return c, nil
}

func (m *MemoryRepository) ListConversationsForUser(ctx context.Context, userID string) ([]*Conversation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var res []*Conversation
	for _, match := range m.matches {
		if match.Status != discovery.MatchActive {
			continue
		}
		if match.UserLowID != userID && match.UserHighID != userID {
			continue
		}
		otherID := match.UserLowID
		if userID == match.UserLowID {
			otherID = match.UserHighID
		}
		if _, b1 := m.blocks[userID+":"+otherID]; b1 {
			continue
		}
		if _, b2 := m.blocks[otherID+":"+userID]; b2 {
			continue
		}

		convID, exists := m.convByMatch[match.ID]
		if !exists {
			convID = fmt.Sprintf("conv_%d", time.Now().UnixNano())
			c := &Conversation{
				ID:                convID,
				MatchID:           match.ID,
				ParticipantLowID:  match.UserLowID,
				ParticipantHighID: match.UserHighID,
				CreatedAt:         match.MatchedAt,
			}
			m.convs[convID] = c
			m.convByMatch[match.ID] = convID
			m.messages[convID] = make([]*Message, 0)
		}

		c := m.convs[convID]
		// Count unread and get last message
		unread := 0
		var lastMsg *MessageSummary
		msgs := m.messages[convID]
		if len(msgs) > 0 {
			last := msgs[len(msgs)-1]
			lastMsg = &MessageSummary{
				ID:           last.ID,
				SenderUserID: last.SenderUserID,
				Body:         last.Body,
				MessageType:  last.MessageType,
				CreatedAt:    last.CreatedAt,
				IsRead:       last.ReadAt != nil,
			}
			for _, msg := range msgs {
				if msg.SenderUserID != userID && msg.ReadAt == nil {
					unread++
				}
			}
		}

		cCopy := *c
		cCopy.UnreadCount = unread
		cCopy.LastMessage = lastMsg
		res = append(res, &cCopy)
	}

	sort.Slice(res, func(i, j int) bool {
		t1 := res[i].CreatedAt
		if res[i].LastMessageAt != nil {
			t1 = *res[i].LastMessageAt
		}
		t2 := res[j].CreatedAt
		if res[j].LastMessageAt != nil {
			t2 = *res[j].LastMessageAt
		}
		return t1.After(t2)
	})

	return res, nil
}

func (m *MemoryRepository) SaveMessage(ctx context.Context, msg *Message) (*Message, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	c, ok := m.convs[msg.ConversationID]
	if !ok {
		if convID, exists := m.convByMatch[msg.ConversationID]; exists {
			c, ok = m.convs[convID], true
			msg.ConversationID = convID
		}
	}
	if !ok {
		return nil, false, ErrConversationNotFound
	}

	// Check match active and blocks
	match, ok := m.matches[c.MatchID]
	if !ok || match.Status != discovery.MatchActive {
		return nil, false, ErrMatchInactive
	}
	otherID := c.OtherParticipantID(msg.SenderUserID)
	if _, blocked := m.blocks[msg.SenderUserID+":"+otherID]; blocked {
		return nil, false, ErrMatchInactive
	}
	if _, blocked := m.blocks[otherID+":"+msg.SenderUserID]; blocked {
		return nil, false, ErrMatchInactive
	}

	// Idempotency check
	clientKey := msg.SenderUserID + ":" + msg.ClientMessageID
	if existing, ok := m.msgByClient[clientKey]; ok {
		return existing, true, nil
	}

	m.counter++
	now := time.Now().UTC()
	saved := &Message{
		ID:              fmt.Sprintf("msg_%d_%d", now.UnixNano(), m.counter),
		ConversationID:  msg.ConversationID,
		SenderUserID:    msg.SenderUserID,
		ClientMessageID: msg.ClientMessageID,
		Body:            msg.Body,
		MessageType:     msg.MessageType,
		MediaAssetID:    msg.MediaAssetID,
		DeliveredAt:     &now,
		CreatedAt:       now,
	}

	m.messages[msg.ConversationID] = append(m.messages[msg.ConversationID], saved)
	m.msgByClient[clientKey] = saved
	c.LastMessageAt = &now

	// Record outbox event
	env, _ := events.NewEnvelope(
		"conversation",
		saved.ConversationID,
		"messaging.message.sent.v1",
		saved.ClientMessageID,
		1,
		map[string]any{
			"message_id":      saved.ID,
			"conversation_id": saved.ConversationID,
			"sender_user_id":  saved.SenderUserID,
		},
	)
	m.outboxEvents = append(m.outboxEvents, env)

	return saved, false, nil
}

func (m *MemoryRepository) ListMessages(ctx context.Context, conversationID string, beforeID string, limit int) ([]*Message, string, bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	msgs, ok := m.messages[conversationID]
	if !ok {
		if convID, exists := m.convByMatch[conversationID]; exists {
			msgs, ok = m.messages[convID]
		}
	}
	if !ok {
		return nil, "", false, ErrConversationNotFound
	}

	if limit <= 0 || limit > 100 {
		limit = 50
	}

	endIdx := len(msgs)
	if beforeID != "" {
		for i, msg := range msgs {
			if msg.ID == beforeID {
				endIdx = i
				break
			}
		}
	}

	startIdx := 0
	if endIdx > limit {
		startIdx = endIdx - limit
	}

	slice := msgs[startIdx:endIdx]
	hasMore := startIdx > 0
	var nextCursor string
	if len(slice) > 0 {
		nextCursor = slice[0].ID
	}

	res := make([]*Message, len(slice))
	copy(res, slice)
	return res, nextCursor, hasMore, nil
}

func (m *MemoryRepository) MarkMessagesRead(ctx context.Context, conversationID, readerUserID string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	msgs, ok := m.messages[conversationID]
	if !ok {
		if convID, exists := m.convByMatch[conversationID]; exists {
			msgs, ok = m.messages[convID]
		}
	}
	if !ok {
		return 0, ErrConversationNotFound
	}

	count := 0
	now := time.Now().UTC()
	for _, msg := range msgs {
		if msg.SenderUserID != readerUserID && msg.ReadAt == nil {
			msg.ReadAt = &now
			count++
		}
	}
	return count, nil
}

func (m *MemoryRepository) MarkMessageDelivered(ctx context.Context, messageID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, list := range m.messages {
		for _, msg := range list {
			if msg.ID == messageID && msg.DeliveredAt == nil {
				now := time.Now().UTC()
				msg.DeliveredAt = &now
				return nil
			}
		}
	}
	return nil
}

func (m *MemoryRepository) VerifyConversationMembership(ctx context.Context, conversationID, userID string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	c, ok := m.convs[conversationID]
	if !ok {
		if convID, exists := m.convByMatch[conversationID]; exists {
			c, ok = m.convs[convID], true
		}
	}
	if !ok {
		return false, nil
	}
	return c.IsParticipant(userID), nil
}

func (m *MemoryRepository) CheckActiveMatchEligibility(ctx context.Context, conversationID, userID string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	c, ok := m.convs[conversationID]
	if !ok {
		if convID, exists := m.convByMatch[conversationID]; exists {
			c, ok = m.convs[convID], true
		}
	}
	if !ok {
		return false, nil
	}
	if !c.IsParticipant(userID) {
		return false, nil
	}

	match, ok := m.matches[c.MatchID]
	if !ok || match.Status != discovery.MatchActive {
		return false, nil
	}

	otherID := c.OtherParticipantID(userID)
	if _, blocked := m.blocks[userID+":"+otherID]; blocked {
		return false, nil
	}
	if _, blocked := m.blocks[otherID+":"+userID]; blocked {
		return false, nil
	}

	return true, nil
}

func (m *MemoryRepository) RegisterPushToken(ctx context.Context, userID, token, platform, deviceID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pushTokens[userID] = append(m.pushTokens[userID], token)
	return nil
}

func (m *MemoryRepository) LogNotification(ctx context.Context, userID, notifType, channel, title, bodyPreview, status, errReason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.notifLogs = append(m.notifLogs, map[string]any{
		"user_id":      userID,
		"type":         notifType,
		"channel":      channel,
		"title":        title,
		"body_preview": bodyPreview,
		"status":       status,
		"err":          errReason,
	})
	return nil
}

func (m *MemoryRepository) GetOutboxEvents() []events.Envelope {
	m.mu.RLock()
	defer m.mu.RUnlock()
	res := make([]events.Envelope, len(m.outboxEvents))
	copy(res, m.outboxEvents)
	return res
}

func (m *MemoryRepository) CreateMessageRequest(ctx context.Context, senderID, recipientID, body string) (*MessageRequest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	reqID := fmt.Sprintf("req_%d", time.Now().UnixNano())
	now := time.Now().UTC()
	req := &MessageRequest{
		ID:              reqID,
		SenderUserID:    senderID,
		RecipientUserID: recipientID,
		Body:            body,
		Status:          RequestPending,
		CreatedAt:       now,
	}
	m.requests[reqID] = req
	return req, nil
}

func (m *MemoryRepository) ListMessageRequests(ctx context.Context, recipientID string) ([]*MessageRequest, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var reqs []*MessageRequest
	for _, req := range m.requests {
		if req.RecipientUserID == recipientID && req.Status == RequestPending {
			c := *req
			if m.identRepo != nil {
				if prof, err := m.identRepo.GetProfile(ctx, req.SenderUserID); err == nil && prof != nil {
					c.Sender = &ConversationPartner{
						UserID:          req.SenderUserID,
						DisplayName:     prof.DisplayName,
						Age:             calculateAge(prof.Birthdate, time.Now().UTC()),
						IsPhotoVerified: prof.IsPhotoVerified,
					}
				}
			}
			reqs = append(reqs, &c)
		}
	}
	return reqs, nil
}

func (m *MemoryRepository) GetMessageRequest(ctx context.Context, requestID string) (*MessageRequest, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	req, ok := m.requests[requestID]
	if !ok {
		return nil, errors.New("message request not found")
	}
	c := *req
	return &c, nil
}

func (m *MemoryRepository) AcceptMessageRequest(ctx context.Context, requestID, recipientID string) (string, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	req, ok := m.requests[requestID]
	if !ok || req.RecipientUserID != recipientID {
		return "", "", errors.New("message request not found or unauthorized")
	}
	now := time.Now().UTC()
	req.Status = RequestAccepted
	req.RespondedAt = &now

	low, high := canonicalPair(recipientID, req.SenderUserID)
	matchID := fmt.Sprintf("match_%s_%s", low, high)
	match := &discovery.Match{
		ID:         matchID,
		UserLowID:  low,
		UserHighID: high,
		Status:     discovery.MatchActive,
		MatchedAt:  now,
	}
	m.matches[matchID] = match

	convID := fmt.Sprintf("conv_%s", matchID)
	conv := &Conversation{
		ID:                convID,
		MatchID:           matchID,
		ParticipantLowID:  low,
		ParticipantHighID: high,
		LastMessageAt:     &now,
		CreatedAt:         now,
	}
	m.convs[convID] = conv
	m.convByMatch[matchID] = convID

	msg := &Message{
		ID:              fmt.Sprintf("msg_%d", time.Now().UnixNano()),
		ConversationID:  convID,
		SenderUserID:    req.SenderUserID,
		ClientMessageID: fmt.Sprintf("req-%s", requestID),
		Body:            req.Body,
		MessageType:     MessageTypeText,
		CreatedAt:       now,
	}
	m.messages[convID] = append(m.messages[convID], msg)

	return convID, matchID, nil
}

func (m *MemoryRepository) DeclineMessageRequest(ctx context.Context, requestID, recipientID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	req, ok := m.requests[requestID]
	if !ok || req.RecipientUserID != recipientID {
		return errors.New("message request not found")
	}
	now := time.Now().UTC()
	req.Status = RequestDeclined
	req.RespondedAt = &now
	return nil
}

func (m *MemoryRepository) BlockMessageRequest(ctx context.Context, requestID, recipientID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	req, ok := m.requests[requestID]
	if !ok || req.RecipientUserID != recipientID {
		return errors.New("message request not found")
	}
	now := time.Now().UTC()
	req.Status = RequestBlocked
	req.RespondedAt = &now
	m.blocks[recipientID+":"+req.SenderUserID] = struct{}{}
	return nil
}

func (m *MemoryRepository) CanAccessMediaAsset(ctx context.Context, assetID, userID string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for convID, msgs := range m.messages {
		for _, msg := range msgs {
			if msg.MediaAssetID != nil && *msg.MediaAssetID == assetID && msg.DeletedAt == nil {
				if conv, ok := m.convs[convID]; ok && conv.IsParticipant(userID) {
					return true, nil
				}
			}
		}
	}
	return false, nil
}

func canonicalPair(u1, u2 string) (low, high string) {
	if strings.Compare(u1, u2) < 0 {
		return u1, u2
	}
	return u2, u1
}

func calculateAge(birthdate time.Time, now time.Time) int {
	years := now.Year() - birthdate.Year()
	if now.YearDay() < birthdate.YearDay() {
		years--
	}
	return years
}
