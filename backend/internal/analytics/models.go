package analytics

import "time"

type FunnelMetrics struct {
	TotalRegisteredUsers int `json:"total_registered_users"`
	ProfilesCompleted    int `json:"profiles_completed"`
	ProfilesVerified     int `json:"profiles_verified"`
	TotalSwipes          int `json:"total_swipes"`
	TotalLikes           int `json:"total_likes"`
	TotalMatches         int `json:"total_matches"`
	ActiveConversations  int `json:"active_conversations"`
}

type SubscriptionMetrics struct {
	ActiveSubscriptions int            `json:"active_subscriptions"`
	SubscriptionsByTier map[string]int `json:"subscriptions_by_tier"`
	EstimatedMRRCents   int64          `json:"estimated_mrr_cents"`
}

type SafetyMetrics struct {
	TotalReports         int     `json:"total_reports"`
	PendingReports       int     `json:"pending_reports"`
	ResolvedReports      int     `json:"resolved_reports"`
	AvgResolutionSeconds float64 `json:"avg_resolution_seconds"`
}

type NotificationMetrics struct {
	Delivered             int `json:"delivered"`
	Queued                int `json:"queued"`
	Unconfigured          int `json:"unconfigured"`
	SuppressedConsent     int `json:"suppressed_consent"`
	SuppressedQuietHours  int `json:"suppressed_quiet_hours"`
	Failed                int `json:"failed"`
}

// AnalyticsSummaryResponse provides first-party aggregate platform health metrics.
// CRITICAL PRIVACY INVARIANT: Never exposes or transmits individual PII, sexual orientations,
// gender identities, chats, photos, or raw GPS coordinates.
type AnalyticsSummaryResponse struct {
	Funnel        FunnelMetrics       `json:"funnel"`
	Subscriptions SubscriptionMetrics `json:"subscriptions"`
	Safety        SafetyMetrics       `json:"safety"`
	Notifications NotificationMetrics `json:"notifications"`
	GeneratedAt   time.Time           `json:"generated_at"`
}
