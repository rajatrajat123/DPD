package events

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"
)

// Status represents the lifecycle state of a transactional outbox event.
type Status string

const (
	StatusPending    Status = "PENDING"
	StatusProcessing Status = "PROCESSING"
	StatusPublished  Status = "PUBLISHED"
	StatusDeadLetter Status = "DEAD_LETTER"
)

// Envelope represents the canonical Aura domain event structure persisted in outbox_events.
type Envelope struct {
	ID            string          `json:"event_id"`
	AggregateType string          `json:"aggregate_type"`
	AggregateID   string          `json:"aggregate_id"`
	EventType     string          `json:"event_type"`
	SchemaVersion int             `json:"schema_version"`
	OccurredAt    time.Time       `json:"occurred_at"`
	CorrelationID string          `json:"correlation_id,omitempty"`
	Payload       json.RawMessage `json:"payload"`
}

// Publisher defines the interface for writing domain events within a database transaction.
type Publisher interface {
	Publish(ctx context.Context, env Envelope) error
}

// NewEnvelope constructs and validates a domain event envelope with a JSON payload.
func NewEnvelope(aggregateType, aggregateID, eventType, correlationID string, schemaVersion int, payload any) (Envelope, error) {
	if strings.TrimSpace(aggregateType) == "" {
		return Envelope{}, fmt.Errorf("aggregate_type is required")
	}
	if strings.TrimSpace(aggregateID) == "" {
		return Envelope{}, fmt.Errorf("aggregate_id is required")
	}
	if strings.TrimSpace(eventType) == "" {
		return Envelope{}, fmt.Errorf("event_type is required")
	}
	if schemaVersion < 1 {
		return Envelope{}, fmt.Errorf("schema_version must be >= 1")
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		return Envelope{}, fmt.Errorf("failed to marshal event payload: %w", err)
	}

	return Envelope{
		ID:            generateEventID(),
		AggregateType: strings.TrimSpace(aggregateType),
		AggregateID:   strings.TrimSpace(aggregateID),
		EventType:     strings.TrimSpace(eventType),
		SchemaVersion: schemaVersion,
		OccurredAt:    time.Now().UTC(),
		CorrelationID: strings.TrimSpace(correlationID),
		Payload:       raw,
	}, nil
}

// NextRetryDelay calculates the exponential backoff duration for failed outbox deliveries.
// Formula: min(MaxDelay, BaseDelay * 2^(attempt-1))
func NextRetryDelay(attempt int, baseDelay, maxDelay time.Duration) time.Duration {
	if attempt <= 1 {
		return baseDelay
	}
	if baseDelay <= 0 {
		baseDelay = time.Second
	}
	if maxDelay <= 0 {
		maxDelay = 15 * time.Minute
	}

	multiplier := math.Pow(2, float64(attempt-1))
	calculated := time.Duration(float64(baseDelay) * multiplier)
	if calculated > maxDelay || calculated < 0 {
		return maxDelay
	}
	return calculated
}

func generateEventID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("evt_%d", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	)
}
