package configmgr

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrConfigNotFound = errors.New("configuration key not found")

type Repository interface {
	Get(ctx context.Context, key string) (json.RawMessage, error)
	GetAll(ctx context.Context) (map[string]json.RawMessage, error)
	Set(ctx context.Context, key string, val json.RawMessage, updatedBy *string) error
}

type MemoryRepository struct {
	mu      sync.RWMutex
	configs map[string]json.RawMessage
}

func NewMemoryRepository() *MemoryRepository {
	m := &MemoryRepository{
		configs: make(map[string]json.RawMessage),
	}
	m.seedDefaults()
	return m
}

func (m *MemoryRepository) seedDefaults() {
	m.configs["advertising"] = json.RawMessage(`{"swipe_feed_ad_interval": 11, "rewarded_ad_enabled": true, "banner_enabled": true, "ad_frequency_cap_hourly": 6}`)
	m.configs["likes_reveals"] = json.RawMessage(`{"free_reveals_count": 1, "reveals_per_ad": 2, "cooldown_hours": 4, "daily_reveal_limit": 10, "premium_unlimited": true}`)
	m.configs["boost_config"] = json.RawMessage(`{"price_cents": 500, "duration_minutes": 60, "max_radius_km": 200, "multiplier": 2.5, "is_active": true}`)
	m.configs["affiliate_config"] = json.RawMessage(`{"mode": "REVSHARE_PERCENT", "default_cpa_cents": 3500, "default_revshare_bps": 2500, "minimum_payout_cents": 5000, "manual_approval_required": true, "first_payment_only": false, "max_qualifying_renewals": 12, "escrow_hold_days": 30}`)
	m.configs["support_routing"] = json.RawMessage(`{"default_strategy": "WORKLOAD", "auto_assign": true, "escalation_hours": 24}`)
	m.configs["country_settings"] = json.RawMessage(`{"supported_countries": ["US", "CA", "GB", "DE", "FR", "ES", "NL", "AU", "NZ", "BR", "MX", "IN"], "restricted_countries": ["AE", "SA", "QA"], "default_currency": "USD"}`)
}

func (m *MemoryRepository) Get(_ context.Context, key string) (json.RawMessage, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	val, ok := m.configs[key]
	if !ok {
		return nil, ErrConfigNotFound
	}
	return val, nil
}

func (m *MemoryRepository) GetAll(_ context.Context) (map[string]json.RawMessage, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make(map[string]json.RawMessage, len(m.configs))
	for k, v := range m.configs {
		out[k] = v
	}
	return out, nil
}

func (m *MemoryRepository) Set(_ context.Context, key string, val json.RawMessage, _ *string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.configs[key] = val
	return nil
}

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (p *PostgresRepository) Get(ctx context.Context, key string) (json.RawMessage, error) {
	query := `SELECT config_value FROM platform_configurations WHERE config_key = $1`
	var val json.RawMessage
	err := p.pool.QueryRow(ctx, query, key).Scan(&val)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConfigNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get config %s: %w", key, err)
	}
	return val, nil
}

func (p *PostgresRepository) GetAll(ctx context.Context) (map[string]json.RawMessage, error) {
	query := `SELECT config_key, config_value FROM platform_configurations`
	rows, err := p.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query platform_configurations: %w", err)
	}
	defer rows.Close()

	out := make(map[string]json.RawMessage)
	for rows.Next() {
		var k string
		var v json.RawMessage
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

func (p *PostgresRepository) Set(ctx context.Context, key string, val json.RawMessage, updatedBy *string) error {
	query := `
		INSERT INTO platform_configurations (config_key, config_value, updated_by, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (config_key) DO UPDATE SET
			config_value = EXCLUDED.config_value,
			updated_by = EXCLUDED.updated_by,
			updated_at = NOW()
	`
	_, err := p.pool.Exec(ctx, query, key, val, updatedBy)
	if err != nil {
		return fmt.Errorf("failed to update config %s: %w", key, err)
	}
	return nil
}
