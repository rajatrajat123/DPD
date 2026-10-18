package chat

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/auradating/platform/backend/internal/identity"
)

type Service struct {
	repo         Repository
	hub          *Hub
	notif        NotificationDispatcher
	identRepo    identity.Repository
	logger       *slog.Logger
	jwtSecret    string
}

func NewService(
	repo Repository,
	hub *Hub,
	notif NotificationDispatcher,
	identRepo identity.Repository,
	jwtSecret string,
	logger *slog.Logger,
) *Service {
	s := &Service{
		repo:      repo,
		hub:       hub,
		notif:     notif,
		identRepo: identRepo,
		jwtSecret: jwtSecret,
		logger:    logger,
	}

	// Connect Hub inbound frames to Service
	hub.SetActionHandler(func(client *Client, action WSClientMessage) {
		s.handleClientWSAction(client, action)
	})

	return s
}

func (s *Service) Hub() *Hub {
	return s.hub
}

// SendMessage persists a new message, delivers it via WebSocket if recipient is online,
// or queues a privacy-safe notification if recipient is offline.
func (s *Service) SendMessage(ctx context.Context, senderUserID string, conversationID string, req SendMessageRequest) (*Message, error) {
	// 1. Validate inputs
	clientMsgID := strings.TrimSpace(req.ClientMessageID)
	if clientMsgID == "" {
		return nil, ErrInvalidClientMessageID
	}

	body := strings.TrimSpace(req.Body)
	if len(body) == 0 && req.MediaAssetID == nil {
		return nil, ErrEmptyMessage
	}
	if len(body) > 2000 {
		return nil, ErrMessageTooLong
	}

	msgType, err := ValidateMessageType(req.MessageType)
	if err != nil {
		return nil, err
	}
	if req.MediaAssetID != nil && strings.TrimSpace(req.MessageType) == "" {
		msgType = MessageTypeImage
	}

	// 2. Validate conversation membership & active match eligibility
	conv, err := s.repo.GetConversation(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	if !conv.IsParticipant(senderUserID) {
		return nil, ErrUnauthorizedParticipant
	}

	eligible, err := s.repo.CheckActiveMatchEligibility(ctx, conversationID, senderUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to verify match eligibility: %w", err)
	}
	if !eligible {
		return nil, ErrMatchInactive
	}

	// 3. Persist message idempotently
	var audioDuration *int
	if req.AudioDurationMs != nil {
		audioDuration = req.AudioDurationMs
	} else if req.DurationMs != nil {
		audioDuration = req.DurationMs
	}

	msg := &Message{
		ConversationID:  conversationID,
		SenderUserID:    senderUserID,
		ClientMessageID: clientMsgID,
		Body:            body,
		MessageType:     msgType,
		MediaAssetID:    req.MediaAssetID,
		AudioDurationMs: audioDuration,
	}

	saved, isDuplicate, err := s.repo.SaveMessage(ctx, msg)
	if err != nil {
		return nil, fmt.Errorf("failed to save message: %w", err)
	}

	if saved.AudioDurationMs == nil && audioDuration != nil {
		saved.AudioDurationMs = audioDuration
	}

	if isDuplicate {
		return saved, nil
	}

	// 4. Real-time delivery
	recipientID := conv.OtherParticipantID(senderUserID)
	event, err := NewWSEvent(EventMessageNew, saved)
	if err == nil {
		delivered := s.hub.DeliverToUser(recipientID, event)
		if delivered {
			_ = s.repo.MarkMessageDelivered(ctx, saved.ID)
			now := time.Now().UTC()
			saved.DeliveredAt = &now
		} else {
			// Recipient is offline -> dispatch privacy-safe offline notification
			senderName := "Aura Member"
			if s.identRepo != nil {
				if senderProfile, pErr := s.identRepo.GetProfile(ctx, senderUserID); pErr == nil && senderProfile != nil {
					senderName = senderProfile.DisplayName
				}
			}
			_ = s.notif.DispatchNewMessageNotification(ctx, recipientID, senderName, saved.ID)
		}
	}

	// 5. Acknowledge delivery to sender's active connections
	ackEvent, _ := NewWSEvent(EventMessageDelivered, map[string]any{
		"message_id":        saved.ID,
		"client_message_id": saved.ClientMessageID,
		"delivered_at":      saved.DeliveredAt,
	})
	if ackEvent != nil {
		s.hub.DeliverToUser(senderUserID, ackEvent)
	}

	return saved, nil
}

// ListConversations returns all active match threads for the user, enriched with partner profile and online status.
func (s *Service) ListConversations(ctx context.Context, userID string) ([]*Conversation, error) {
	convs, err := s.repo.ListConversationsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	for _, c := range convs {
		otherID := c.OtherParticipantID(userID)
		partner := &ConversationPartner{
			UserID:   otherID,
			IsOnline: s.hub.IsUserOnline(otherID),
		}

		if s.identRepo != nil {
			if prof, err := s.identRepo.GetProfile(ctx, otherID); err == nil && prof != nil {
				partner.DisplayName = prof.DisplayName
				if !prof.Birthdate.IsZero() {
					partner.Age = int(time.Since(prof.Birthdate).Hours() / 24 / 365.25)
				}
				partner.IsPhotoVerified = prof.IsPhotoVerified
			}
		}
		c.Partner = partner
	}

	return convs, nil
}

// GetMessages retrieves a cursor-paginated slice of messages for a conversation.
func (s *Service) GetMessages(ctx context.Context, conversationID, requesterUserID string, beforeID string, limit int) (*MessagesPageResponse, error) {
	conv, err := s.repo.GetConversation(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	if !conv.IsParticipant(requesterUserID) {
		return nil, ErrUnauthorizedParticipant
	}

	eligible, err := s.repo.CheckActiveMatchEligibility(ctx, conversationID, requesterUserID)
	if err != nil || !eligible {
		return nil, ErrMatchInactive
	}

	msgs, nextCursor, hasMore, err := s.repo.ListMessages(ctx, conversationID, beforeID, limit)
	if err != nil {
		return nil, err
	}

	return &MessagesPageResponse{
		Messages:   msgs,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

// MarkRead marks unread incoming messages as read and informs the sender via WebSocket.
func (s *Service) MarkRead(ctx context.Context, conversationID, readerUserID string) error {
	conv, err := s.repo.GetConversation(ctx, conversationID)
	if err != nil {
		return err
	}
	if !conv.IsParticipant(readerUserID) {
		return ErrUnauthorizedParticipant
	}

	count, err := s.repo.MarkMessagesRead(ctx, conversationID, readerUserID)
	if err != nil {
		return err
	}

	if count > 0 {
		otherID := conv.OtherParticipantID(readerUserID)
		readEvent, _ := NewWSEvent(EventMessageRead, map[string]any{
			"conversation_id": conversationID,
			"reader_user_id":  readerUserID,
			"read_at":         time.Now().UTC(),
		})
		if readEvent != nil {
			s.hub.DeliverToUser(otherID, readEvent)
		}
	}

	return nil
}

// RegisterPushToken associates a device push token with the user.
func (s *Service) RegisterPushToken(ctx context.Context, userID, token, platform, deviceID string) error {
	return s.notif.RegisterPushToken(ctx, userID, token, platform, deviceID)
}

// handleClientWSAction processes inbound WebSocket frames from an authenticated connection.
func (s *Service) handleClientWSAction(client *Client, action WSClientMessage) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	switch action.Action {
	case ActionMessageSend:
		req := SendMessageRequest{
			ClientMessageID: action.ClientMessageID,
			Body:            action.Body,
			MessageType:     action.MessageType,
			MediaAssetID:    action.MediaAssetID,
			AudioDurationMs: action.AudioDurationMs,
			DurationMs:      action.DurationMs,
		}
		_, err := s.SendMessage(ctx, client.userID, action.ConversationID, req)
		if err != nil {
			errEvent, _ := NewWSEvent(EventError, map[string]string{
				"code":    "SEND_FAILED",
				"message": err.Error(),
			})
			if errEvent != nil {
				s.hub.DeliverToUser(client.userID, errEvent)
			}
		}

	case ActionTypingStart, ActionTypingStop:
		conv, err := s.repo.GetConversation(ctx, action.ConversationID)
		if err != nil || !conv.IsParticipant(client.userID) {
			return
		}
		eligible, _ := s.repo.CheckActiveMatchEligibility(ctx, action.ConversationID, client.userID)
		if !eligible {
			return
		}

		isTyping := action.Action == ActionTypingStart
		recipientID := conv.OtherParticipantID(client.userID)
		typingEvent, _ := NewWSEvent(EventTypingIndicator, map[string]any{
			"conversation_id": action.ConversationID,
			"user_id":         client.userID,
			"is_typing":       isTyping,
		})
		if typingEvent != nil {
			s.hub.DeliverToUser(recipientID, typingEvent)
		}

	case ActionMessageRead:
		_ = s.MarkRead(ctx, action.ConversationID, client.userID)
	}
}

func (s *Service) ListMessageRequests(ctx context.Context, userID string) ([]*MessageRequest, error) {
	return s.repo.ListMessageRequests(ctx, userID)
}

func (s *Service) AcceptMessageRequest(ctx context.Context, requestID, recipientID string) (*MessageRequestActionResponse, error) {
	convID, matchID, err := s.repo.AcceptMessageRequest(ctx, requestID, recipientID)
	if err != nil {
		return nil, err
	}
	return &MessageRequestActionResponse{
		Success:        true,
		ConversationID: &convID,
		MatchID:        &matchID,
	}, nil
}

func (s *Service) DeclineMessageRequest(ctx context.Context, requestID, recipientID string) error {
	return s.repo.DeclineMessageRequest(ctx, requestID, recipientID)
}

func (s *Service) BlockMessageRequest(ctx context.Context, requestID, recipientID string) error {
	return s.repo.BlockMessageRequest(ctx, requestID, recipientID)
}
