package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
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
			  AND created_at < (SELECT created_at FROM messages WHERE id = $2)
			ORDER BY created_at DESC
			LIMIT $3
		`
		rows, err = r.pool.Query(ctx, query, conversationID, beforeID, limit+1)
	} else {
		query := `
			SELECT id, conversation_id, sender_user_id, client_message_id, body, message_type, media_asset_id, delivered_at, read_at, deleted_at, created_at
			FROM messages
			WHERE conversation_id = $1 AND deleted_at IS NULL
			ORDER BY created_at DESC
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
