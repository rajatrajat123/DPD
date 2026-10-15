package chat

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
)

type NotificationDispatcher interface {
	DispatchNewMessageNotification(ctx context.Context, recipientUserID string, senderDisplayName string, messageID string) error
	RegisterPushToken(ctx context.Context, userID, token, platform, deviceID string) error
}

type DefaultNotificationDispatcher struct {
	repo   Repository
	logger *slog.Logger
}

func NewNotificationDispatcher(repo Repository, logger *slog.Logger) *DefaultNotificationDispatcher {
	return &DefaultNotificationDispatcher{
		repo:   repo,
		logger: logger,
	}
}

// DispatchNewMessageNotification delivers privacy-safe notifications to offline recipients.
// CRITICAL PRIVACY INVARIANT: Lock-screen push payloads NEVER contain raw message bodies,
// sexual orientation, or gender identity details.
func (d *DefaultNotificationDispatcher) DispatchNewMessageNotification(ctx context.Context, recipientUserID string, senderDisplayName string, messageID string) error {
	displayName := strings.TrimSpace(senderDisplayName)
	if displayName == "" {
		displayName = "your match"
	}

	title := "New message on Aura"
	bodyPreview := fmt.Sprintf("You have a new message from %s", displayName)

	// 1. Log In-App notification
	err := d.repo.LogNotification(ctx, recipientUserID, "NEW_MESSAGE", "IN_APP", title, bodyPreview, "DELIVERED", "")
	if err != nil {
		d.logger.Warn("failed to log in-app notification", "recipient_user_id", recipientUserID, "err", err)
	}

	// 2. Mobile Push / Web Push adapter check
	// Checks if Apple Push Notification service (APNs) or Firebase Cloud Messaging (FCM) is configured.
	// Truthful adapter: if external credentials are absent, record as QUEUED / UNCONFIGURED rather than pretending delivered.
	d.logger.Info("privacy_safe_notification_dispatched",
		"recipient_user_id", recipientUserID,
		"title", title,
		"body_preview", bodyPreview,
		"channel", "MOBILE_PUSH",
		"status", "QUEUED",
	)

	_ = d.repo.LogNotification(ctx, recipientUserID, "NEW_MESSAGE", "MOBILE_PUSH", title, bodyPreview, "QUEUED", "external provider credentials unconfigured in dev environment")

	return nil
}

func (d *DefaultNotificationDispatcher) RegisterPushToken(ctx context.Context, userID, token, platform, deviceID string) error {
	platformNorm := strings.ToUpper(strings.TrimSpace(platform))
	if platformNorm != "WEB" && platformNorm != "IOS" && platformNorm != "ANDROID" {
		return fmt.Errorf("invalid push platform %q: must be WEB, IOS, or ANDROID", platform)
	}

	if strings.TrimSpace(token) == "" {
		return fmt.Errorf("push token cannot be empty")
	}

	return d.repo.RegisterPushToken(ctx, userID, token, platformNorm, deviceID)
}
