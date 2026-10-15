package notification

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/auradating/platform/backend/internal/identity"
)

type Service struct {
	repo   Repository
	apns   PushProviderAdapter
	fcm    PushProviderAdapter
	logger *slog.Logger
}

func NewService(repo Repository, apns PushProviderAdapter, fcm PushProviderAdapter, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		repo:   repo,
		apns:   apns,
		fcm:    fcm,
		logger: logger,
	}
}

// SendNotification dispatches a notification respecting consent preferences, quiet hours, and deduplication.
func (s *Service) SendNotification(ctx context.Context, req NotificationRequest) error {
	if strings.TrimSpace(req.RecipientUserID) == "" {
		return errors.New("recipient_user_id is required")
	}

	// 1. Fetch recipient notification preferences
	prefs, err := s.repo.GetPreferences(ctx, req.RecipientUserID)
	if err != nil {
		prefs = &identity.NotificationPreferences{
			MatchesEnabled:          true,
			MessagesEnabled:         true,
			DiscoveryUpdatesEnabled: false,
			BillingAlertsEnabled:    true,
			SecurityAlertsEnabled:   true,
		}
	}

	// 2. Consent Check
	if !s.isCategoryConsented(req.Category, prefs) {
		s.logger.Info("notification_suppressed_by_consent",
			"recipient_user_id", req.RecipientUserID,
			"category", req.Category,
		)
		_ = s.repo.LogNotification(ctx, NotificationLog{
			RecipientUserID: req.RecipientUserID,
			Category:        req.Category,
			Channel:         ChannelInApp,
			Title:           req.Title,
			BodyPreview:     req.BodyPreview,
			DeliveryStatus:  StatusSuppressedConsent,
			EventID:         req.EventID,
			CorrelationID:   req.CorrelationID,
			ErrorDetails:    "User opted out of this notification category",
		})
		return nil
	}

	// 3. Quiet Hours Check (Security alerts bypass quiet hours)
	if req.Category != CategorySecurityAlert && prefs.QuietHoursEnabled {
		currentHour := time.Now().UTC().Hour()
		if IsInQuietHours(currentHour, prefs.QuietHoursStartUTC, prefs.QuietHoursEndUTC) {
			s.logger.Info("notification_suppressed_by_quiet_hours",
				"recipient_user_id", req.RecipientUserID,
				"category", req.Category,
				"utc_hour", currentHour,
			)
			_ = s.repo.LogNotification(ctx, NotificationLog{
				RecipientUserID: req.RecipientUserID,
				Category:        req.Category,
				Channel:         ChannelPushAPNs,
				Title:           req.Title,
				BodyPreview:     req.BodyPreview,
				DeliveryStatus:  StatusSuppressedQuietHours,
				EventID:         req.EventID,
				CorrelationID:   req.CorrelationID,
				ErrorDetails:    fmt.Sprintf("Current UTC hour %d is within quiet hours window (%d:00 - %d:00 UTC)", currentHour, prefs.QuietHoursStartUTC, prefs.QuietHoursEndUTC),
			})
			return nil
		}
	}

	// 4. In-App Notification (with deduplication)
	if req.EventID != "" {
		alreadyLogged, _ := s.repo.IsNotificationLogged(ctx, req.EventID, ChannelInApp)
		if alreadyLogged {
			s.logger.Debug("in_app_notification_duplicate_skipped", "event_id", req.EventID)
			return nil
		}
	}

	_ = s.repo.LogNotification(ctx, NotificationLog{
		RecipientUserID: req.RecipientUserID,
		Category:        req.Category,
		Channel:         ChannelInApp,
		Title:           req.Title,
		BodyPreview:     req.BodyPreview,
		DeliveryStatus:  StatusDelivered,
		EventID:         req.EventID,
		CorrelationID:   req.CorrelationID,
	})

	// 5. Mobile Push Dispatch
	tokens, err := s.repo.ListActivePushTokens(ctx, req.RecipientUserID)
	if err != nil || len(tokens) == 0 {
		return nil
	}

	for _, pt := range tokens {
		channel := ChannelPushFCM
		adapter := s.fcm
		if strings.ToUpper(pt.Platform) == "IOS" {
			channel = ChannelPushAPNs
			adapter = s.apns
		}

		if req.EventID != "" {
			alreadyLogged, _ := s.repo.IsNotificationLogged(ctx, req.EventID, channel)
			if alreadyLogged {
				continue
			}
		}

		if adapter == nil || !adapter.IsConfigured() {
			_ = s.repo.LogNotification(ctx, NotificationLog{
				RecipientUserID: req.RecipientUserID,
				Category:        req.Category,
				Channel:         channel,
				Title:           req.Title,
				BodyPreview:     req.BodyPreview,
				DeliveryStatus:  StatusUnconfigured,
				EventID:         req.EventID,
				CorrelationID:   req.CorrelationID,
				ErrorDetails:    fmt.Sprintf("%s provider credentials not configured in environment", channel),
			})
			continue
		}

		_, status, sendErr := adapter.SendPush(ctx, pt.Token, req.Title, req.BodyPreview, req.Category, req.Metadata)
		if sendErr != nil {
			errText := sendErr.Error()
			if errors.Is(sendErr, ErrTokenInvalid) {
				_ = s.repo.InvalidatePushToken(ctx, pt.Token, errText)
				s.logger.Info("invalid_push_token_deactivated", "user_id", req.RecipientUserID)
			}

			_ = s.repo.LogNotification(ctx, NotificationLog{
				RecipientUserID: req.RecipientUserID,
				Category:        req.Category,
				Channel:         channel,
				Title:           req.Title,
				BodyPreview:     req.BodyPreview,
				DeliveryStatus:  StatusFailed,
				EventID:         req.EventID,
				CorrelationID:   req.CorrelationID,
				ErrorDetails:    errText,
			})
			continue
		}

		_ = s.repo.LogNotification(ctx, NotificationLog{
			RecipientUserID: req.RecipientUserID,
			Category:        req.Category,
			Channel:         channel,
			Title:           req.Title,
			BodyPreview:     req.BodyPreview,
			DeliveryStatus:  status,
			EventID:         req.EventID,
			CorrelationID:   req.CorrelationID,
		})
	}

	return nil
}

