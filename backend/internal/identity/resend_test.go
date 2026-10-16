package identity

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
)

// fakeHTTPTransport allows mocking HTTP responses for Resend API calls.
type fakeHTTPTransport struct {
	roundTripFunc func(req *http.Request) (*http.Response, error)
}

func (f *fakeHTTPTransport) Do(req *http.Request) (*http.Response, error) {
	return f.roundTripFunc(req)
}

func TestResend_SuccessfulDelivery(t *testing.T) {
	var capturedReq *http.Request
	var capturedPayload ResendEmailPayload

	mockTransport := &fakeHTTPTransport{
		roundTripFunc: func(req *http.Request) (*http.Response, error) {
			capturedReq = req
			bodyBytes, _ := io.ReadAll(req.Body)
			_ = json.Unmarshal(bodyBytes, &capturedPayload)

			respJSON := `{"id": "msg_resend_123456"}`
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(bytes.NewBufferString(respJSON)),
				Header:     make(http.Header),
			}, nil
		},
	}

	sink := NewResendNotificationSink(
		"re_test_secret_api_key",
		"Aura Security <security@aura.dating>",
		"https://aura.dating/auth/reset-password",
		"production",
		slog.Default(),
		mockTransport,
	)

	ctx := context.Background()
	testEmail := "queer_member@example.com"
	testToken := "abcdef0123456789abcdef0123456789"

	err := sink.DeliverPasswordReset(ctx, testEmail, testToken)
	if err != nil {
		t.Fatalf("expected nil error on successful delivery, got: %v", err)
	}

	if capturedReq == nil {
		t.Fatal("expected HTTP request to be sent to Resend")
	}

	// Verify URL & Method
	if capturedReq.Method != http.MethodPost {
		t.Errorf("expected POST method, got: %s", capturedReq.Method)
	}
	if capturedReq.URL.String() != "https://api.resend.com/emails" {
		t.Errorf("expected target https://api.resend.com/emails, got: %s", capturedReq.URL.String())
	}

	// Verify Headers
	authHeader := capturedReq.Header.Get("Authorization")
	if authHeader != "Bearer re_test_secret_api_key" {
		t.Errorf("expected Authorization header Bearer re_test_secret_api_key, got: %s", authHeader)
	}
	if capturedReq.Header.Get("Content-Type") != "application/json" {
		t.Errorf("expected application/json Content-Type, got: %s", capturedReq.Header.Get("Content-Type"))
	}

	// Verify Payload
	if capturedPayload.From != "Aura Security <security@aura.dating>" {
		t.Errorf("unexpected From address: %s", capturedPayload.From)
	}
	if len(capturedPayload.To) != 1 || capturedPayload.To[0] != testEmail {
		t.Errorf("unexpected To recipient: %v", capturedPayload.To)
	}
	if !strings.Contains(capturedPayload.Subject, "Reset your Aura password") {
		t.Errorf("unexpected Subject: %s", capturedPayload.Subject)
	}
	if !strings.Contains(capturedPayload.Text, testToken) {
		t.Errorf("plain text body must contain reset token")
	}
	if !strings.Contains(capturedPayload.HTML, testToken) {
		t.Errorf("HTML body must contain reset token link")
	}
}

func TestResend_VerificationOTP_SuccessfulDelivery(t *testing.T) {
	var capturedPayload ResendEmailPayload

	mockTransport := &fakeHTTPTransport{
		roundTripFunc: func(req *http.Request) (*http.Response, error) {
			bodyBytes, _ := io.ReadAll(req.Body)
			_ = json.Unmarshal(bodyBytes, &capturedPayload)

			respJSON := `{"id": "msg_otp_789012"}`
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(bytes.NewBufferString(respJSON)),
				Header:     make(http.Header),
			}, nil
		},
	}

	sink := NewResendNotificationSink(
		"re_test_key",
		"Aura <security@aura.dating>",
		"https://aura.dating",
		"production",
		slog.Default(),
		mockTransport,
	)

	ctx := context.Background()
	testEmail := "verification_target@example.com"
	testOTP := "839201"

	err := sink.DeliverVerificationOTP(ctx, testEmail, "EMAIL", testOTP)
	if err != nil {
		t.Fatalf("expected nil error on successful OTP delivery, got: %v", err)
	}

	if !strings.Contains(capturedPayload.Subject, testOTP) {
		t.Errorf("subject should contain OTP: %s", capturedPayload.Subject)
	}
	if !strings.Contains(capturedPayload.Text, testOTP) {
		t.Errorf("text should contain OTP: %s", capturedPayload.Text)
	}
	if !strings.Contains(capturedPayload.HTML, testOTP) {
		t.Errorf("HTML should contain OTP: %s", capturedPayload.HTML)
	}
}

func TestResend_FailedDelivery_401Unauthorized(t *testing.T) {
	mockTransport := &fakeHTTPTransport{
		roundTripFunc: func(req *http.Request) (*http.Response, error) {
			errJSON := `{"statusCode": 401, "message": "API key is invalid", "name": "validation_error"}`
			return &http.Response{
				StatusCode: http.StatusUnauthorized,
				Body:       io.NopCloser(bytes.NewBufferString(errJSON)),
				Header:     make(http.Header),
			}, nil
		},
	}

	sink := NewResendNotificationSink(
		"re_invalid_key",
		"Aura <security@aura.dating>",
		"https://aura.dating",
		"production",
		slog.Default(),
		mockTransport,
	)

	err := sink.DeliverPasswordReset(context.Background(), "user@example.com", "token123")
	if err == nil {
		t.Fatal("expected error on 401 Unauthorized, got nil")
	}
	if !errors.Is(err, ErrResendDeliveryFailed) {
		t.Errorf("expected ErrResendDeliveryFailed, got: %v", err)
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("expected error message to include status 401, got: %v", err)
	}
}

