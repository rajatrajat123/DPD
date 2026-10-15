package validator

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/auradating/platform/backend/internal/apperror"
)

// Validatable is implemented by request DTOs that enforce domain validation rules.
type Validatable interface {
	Validate() map[string]string
}

// DecodeAndValidate strictly decodes a JSON request body (rejecting unknown fields,
// trailing garbage, and oversized payloads) and runs domain field validation.
func DecodeAndValidate(w http.ResponseWriter, r *http.Request, maxBytes int64, dst any) *apperror.APIError {
	if r.Body == nil {
		return apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Request body is required")
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	if err := dec.Decode(dst); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return apperror.New(http.StatusRequestEntityTooLarge, apperror.CodeInvalidRequest, "Request payload exceeds size limit")
		}
		return apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed JSON payload or unknown fields")
	}

	// Ensure no trailing JSON objects exist in stream
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Request body must contain a single JSON object")
	}

	if v, ok := dst.(Validatable); ok {
		if fields := v.Validate(); len(fields) > 0 {
			return apperror.NewValidation(fields)
		}
	}

	return nil
}
