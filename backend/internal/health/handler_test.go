package health

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type stubProbe struct {
	err error
}

func (s stubProbe) HealthCheck(_ context.Context) error {
	return s.err
}

func TestHandler_Liveness(t *testing.T) {
	h := NewHandler("aura-api", "0.1.0", "local", nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	h.Liveness(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode JSON: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("expected status='ok', got %v", body["status"])
	}
}

func TestHandler_Readiness_HealthyAndDegraded(t *testing.T) {
	healthyProbe := stubProbe{err: nil}
	failingProbe := stubProbe{err: errors.New("connection refused")}

	t.Run("all dependencies healthy returns 200", func(t *testing.T) {
		h := NewHandler("aura-api", "0.1.0", "local", healthyProbe, healthyProbe)
		req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
		rec := httptest.NewRecorder()

		h.Readiness(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK when probes pass, got %d", rec.Code)
		}
	})

	t.Run("unhealthy dependency returns 503 Service Unavailable", func(t *testing.T) {
		h := NewHandler("aura-api", "0.1.0", "local", failingProbe, healthyProbe)
		req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
		rec := httptest.NewRecorder()

		h.Readiness(rec, req)

		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503 Service Unavailable when Postgres fails, got %d", rec.Code)
		}

		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("failed to decode JSON: %v", err)
		}
		if body["status"] != "degraded" {
			t.Errorf("expected status='degraded', got %v", body["status"])
		}
	})
}
