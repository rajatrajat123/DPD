package notification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/auradating/platform/backend/internal/identity"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	GetPreferences(ctx context.Context, userID string) (*identity.NotificationPreferences, error)
	UpdatePreferences(ctx context.Context, userID string, prefs *identity.NotificationPreferences) error
	ListActivePushTokens(ctx context.Context, userID string) ([]PushToken, error)
	RegisterPushToken(ctx context.Context, userID, token, platform, deviceID string) error
	InvalidatePushToken(ctx context.Context, token string, reason string) error
	LogNotification(ctx context.Context, log NotificationLog) error
	IsNotificationLogged(ctx context.Context, eventID string, channel Channel) (bool, error)
	ListNotificationLogs(ctx context.Context, userID string, limit int) ([]NotificationLog, error)
}

// MemoryRepository provides thread-safe in-memory storage for notifications.
type MemoryRepository struct {
	mu          sync.RWMutex
	preferences map[string]*identity.NotificationPreferences
	tokens      map[string]*PushToken       // key: token
	userTokens  map[string]map[string]bool  // key: userID -> map[token]bool
	logs        []NotificationLog
	loggedDedups map[string]bool            // key: eventID:channel
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		preferences:  make(map[string]*identity.NotificationPreferences),
		tokens:       make(map[string]*PushToken),
		userTokens:   make(map[string]map[string]bool),
		loggedDedups: make(map[string]bool),
	}
}

func (m *MemoryRepository) GetPreferences(ctx context.Context, userID string) (*identity.NotificationPreferences, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if p, ok := m.preferences[userID]; ok {
		copied := *p
		return &copied, nil
	}
	def := identity.DefaultNotificationPreferences()
	return &def, nil
}

func (m *MemoryRepository) UpdatePreferences(ctx context.Context, userID string, prefs *identity.NotificationPreferences) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	copied := *prefs
	m.preferences[userID] = &copied
	return nil
}

func (m *MemoryRepository) ListActivePushTokens(ctx context.Context, userID string) ([]PushToken, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []PushToken
	tokMap, ok := m.userTokens[userID]
	if !ok {
		return result, nil
	}

	for tokStr := range tokMap {
		if pt, exists := m.tokens[tokStr]; exists && pt.IsActive {
			result = append(result, *pt)
		}
	}
	return result, nil
}

func (m *MemoryRepository) RegisterPushToken(ctx context.Context, userID, token, platform, deviceID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	pt := &PushToken{
		ID:        fmt.Sprintf("tok-%d", now.UnixNano()),
		UserID:    userID,
		Token:     token,
		Platform:  platform,
		DeviceID:  deviceID,
		IsActive:  true,
		CreatedAt: now,
		UpdatedAt: now,
	}

	m.tokens[token] = pt
	if _, ok := m.userTokens[userID]; !ok {
		m.userTokens[userID] = make(map[string]bool)
	}
	m.userTokens[userID][token] = true
	return nil
}

func (m *MemoryRepository) InvalidatePushToken(ctx context.Context, token string, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if pt, exists := m.tokens[token]; exists {
		pt.IsActive = false
		pt.UpdatedAt = time.Now().UTC()
	}
	return nil
}

func (m *MemoryRepository) LogNotification(ctx context.Context, log NotificationLog) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if log.ID == "" {
		log.ID = fmt.Sprintf("notif-%d", time.Now().UnixNano())
	}
	if log.CreatedAt.IsZero() {
		log.CreatedAt = time.Now().UTC()
	}

	m.logs = append(m.logs, log)
	if log.EventID != "" {
		key := fmt.Sprintf("%s:%s", log.EventID, log.Channel)
		m.loggedDedups[key] = true
	}
	return nil
}

func (m *MemoryRepository) IsNotificationLogged(ctx context.Context, eventID string, channel Channel) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if eventID == "" {
		return false, nil
	}
	key := fmt.Sprintf("%s:%s", eventID, channel)
	return m.loggedDedups[key], nil
}

func (m *MemoryRepository) ListNotificationLogs(ctx context.Context, userID string, limit int) ([]NotificationLog, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []NotificationLog
	for i := len(m.logs) - 1; i >= 0; i-- {
		if m.logs[i].RecipientUserID == userID {
			result = append(result, m.logs[i])
			if limit > 0 && len(result) >= limit {
				break
			}
		}
	}
	return result, nil
}

// PostgresRepository implements notification persistence using PostgreSQL.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (p *PostgresRepository) GetPreferences(ctx context.Context, userID string) (*identity.NotificationPreferences, error) {
	query := `SELECT notification_preferences FROM dating_preferences WHERE user_id = $1`
	var prefBytes []byte
	err := p.pool.QueryRow(ctx, query, userID).Scan(&prefBytes)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			def := identity.DefaultNotificationPreferences()
			return &def, nil
		}
		return nil, err
	}

	var prefs identity.NotificationPreferences
	if len(prefBytes) > 0 {
		if err := json.Unmarshal(prefBytes, &prefs); err != nil {
			def := identity.DefaultNotificationPreferences()
			return &def, nil
		}
		return &prefs, nil
	}

	def := identity.DefaultNotificationPreferences()
	return &def, nil
}

