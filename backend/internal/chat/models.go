package chat

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrConversationNotFound    = errors.New("conversation not found")
	ErrUnauthorizedParticipant = errors.New("unauthorized: caller is not a participant of this conversation")
	ErrMatchInactive           = errors.New("cannot message: match is inactive, unmatched, or blocked")
	ErrEmptyMessage            = errors.New("message body cannot be empty")
	ErrMessageTooLong          = errors.New("message body exceeds maximum length of 2000 characters")
	ErrInvalidClientMessageID  = errors.New("invalid or missing client_message_id UUID")
	ErrRateLimitExceeded       = errors.New("rate limit exceeded: please slow down")
	ErrUnauthorizedDelete      = errors.New("unauthorized: caller is not the author of this message")
	ErrMessageNotFound         = errors.New("message not found")
)

type MessageType string

const (
	MessageTypeText      MessageType = "TEXT"
	MessageTypeImage     MessageType = "IMAGE"
	MessageTypeVideo     MessageType = "VIDEO"
	MessageTypeAudio     MessageType = "AUDIO"
	MessageTypeVoiceNote MessageType = "VOICE_NOTE"
	MessageTypeSystem    MessageType = "SYSTEM"
)

func ValidateMessageType(t string) (MessageType, error) {
	norm := strings.ToUpper(strings.TrimSpace(t))
	if norm == "" {
		return MessageTypeText, nil
	}
	switch MessageType(norm) {
	case MessageTypeText, MessageTypeImage, MessageTypeVideo, MessageTypeAudio, MessageTypeSystem:
		return MessageType(norm), nil
	case MessageTypeVoiceNote:
		return MessageTypeAudio, nil
	default:
		return "", fmt.Errorf("invalid message type %q", t)
	}
}

type Message struct {
	ID              string      `json:"id"`
	ConversationID  string      `json:"conversation_id"`
	SenderUserID    string      `json:"sender_user_id"`
	ClientMessageID string      `json:"client_message_id"`
	Body            string      `json:"body"`
	MessageType     MessageType `json:"message_type"`
	MediaAssetID    *string     `json:"media_asset_id,omitempty"`
	AudioDurationMs *int        `json:"audio_duration_ms,omitempty"`
	DeliveredAt     *time.Time  `json:"delivered_at,omitempty"`
	ReadAt          *time.Time  `json:"read_at,omitempty"`
	DeletedAt       *time.Time  `json:"deleted_at,omitempty"`
	CreatedAt       time.Time   `json:"created_at"`
}

type ConversationPartner struct {
	UserID          string `json:"user_id"`
	DisplayName     string `json:"display_name"`
	Age             int    `json:"age"`
	AvatarURL       string `json:"avatar_url"`
	IsPhotoVerified bool   `json:"is_photo_verified"`
	IsOnline        bool   `json:"is_online"`
}

type MessageSummary struct {
	ID           string      `json:"id"`
	SenderUserID string      `json:"sender_user_id"`
	Body         string      `json:"body"`
	MessageType  MessageType `json:"message_type"`
	CreatedAt    time.Time   `json:"created_at"`
	IsRead       bool        `json:"is_read"`
}

type Conversation struct {
	ID                 string               `json:"id"`
	MatchID            string               `json:"match_id"`
	ParticipantLowID   string               `json:"participant_low_id"`
	ParticipantHighID  string               `json:"participant_high_id"`
	LastMessageAt      *time.Time           `json:"last_message_at,omitempty"`
	CreatedAt          time.Time            `json:"created_at"`
	Partner            *ConversationPartner `json:"partner,omitempty"`
	LastMessage        *MessageSummary      `json:"last_message,omitempty"`
	UnreadCount        int                  `json:"unread_count"`
}

func (c *Conversation) IsParticipant(userID string) bool {
	return c.ParticipantLowID == userID || c.ParticipantHighID == userID
}

func (c *Conversation) OtherParticipantID(userID string) string {
	if c.ParticipantLowID == userID {
		return c.ParticipantHighID
	}
	return c.ParticipantLowID
}