func (s *Service) isCategoryConsented(cat Category, prefs *identity.NotificationPreferences) bool {
	switch cat {
	case CategorySecurityAlert:
		return true // Mandatory
	case CategoryMatchCreated:
		return prefs.MatchesEnabled
	case CategoryNewMessage:
		return prefs.MessagesEnabled
	case CategoryDiscoveryNearby:
		return prefs.DiscoveryUpdatesEnabled
	case CategoryBillingAlert:
		return prefs.BillingAlertsEnabled
	default:
		return true
	}
}

func (s *Service) RegisterPushToken(ctx context.Context, userID, token, platform, deviceID string) error {
	normPlatform := strings.ToUpper(strings.TrimSpace(platform))
	if normPlatform != "IOS" && normPlatform != "ANDROID" && normPlatform != "WEB" {
		return fmt.Errorf("invalid platform %q: must be IOS, ANDROID, or WEB", platform)
	}
	if strings.TrimSpace(token) == "" {
		return errors.New("push token cannot be empty")
	}

	return s.repo.RegisterPushToken(ctx, userID, token, normPlatform, deviceID)
}

func (s *Service) GetPreferences(ctx context.Context, userID string) (*identity.NotificationPreferences, error) {
	return s.repo.GetPreferences(ctx, userID)
}

func (s *Service) UpdatePreferences(ctx context.Context, userID string, req UpdatePreferencesRequest) (*identity.NotificationPreferences, error) {
	current, err := s.repo.GetPreferences(ctx, userID)
	if err != nil {
		def := identity.DefaultNotificationPreferences()
		current = &def
	}

	if req.QuietHoursStartUTC != nil && (*req.QuietHoursStartUTC < 0 || *req.QuietHoursStartUTC > 23) {
		return nil, errors.New("quiet_hours_start_utc must be between 0 and 23")
	}
	if req.QuietHoursEndUTC != nil && (*req.QuietHoursEndUTC < 0 || *req.QuietHoursEndUTC > 23) {
		return nil, errors.New("quiet_hours_end_utc must be between 0 and 23")
	}

	req.Apply(current)

	if err := s.repo.UpdatePreferences(ctx, userID, current); err != nil {
		return nil, fmt.Errorf("failed to save notification preferences: %w", err)
	}
	return current, nil
}

func (s *Service) ListNotificationLogs(ctx context.Context, userID string, limit int) ([]NotificationLog, error) {
	return s.repo.ListNotificationLogs(ctx, userID, limit)
}

// IsInQuietHours checks if the given hour falls inside [start, end) handling midnight wraparound.
func IsInQuietHours(hour, start, end int) bool {
	if start == end {
		return false
	}
	if start < end {
		return hour >= start && hour < end
	}
	// Wraparound window (e.g. 22 to 8)
	return hour >= start || hour < end
}
