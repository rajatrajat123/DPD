package validator

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/auradating/platform/backend/internal/apperror"
)

type sampleRequest struct {
	Email string `json:"email"`
	Age   int    `json:"age"`
}

func (s *sampleRequest) Validate() map[string]string {
	errs := make(map[string]string)
	if !strings.Contains(s.Email, "@") {
		errs["email"] = "must be a valid email address"
	}
	if s.Age < 18 {
		errs["age"] = "member must be 18 or older"
	}
	return errs
}

func TestDecodeAndValidate_Success(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/test", strings.NewReader(`{"email":"alex@example.com","age":24}`))
	rec := httptest.NewRecorder()
	var dto sampleRequest

	apiErr := DecodeAndValidate(rec, req, 1024, &dto)
	if apiErr != nil {
		t.Fatalf("expected no error, got %+v", apiErr)
	}
	if dto.Email != "alex@example.com" || dto.Age != 24 {
		t.Errorf("unexpected decoded values: %+v", dto)
	}
}

func TestDecodeAndValidate_RejectsUnknownFields(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/test", strings.NewReader(`{"email":"alex@example.com","age":24,"isAdmin":true}`))
	rec := httptest.NewRecorder()
	var dto sampleRequest

	apiErr := DecodeAndValidate(rec, req, 1024, &dto)
	if apiErr == nil || apiErr.Code != apperror.CodeInvalidRequest {
		t.Fatalf("expected CodeInvalidRequest on unknown field, got %+v", apiErr)
	}
}

func TestDecodeAndValidate_EnforcesFieldRules(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/test", strings.NewReader(`{"email":"invalid","age":16}`))
	rec := httptest.NewRecorder()
	var dto sampleRequest

	apiErr := DecodeAndValidate(rec, req, 1024, &dto)
	if apiErr == nil || apiErr.Code != apperror.CodeValidationFailed {
		t.Fatalf("expected CodeValidationFailed, got %+v", apiErr)
	}
	if apiErr.Fields["age"] == "" || apiErr.Fields["email"] == "" {
		t.Errorf("expected both email and age field errors, got %+v", apiErr.Fields)
	}
}
