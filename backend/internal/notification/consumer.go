package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
)

type EventConsumer struct {
	notifSvc *Service
	logger   *slog.Logger
}

func NewEventConsumer(notifSvc *Service, logger *slog.Logger) *EventConsumer {
	if logger == nil {
		logger = slog.Default()
	}
	return &EventConsumer{
		notifSvc: notifSvc,
		logger:   logger,
	}
}

// HandleEvent parses and routes domain events to privacy-safe notifications.
func (c *EventConsumer) HandleEvent(ctx context.Context, eventType, eventID, correlationID, payload string) error {
	switch eventType {
	case "match.created.v1":
		return c.handleMatchCreated(ctx, eventID, correlationID, payload)
	case "messaging.message.sent.v1":
		return c.handleMessageSent(ctx, eventID, correlationID, payload)
	case "billing.subscription_renewed.v1":
		return c.handleBillingRenewed(ctx, eventID, correlationID, payload)
	case "discovery.nearby_summary.v1":
		return c.handleNearbySummary(ctx, eventID, correlationID, payload)
	default:
		c.logger.Debug("unhandled_event_type_for_notifications", "event_type", eventType)
		return nil
	}
}

type matchCreatedPayload struct {
	MatchID    string `json:"match_id"`
	UserLowID  string `json:"user_low_id"`
	UserHighID string `json:"user_high_id"`
}

func (c *EventConsumer) handleMatchCreated(ctx context.Context, eventID, correlationID, payload string) error {
	var p matchCreatedPayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return fmt.Errorf("failed to parse match.created payload: %w", err)
	}

	title := "New Match on Aura!"
	body := "You have a new mutual match waiting for you."

	// Deliver to both participants
	if p.UserLowID != "" {
		_ = c.notifSvc.SendNotification(ctx, NotificationRequest{
			RecipientUserID: p.UserLowID,
			Category:        CategoryMatchCreated,
			Title:           title,
			BodyPreview:     body,
			EventID:         fmt.Sprintf("%s-low", eventID),
			CorrelationID:   correlationID,
			Metadata:        map[string]string{"match_id": p.MatchID},
		})
	}

	if p.UserHighID != "" {
		_ = c.notifSvc.SendNotification(ctx, NotificationRequest{
			RecipientUserID: p.UserHighID,
			Category:        CategoryMatchCreated,
			Title:           title,
			BodyPreview:     body,
			EventID:         fmt.Sprintf("%s-high", eventID),
			CorrelationID:   correlationID,
			Metadata:        map[string]string{"match_id": p.MatchID},
		})
	}

	return nil
}

type messageSentPayload struct {
	RecipientID string `json:"recipient_id"`
	SenderName  string `json:"sender_name"`
	MessageID   string `json:"message_id"`
}

func (c *EventConsumer) handleMessageSent(ctx context.Context, eventID, correlationID, payload string) error {
	var p messageSentPayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return fmt.Errorf("failed to parse message.sent payload: %w", err)
	}

	sender := strings.TrimSpace(p.SenderName)
	if sender == "" {
		sender = "your match"
	}

	// Lock-screen push payload NEVER includes raw message body (privacy invariant)
	title := "New message on Aura"
	body := fmt.Sprintf("You have a new message from %s", sender)

	return c.notifSvc.SendNotification(ctx, NotificationRequest{
		RecipientUserID: p.RecipientID,
		Category:        CategoryNewMessage,
		Title:           title,
		BodyPreview:     body,
		EventID:         eventID,
		CorrelationID:   correlationID,
		Metadata:        map[string]string{"message_id": p.MessageID},
	})
}

type billingRenewedPayload struct {
	UserID string `json:"user_id"`
	Tier   string `json:"tier"`
}

func (c *EventConsumer) handleBillingRenewed(ctx context.Context, eventID, correlationID, payload string) error {
	var p billingRenewedPayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return fmt.Errorf("failed to parse billing payload: %w", err)
	}

	return c.notifSvc.SendNotification(ctx, NotificationRequest{
		RecipientUserID: p.UserID,
		Category:        CategoryBillingAlert,
		Title:           "Subscription Renewed",
		BodyPreview:     "Your Aura membership has been successfully renewed.",
		EventID:         eventID,
		CorrelationID:   correlationID,
	})
}

type nearbySummaryPayload struct {
	UserID string `json:"user_id"`
}

func (c *EventConsumer) handleNearbySummary(ctx context.Context, eventID, correlationID, payload string) error {
	var p nearbySummaryPayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return fmt.Errorf("failed to parse nearby summary payload: %w", err)
	}

	return c.notifSvc.SendNotification(ctx, NotificationRequest{
		RecipientUserID: p.UserID,
		Category:        CategoryDiscoveryNearby,
		Title:           "Discovery Update",
		BodyPreview:     "New people matching your preferences are active nearby.",
		EventID:         eventID,
		CorrelationID:   correlationID,
	})
}
