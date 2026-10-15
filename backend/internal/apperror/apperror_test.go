package apperror

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWriteError_SerializesStandardEnvelope(t *testing.T) {
	rec := httptest.NewRecorder()
	apiErr := NewValidation(map[string]string{
		"birthdate": "Member must be at least 18 years old",
	})

	WriteError(rec, "req-12345", apiErr)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rec.Code)
	}

	var env ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("failed to decode JSON error response: %v", err)
	}

	if env.Error.Code != CodeValidationFailed {
		t.Errorf("expected code %s, got %s", CodeValidationFailed, env.Error.Code)
	}
	if env.Error.RequestID != "req-12345" {
		t.Errorf("expected request_id req-12345, got %s", env.Error.RequestID)
	}
	if env.Error.Fields["birthdate"] == "" {
		t.Errorf("expected birthdate validation error, got %+v", env.Error.Fields)
	}
}