func (p *PostgresRepository) UpdatePreferences(ctx context.Context, userID string, prefs *identity.NotificationPreferences) error {
	prefBytes, err := json.Marshal(prefs)
	if err != nil {
		return fmt.Errorf("failed to marshal notification preferences: %w", err)
	}

	query := `
		INSERT INTO dating_preferences (user_id, notification_preferences, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (user_id) DO UPDATE
		SET notification_preferences = EXCLUDED.notification_preferences,
		    updated_at = NOW()
	`
	_, err = p.pool.Exec(ctx, query, userID, prefBytes)
	return err
}

func (p *PostgresRepository) ListActivePushTokens(ctx context.Context, userID string) ([]PushToken, error) {
	query := `
		SELECT id, user_id, token, platform, device_id, is_active, created_at, updated_at
		FROM user_push_tokens
		WHERE user_id = $1 AND is_active = TRUE
	`
	rows, err := p.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []PushToken
	for rows.Next() {
		var pt PushToken
		var devID *string
		if err := rows.Scan(&pt.ID, &pt.UserID, &pt.Token, &pt.Platform, &devID, &pt.IsActive, &pt.CreatedAt, &pt.UpdatedAt); err != nil {
			return nil, err
		}
		if devID != nil {
			pt.DeviceID = *devID
		}
		result = append(result, pt)
	}
	return result, rows.Err()
}

func (p *PostgresRepository) RegisterPushToken(ctx context.Context, userID, token, platform, deviceID string) error {
	query := `
		INSERT INTO user_push_tokens (user_id, token, platform, device_id, is_active, updated_at)
		VALUES ($1, $2, $3, $4, TRUE, NOW())
		ON CONFLICT (user_id, token) DO UPDATE
		SET is_active = TRUE,
		    invalidated_at = NULL,
		    device_id = EXCLUDED.device_id,
		    platform = EXCLUDED.platform,
		    updated_at = NOW()
	`
	_, err := p.pool.Exec(ctx, query, userID, token, platform, deviceID)
	return err
}

func (p *PostgresRepository) InvalidatePushToken(ctx context.Context, token string, reason string) error {
	query := `
		UPDATE user_push_tokens
		SET is_active = FALSE,
		    invalidated_at = NOW(),
		    updated_at = NOW()
		WHERE token = $1
	`
	_, err := p.pool.Exec(ctx, query, token)
	return err
}

func (p *PostgresRepository) LogNotification(ctx context.Context, log NotificationLog) error {
	query := `
		INSERT INTO notification_logs (
			recipient_user_id, category, channel, title, body_preview,
			delivery_status, error_details, event_id, correlation_id, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
		ON CONFLICT (event_id, channel) WHERE event_id IS NOT NULL DO NOTHING
	`
	_, err := p.pool.Exec(ctx, query,
		log.RecipientUserID, string(log.Category), string(log.Channel),
		log.Title, log.BodyPreview, string(log.DeliveryStatus),
		log.ErrorDetails, log.EventID, log.CorrelationID,
	)
	return err
}

func (p *PostgresRepository) IsNotificationLogged(ctx context.Context, eventID string, channel Channel) (bool, error) {
	if eventID == "" {
		return false, nil
	}
	query := `
		SELECT 1 FROM notification_logs
		WHERE event_id = $1 AND channel = $2
		LIMIT 1
	`
	var exists int
	err := p.pool.QueryRow(ctx, query, eventID, string(channel)).Scan(&exists)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (p *PostgresRepository) ListNotificationLogs(ctx context.Context, userID string, limit int) ([]NotificationLog, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `
		SELECT id, recipient_user_id, category, channel, title, body_preview,
		       delivery_status, error_details, event_id, correlation_id, created_at
		FROM notification_logs
		WHERE recipient_user_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`
	rows, err := p.pool.Query(ctx, query, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []NotificationLog
	for rows.Next() {
		var l NotificationLog
		var cat, ch, st string
		var errDet, evID, corrID *string
		if err := rows.Scan(
			&l.ID, &l.RecipientUserID, &cat, &ch, &l.Title, &l.BodyPreview,
			&st, &errDet, &evID, &corrID, &l.CreatedAt,
		); err != nil {
			return nil, err
		}
		l.Category = Category(cat)
		l.Channel = Channel(ch)
		l.DeliveryStatus = DeliveryStatus(st)
		if errDet != nil {
			l.ErrorDetails = *errDet
		}
		if evID != nil {
			l.EventID = *evID
		}
		if corrID != nil {
			l.CorrelationID = *corrID
		}
		result = append(result, l)
	}
	return result, rows.Err()
}
