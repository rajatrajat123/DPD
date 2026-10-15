package analytics

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	GetAnalyticsSummary(ctx context.Context) (*AnalyticsSummaryResponse, error)
	RecordEvent(ctx context.Context, category string, count int) error
}

type MemoryRepository struct {
	mu      sync.RWMutex
	summary AnalyticsSummaryResponse
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		summary: AnalyticsSummaryResponse{
			Funnel: FunnelMetrics{
				TotalRegisteredUsers: 150,
				ProfilesCompleted:    142,
				ProfilesVerified:     88,
				TotalSwipes:          1240,
				TotalLikes:           620,
				TotalMatches:         180,
				ActiveConversations:  145,
			},
			Subscriptions: SubscriptionMetrics{
				ActiveSubscriptions: 42,
				SubscriptionsByTier: map[string]int{
					"PLUS":  30,
					"ELITE": 12,
				},
				EstimatedMRRCents: 52400, // $524.00
			},
			Safety: SafetyMetrics{
				TotalReports:         8,
				PendingReports:       1,
				ResolvedReports:      7,
				AvgResolutionSeconds: 420.5,
			},
			Notifications: NotificationMetrics{
				Delivered:            350,
				Queued:               12,
				Unconfigured:         0,
				SuppressedConsent:    18,
				SuppressedQuietHours: 15,
				Failed:               2,
			},
			GeneratedAt: time.Now().UTC(),
		},
	}
}

func (m *MemoryRepository) GetAnalyticsSummary(ctx context.Context) (*AnalyticsSummaryResponse, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	copied := m.summary
	copied.GeneratedAt = time.Now().UTC()
	return &copied, nil
}

func (m *MemoryRepository) SetSummary(s AnalyticsSummaryResponse) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.summary = s
}

func (m *MemoryRepository) RecordEvent(ctx context.Context, category string, count int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	switch category {
	case "swipe":
		m.summary.Funnel.TotalSwipes += count
	case "match":
		m.summary.Funnel.TotalMatches += count
	case "verified":
		m.summary.Funnel.ProfilesVerified += count
	}
	return nil
}

// PostgresRepository executes aggregate queries directly on PostgreSQL tables.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (p *PostgresRepository) RecordEvent(ctx context.Context, category string, count int) error {
	return nil // Aggregates are derived dynamically from underlying tables
}

func (p *PostgresRepository) GetAnalyticsSummary(ctx context.Context) (*AnalyticsSummaryResponse, error) {
	resp := &AnalyticsSummaryResponse{
		Subscriptions: SubscriptionMetrics{
			SubscriptionsByTier: make(map[string]int),
		},
		GeneratedAt: time.Now().UTC(),
	}

	// 1. Funnel aggregates
	funnelQuery := `
		SELECT
			(SELECT COUNT(*) FROM users) AS total_users,
			(SELECT COUNT(*) FROM profiles) AS completed_profiles,
			(SELECT COUNT(*) FROM profiles WHERE is_photo_verified = TRUE) AS verified_profiles,
			(SELECT COUNT(*) FROM swipes) AS total_swipes,
			(SELECT COUNT(*) FROM swipes WHERE direction IN ('LIKE', 'SUPER_SPARK')) AS total_likes,
			(SELECT COUNT(*) FROM matches WHERE status = 'ACTIVE') AS total_matches,
			(SELECT COUNT(DISTINCT match_id) FROM messages) AS active_conversations
	`
	err := p.pool.QueryRow(ctx, funnelQuery).Scan(
		&resp.Funnel.TotalRegisteredUsers,
		&resp.Funnel.ProfilesCompleted,
		&resp.Funnel.ProfilesVerified,
		&resp.Funnel.TotalSwipes,
		&resp.Funnel.TotalLikes,
		&resp.Funnel.TotalMatches,
		&resp.Funnel.ActiveConversations,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query funnel metrics: %w", err)
	}

	// 2. Subscriptions aggregates
	subQuery := `
		SELECT COALESCE(tier, 'UNKNOWN'), COUNT(*)
		FROM user_subscriptions
		WHERE status = 'ACTIVE' AND current_period_end > NOW()
		GROUP BY tier
	`
	subRows, err := p.pool.Query(ctx, subQuery)
	if err == nil {
		defer subRows.Close()
		totalSubs := 0
		var estMRR int64
		for subRows.Next() {
			var tier string
			var count int
			if err := subRows.Scan(&tier, &count); err == nil {
				resp.Subscriptions.SubscriptionsByTier[tier] = count
				totalSubs += count
				switch tier {
				case "PLUS":
					estMRR += int64(count) * 999 // $9.99
				case "ELITE":
					estMRR += int64(count) * 1999 // $19.99
				default:
					estMRR += int64(count) * 999
				}
			}
		}
		resp.Subscriptions.ActiveSubscriptions = totalSubs
		resp.Subscriptions.EstimatedMRRCents = estMRR
	}

	// 3. Safety aggregates
	safetyQuery := `
		SELECT
			COUNT(*) AS total_reports,
			COUNT(*) FILTER (WHERE status = 'PENDING') AS pending_reports,
			COUNT(*) FILTER (WHERE status = 'RESOLVED') AS resolved_reports,
			COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))) FILTER (WHERE status = 'RESOLVED' AND resolved_at IS NOT NULL), 0) AS avg_resolution
		FROM safety_reports
	`
	_ = p.pool.QueryRow(ctx, safetyQuery).Scan(
		&resp.Safety.TotalReports,
		&resp.Safety.PendingReports,
		&resp.Safety.ResolvedReports,
		&resp.Safety.AvgResolutionSeconds,
	)

	// 4. Notification delivery aggregates
	notifQuery := `
		SELECT delivery_status, COUNT(*)
		FROM notification_logs
		GROUP BY delivery_status
	`
	notifRows, err := p.pool.Query(ctx, notifQuery)
	if err == nil {
		defer notifRows.Close()
		for notifRows.Next() {
			var status string
			var count int
			if err := notifRows.Scan(&status, &count); err == nil {
				switch status {
				case "DELIVERED":
					resp.Notifications.Delivered = count
				case "QUEUED":
					resp.Notifications.Queued = count
				case "UNCONFIGURED":
					resp.Notifications.Unconfigured = count
				case "SUPPRESSED_CONSENT":
					resp.Notifications.SuppressedConsent = count
				case "SUPPRESSED_QUIET_HOURS":
					resp.Notifications.SuppressedQuietHours = count
				case "FAILED":
					resp.Notifications.Failed = count
				}
			}
		}
	}

	return resp, nil
}
