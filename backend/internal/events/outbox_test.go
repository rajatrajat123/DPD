package events

import (
	"testing"
	"time"
)

func TestNewEnvelope_ValidationAndSerialization(t *testing.T) {
	payload := map[string]string{
		"asset_id": "11111111-1111-4111-8111-111111111111",
		"purpose":  "PROFILE_PHOTO",
	}

	env, err := NewEnvelope("media_asset", "11111111-1111-4111-8111-111111111111", "media.asset.uploaded.v1", "req-123", 1, payload)
	if err != nil {
		t.Fatalf("unexpected error creating envelope: %v", err)
	}
	if env.ID == "" {
		t.Errorf("expected non-empty event ID")
	}
	if env.EventType != "media.asset.uploaded.v1" {
		t.Errorf("unexpected event type: %s", env.EventType)
	}
	if len(env.Payload) == 0 {
		t.Errorf("expected serialized JSON payload")
	}

	if _, err := NewEnvelope("", "id", "evt.v1", "", 1, payload); err == nil {
		t.Errorf("expected error for empty aggregate_type")
	}
	if _, err := NewEnvelope("agg", "", "evt.v1", "", 1, payload); err == nil {
		t.Errorf("expected error for empty aggregate_id")
	}
	if _, err := NewEnvelope("agg", "id", "", "", 1, payload); err == nil {
		t.Errorf("expected error for empty event_type")
	}
	if _, err := NewEnvelope("agg", "id", "evt.v1", "", 0, payload); err == nil {
		t.Errorf("expected error for schema_version < 1")
	}
}

func TestNextRetryDelay(t *testing.T) {
	base := 2 * time.Second
	max := 30 * time.Second

	if got := NextRetryDelay(1, base, max); got != 2*time.Second {
		t.Errorf("attempt 1: expected 2s, got %v", got)
	}
	if got := NextRetryDelay(2, base, max); got != 4*time.Second {
		t.Errorf("attempt 2: expected 4s, got %v", got)
	}
	if got := NextRetryDelay(3, base, max); got != 8*time.Second {
		t.Errorf("attempt 3: expected 8s, got %v", got)
	}
	if got := NextRetryDelay(10, base, max); got != max {
		t.Errorf("attempt 10: expected capped max %v, got %v", max, got)
	}
}