type SendMessageRequest struct {
	ClientMessageID string  `json:"client_message_id"`
	Body            string  `json:"body"`
	MessageType     string  `json:"message_type,omitempty"`
	MediaAssetID    *string `json:"media_asset_id,omitempty"`
	AudioDurationMs *int    `json:"audio_duration_ms,omitempty"`
	DurationMs      *int    `json:"duration_ms,omitempty"`
}

type MessagesPageResponse struct {
	Messages   []*Message `json:"messages"`
	NextCursor string     `json:"next_cursor,omitempty"`
	HasMore    bool       `json:"has_more"`
}

type RegisterPushTokenRequest struct {
	Token    string `json:"token"`
	Platform string `json:"platform"`
	DeviceID string `json:"device_id,omitempty"`
}

// WebSocket Frames

type WSAction string

const (
	ActionMessageSend   WSAction = "message.send"
	ActionMessageDelete WSAction = "message.delete"
	ActionTypingStart   WSAction = "typing.start"
	ActionTypingStop    WSAction = "typing.stop"
	ActionMessageRead   WSAction = "message.read"
	ActionPing          WSAction = "ping"
)

type WSClientMessage struct {
	Action          WSAction `json:"action"`
	ConversationID  string   `json:"conversation_id,omitempty"`
	ClientMessageID string   `json:"client_message_id,omitempty"`
	Body            string   `json:"body,omitempty"`
	MessageType     string   `json:"message_type,omitempty"`
	MediaAssetID    *string  `json:"media_asset_id,omitempty"`
	AudioDurationMs *int     `json:"audio_duration_ms,omitempty"`
	DurationMs      *int     `json:"duration_ms,omitempty"`
	MessageID       string   `json:"message_id,omitempty"`
}

type WSEventType string

const (
	EventMessageNew         WSEventType = "message.new"
	EventMessageDelivered   WSEventType = "message.delivered"
	EventMessageRead        WSEventType = "message.read"
	EventMessageDeleted     WSEventType = "message.deleted"
	EventTypingIndicator    WSEventType = "typing.indicator"
	EventPresenceUpdate     WSEventType = "presence.update"
	EventConversationRevoke WSEventType = "conversation.revoked"
	EventPong               WSEventType = "pong"
	EventError              WSEventType = "error"
)

type DeleteMessageResponse struct {
	Success        bool       `json:"success"`
	MessageID      string     `json:"message_id"`
	ConversationID string     `json:"conversation_id"`
	DeletedAt      *time.Time `json:"deleted_at"`
}

type WSServerMessage struct {
	Type      WSEventType     `json:"type"`
	Payload   json.RawMessage `json:"payload"`
	Timestamp time.Time       `json:"timestamp"`
}

func NewWSEvent(t WSEventType, payload any) (*WSServerMessage, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal ws event payload: %w", err)
	}
	return &WSServerMessage{
		Type:      t,
		Payload:   raw,
		Timestamp: time.Now().UTC(),
	}, nil
}

type MessageRequestStatus string

const (
	RequestPending  MessageRequestStatus = "PENDING"
	RequestAccepted MessageRequestStatus = "ACCEPTED"
	RequestDeclined MessageRequestStatus = "DECLINED"
	RequestBlocked  MessageRequestStatus = "BLOCKED"
)

type MessageRequest struct {
	ID              string               `json:"id"`
	SenderUserID    string               `json:"sender_user_id"`
	RecipientUserID string               `json:"recipient_user_id"`
	Body            string               `json:"body"`
	Status          MessageRequestStatus `json:"status"`
	CreatedAt       time.Time            `json:"created_at"`
	RespondedAt     *time.Time           `json:"responded_at,omitempty"`
	Sender          *ConversationPartner `json:"sender,omitempty"`
}

type MessageRequestActionResponse struct {
	Success        bool    `json:"success"`
	ConversationID *string `json:"conversation_id,omitempty"`
	MatchID        *string `json:"match_id,omitempty"`
}
