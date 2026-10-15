package apperror

import (
	"encoding/json"
	"net/http"
	"time"
)

type Code string

const (
	CodeInvalidRequest        Code = "INVALID_REQUEST"
	CodeValidationFailed      Code = "VALIDATION_FAILED"
	CodeUnauthenticated       Code = "UNAUTHENTICATED"
	CodeForbidden             Code = "FORBIDDEN"
	CodeNotFound              Code = "RESOURCE_NOT_FOUND"
	CodeMethodNotAllowed      Code = "METHOD_NOT_ALLOWED"
	CodeConflict              Code = "CONFLICT"
	CodeBusinessRuleViolation Code = "BUSINESS_RULE_VIOLATION"
	CodeRateLimitExceeded     Code = "RATE_LIMIT_EXCEEDED"
	CodeDependencyUnavailable Code = "DEPENDENCY_UNAVAILABLE"
	CodeInternalError         Code = "INTERNAL_SERVER_ERROR"
)

type APIError struct {
	HTTPStatus int               `json:"-"`
	Code       Code              `json:"code"`
	Message    string            `json:"message"`
	RequestID  string            `json:"request_id,omitempty"`
	Timestamp  string            `json:"timestamp"`
	Fields     map[string]string `json:"fields,omitempty"`
}

type ErrorEnvelope struct {
	Error APIError `json:"error"`
}

func (e *APIError) Error() string {
	return e.Message
}

func New(status int, code Code, message string) *APIError {
	return &APIError{
		HTTPStatus: status,
		Code:       code,
		Message:    message,
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
	}
}

func NewValidation(fields map[string]string) *APIError {
	return &APIError{
		HTTPStatus: http.StatusBadRequest,
		Code:       CodeValidationFailed,
		Message:    "Request payload failed validation",
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		Fields:     fields,
	}
}

func WriteJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func WriteError(w http.ResponseWriter, requestID string, apiErr *APIError) {
	if apiErr.Timestamp == "" {
		apiErr.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	apiErr.RequestID = requestID
	WriteJSON(w, apiErr.HTTPStatus, ErrorEnvelope{Error: *apiErr})
}
