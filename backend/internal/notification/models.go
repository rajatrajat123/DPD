package notification

import (
	"time"

	"github.com/auradating/platform/backend/internal/identity"
)

type Category string

const (
	CategoryMatchCreated     Category = "MATCH_CREATED"
	CategoryNewMessage       Category = "NEW_MESSAGE"
	CategoryDiscoveryNearby  Category = "DISCOVERY_NEARBY"
	CategoryBillingAlert     Category = "BILLING_ALERT"
	CategorySecurityAlert    Category = "SECURITY_ALERT"
)

type Channel string

const (
	ChannelInApp    Channel = "IN_APP"
	ChannelPushAPNs Channel = "PUSH_APNS"
	ChannelPushFCM  Channel = "PUSH_FCM"
	ChannelEmail    Channel = "EMAIL"
)

type DeliveryStatus string

const (
	StatusDelivered             DeliveryStatus = "DELIVERED"
	StatusQueued                DeliveryStatus = "QUEUED"
	StatusUnconfigured          DeliveryStatus = "UNCONFIGURED"
	StatusSuppressedConsent     DeliveryStatus = "SUPPRESSED_CONSENT"
	StatusSuppressedQuietHours  DeliveryStatus = "SUPPRESSED_QUIET_HOURS"
	StatusDuplicateSkipped      DeliveryStatus = "DUPLICATE_SKIPPED"
	StatusFailed                DeliveryStatus = "FAILED"
)

type NotificationRequest struct {
	RecipientUserID string            `json:"recipient_user_id"`
	Category        Category          `json:"category"`
	Title           string            `json:"title"`
	BodyPreview     string            `json:"body_preview"`
	EventID         string            `json:"event_id,omitempty"`
	CorrelationID   string            `json:"correlation_id,omitempty"`
	Metadata        map[string]string `json:"metadata,omitempty"`
}

type PushToken struct {
	ID        string     `json:"id"`
	UserID    string     `json:"user_id"`
	Token     string     `json:"token"`
	Platform  string     `json:"platform"` // IOS, ANDROID, WEB
	DeviceID  string     `json:"device_id,omitempty"`
	IsActive  bool       `json:"is_active"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

type NotificationLog struct {
	ID              string         `json:"id"`
	RecipientUserID string         `json:"recipient_user_id"`
	Category        Category       `json:"category"`
	Channel         Channel        `json:"channel"`
	Title           string         `json:"title"`
	BodyPreview     string         `json:"body_preview"`
	DeliveryStatus  DeliveryStatus `json:"delivery_status"`
	ErrorDetails    string         `json:"error_details,omitempty"`
	EventID         string         `json:"event_id,omitempty"`
	CorrelationID   string         `json:"correlation_id,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
}

type RegisterPushTokenRequest struct {
	Token    string `json:"token"`
	Platform string `json:"platform"` // IOS, ANDROID, WEB
	DeviceID string `json:"device_id,omitempty"`
}

type UpdatePreferencesRequest struct {
	MatchesEnabled          *bool `json:"matches_enabled,omitempty"`
	MessagesEnabled         *bool `json:"messages_enabled,omitempty"`
	DiscoveryUpdatesEnabled *bool `json:"discovery_updates_enabled,omitempty"`
	BillingAlertsEnabled    *bool `json:"billing_alerts_enabled,omitempty"`
	SecurityAlertsEnabled   *bool `json:"security_alerts_enabled,omitempty"`
	QuietHoursEnabled       *bool `json:"quiet_hours_enabled,omitempty"`
	QuietHoursStartUTC      *int  `json:"quiet_hours_start_utc,omitempty"`
	QuietHoursEndUTC        *int  `json:"quiet_hours_end_utc,omitempty"`
}

func (r *UpdatePreferencesRequest) Apply(current *identity.NotificationPreferences) {
	if r.MatchesEnabled != nil {
		current.MatchesEnabled = *r.MatchesEnabled
	}
	if r.MessagesEnabled != nil {
		current.MessagesEnabled = *r.MessagesEnabled
	}
	if r.DiscoveryUpdatesEnabled != nil {
		current.DiscoveryUpdatesEnabled = *r.DiscoveryUpdatesEnabled
	}
	if r.BillingAlertsEnabled != nil {
		current.BillingAlertsEnabled = *r.BillingAlertsEnabled
	}
	if r.SecurityAlertsEnabled != nil {
		current.SecurityAlertsEnabled = *r.SecurityAlertsEnabled
	}
	if r.QuietHoursEnabled != nil {
		current.QuietHoursEnabled = *r.QuietHoursEnabled
	}
	if r.QuietHoursStartUTC != nil {
		current.QuietHoursStartUTC = *r.QuietHoursStartUTC
	}
	if r.QuietHoursEndUTC != nil {
		current.QuietHoursEndUTC = *r.QuietHoursEndUTC
	}
}