func TestResend_FailedDelivery_422Unprocessable(t *testing.T) {
	mockTransport := &fakeHTTPTransport{
		roundTripFunc: func(req *http.Request) (*http.Response, error) {
			errJSON := `{"statusCode": 422, "message": "The domain aura.dating is not verified", "name": "validation_error"}`
			return &http.Response{
				StatusCode: http.StatusUnprocessableEntity,
				Body:       io.NopCloser(bytes.NewBufferString(errJSON)),
				Header:     make(http.Header),
			}, nil
		},
	}

	sink := NewResendNotificationSink(
		"re_valid_key",
		"Aura <security@aura.dating>",
		"https://aura.dating",
		"production",
		slog.Default(),
		mockTransport,
	)

	err := sink.DeliverPasswordReset(context.Background(), "user@example.com", "token123")
	if err == nil {
		t.Fatal("expected error on 422 Unprocessable, got nil")
	}
	if !errors.Is(err, ErrResendDeliveryFailed) {
		t.Errorf("expected ErrResendDeliveryFailed, got: %v", err)
	}
	if !strings.Contains(err.Error(), "domain aura.dating is not verified") {
		t.Errorf("expected domain error message, got: %v", err)
	}
}

func TestResend_FailedDelivery_NetworkError(t *testing.T) {
	mockTransport := &fakeHTTPTransport{
		roundTripFunc: func(req *http.Request) (*http.Response, error) {
			return nil, errors.New("dial tcp: lookup api.resend.com: no such host")
		},
	}

	sink := NewResendNotificationSink(
		"re_valid_key",
		"Aura <security@aura.dating>",
		"https://aura.dating",
		"production",
		slog.Default(),
		mockTransport,
	)

	err := sink.DeliverPasswordReset(context.Background(), "user@example.com", "token123")
	if err == nil {
		t.Fatal("expected network error, got nil")
	}
	if !errors.Is(err, ErrResendDeliveryFailed) {
		t.Errorf("expected ErrResendDeliveryFailed, got: %v", err)
	}
}

func TestResend_FailsClosedInProductionWhenUnconfigured(t *testing.T) {
	sink := NewResendNotificationSink(
		"", // empty API key
		"Aura <security@aura.dating>",
		"https://aura.dating",
		"production",
		slog.Default(),
	)

	err := sink.DeliverPasswordReset(context.Background(), "user@example.com", "token123")
	if !errors.Is(err, ErrTransactionalEmailUnconfigured) {
		t.Fatalf("expected ErrTransactionalEmailUnconfigured in production when unconfigured, got: %v", err)
	}

	err = sink.DeliverVerificationOTP(context.Background(), "user@example.com", "EMAIL", "123456")
	if !errors.Is(err, ErrTransactionalEmailUnconfigured) {
		t.Fatalf("expected ErrTransactionalEmailUnconfigured in production for OTP when unconfigured, got: %v", err)
	}
}

func TestResend_FailsClosedInStagingWhenUnconfigured(t *testing.T) {
	sink := NewResendNotificationSink(
		"",
		"Aura <security@aura.dating>",
		"https://aura.dating",
		"staging",
		slog.Default(),
	)

	err := sink.DeliverPasswordReset(context.Background(), "user@example.com", "token123")
	if !errors.Is(err, ErrTransactionalEmailUnconfigured) {
		t.Fatalf("expected ErrTransactionalEmailUnconfigured in staging when unconfigured, got: %v", err)
	}
}

func TestResend_DevFallbackWhenUnconfigured(t *testing.T) {
	sink := NewResendNotificationSink(
		"",
		"Aura <security@aura.dating>",
		"https://aura.dating",
		"development",
		slog.Default(),
	)

	err := sink.DeliverPasswordReset(context.Background(), "user@example.com", "token123")
	if err != nil {
		t.Fatalf("expected nil error in development when unconfigured, got: %v", err)
	}

	err = sink.DeliverVerificationOTP(context.Background(), "user@example.com", "EMAIL", "654321")
	if err != nil {
		t.Fatalf("expected nil error in development for OTP when unconfigured, got: %v", err)
	}
}

func TestResend_EmptyRecipientRejected(t *testing.T) {
	sink := NewResendNotificationSink(
		"re_key",
		"Aura <security@aura.dating>",
		"https://aura.dating",
		"development",
		slog.Default(),
	)

	err := sink.DeliverPasswordReset(context.Background(), "   ", "token123")
	if !errors.Is(err, ErrInvalidRecipient) {
		t.Fatalf("expected ErrInvalidRecipient for empty email, got: %v", err)
	}

	err = sink.DeliverVerificationOTP(context.Background(), "", "EMAIL", "123456")
	if !errors.Is(err, ErrInvalidRecipient) {
		t.Fatalf("expected ErrInvalidRecipient for empty OTP target, got: %v", err)
	}
}
