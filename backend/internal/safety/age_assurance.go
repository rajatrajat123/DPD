package safety

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// AgeAssuranceSessionResult returned when starting an age check
type AgeAssuranceSessionResult struct {
	SessionID string `json:"session_id"`
	VendorURL string `json:"vendor_url"`
	ExpiresAt time.Time `json:"expires_at"`
}

// AgeAssuranceWebhookResult extracted from an authenticated webhook
type AgeAssuranceWebhookResult struct {
	EventID   string             `json:"event_id"`
	SessionID string             `json:"session_id"`
	UserID    string             `json:"user_id"`
	Status    AgeAssuranceStatus `json:"status"`
	RiskScore int                `json:"risk_score"`
	VerifiedAt *time.Time        `json:"verified_at,omitempty"`
}

// AgeAssuranceProvider defines the interface to an established third-party age verification provider.
type AgeAssuranceProvider interface {
	Name() string
	CreateSession(ctx context.Context, userID, email string) (*AgeAssuranceSessionResult, error)
	VerifyWebhook(ctx context.Context, payload []byte, signatureHeader string) (*AgeAssuranceWebhookResult, error)
}

// PersonaAgeAssuranceProvider implements the provider interface using Persona-compatible webhook signatures and payload schemas.
type PersonaAgeAssuranceProvider struct {
	apiKey        string
	webhookSecret string
}

func NewPersonaAgeAssuranceProvider(apiKey, webhookSecret string) *PersonaAgeAssuranceProvider {
	return &PersonaAgeAssuranceProvider{
		apiKey:        apiKey,
		webhookSecret: webhookSecret,
	}
}

func (p *PersonaAgeAssuranceProvider) Name() string {
	return "PERSONA"
}

func (p *PersonaAgeAssuranceProvider) CreateSession(ctx context.Context, userID, email string) (*AgeAssuranceSessionResult, error) {
	if p.apiKey == "" {
		return nil, errors.New("persona age assurance API key is not configured")
	}

	sessionID := fmt.Sprintf("inq_%s_%d", userID, time.Now().UnixNano())
	return &AgeAssuranceSessionResult{
		SessionID: sessionID,
		VendorURL: fmt.Sprintf("https://withpersona.com/verify?inquiry-id=%s", sessionID),
		ExpiresAt: time.Now().UTC().Add(24 * time.Hour),
	}, nil
}

func (p *PersonaAgeAssuranceProvider) VerifyWebhook(ctx context.Context, payload []byte, signatureHeader string) (*AgeAssuranceWebhookResult, error) {
	if p.webhookSecret == "" {
		return nil, errors.New("persona webhook secret is not configured")
	}

	// Verify HMAC-SHA256 signature
	mac := hmac.New(sha256.New, []byte(p.webhookSecret))
	mac.Write(payload)
	expectedSig := hex.EncodeToString(mac.Sum(nil))

	cleanHeader := signatureHeader
	// Some providers format signature as t=...,v1=...
	if subtle.ConstantTimeCompare([]byte(cleanHeader), []byte(expectedSig)) != 1 {
		return nil, ErrInvalidWebhookSignature
	}

	var evt struct {
		EventID string `json:"event_id"`
		Data    struct {
			ID         string `json:"id"`
			Attributes struct {
				Status    string `json:"status"`
				Reference string `json:"reference_id"` // UserID
				RiskScore int    `json:"risk_score"`
			} `json:"attributes"`
		} `json:"data"`
	}

	if err := json.Unmarshal(payload, &evt); err != nil {
		return nil, fmt.Errorf("failed to parse webhook payload: %w", err)
	}

	var status AgeAssuranceStatus
	switch evt.Data.Attributes.Status {
	case "passed", "approved", "completed":
		status = AgeVerified
	case "failed", "declined":
		status = AgeRejected
	case "requires_retry", "needs_review":
		status = AgeManualReview
	default:
		status = AgePending
	}

	now := time.Now().UTC()
	var verifiedAt *time.Time
	if status == AgeVerified {
		verifiedAt = &now
	}

	return &AgeAssuranceWebhookResult{
		EventID:    evt.EventID,
		SessionID:  evt.Data.ID,
		UserID:     evt.Data.Attributes.Reference,
		Status:     status,
		RiskScore:  evt.Data.Attributes.RiskScore,
		VerifiedAt: verifiedAt,
	}, nil
}

// DevAgeAssuranceProvider is a test-only mock provider strictly disallowed in production.
type DevAgeAssuranceProvider struct {
	environment string
}

func NewDevAgeAssuranceProvider(environment string) *DevAgeAssuranceProvider {
	return &DevAgeAssuranceProvider{environment: environment}
}

func (d *DevAgeAssuranceProvider) Name() string {
	return "DEV_MOCK"
}

func (d *DevAgeAssuranceProvider) isProduction() bool {
	return d.environment == "production" || d.environment == "prod"
}

func (d *DevAgeAssuranceProvider) CreateSession(ctx context.Context, userID, email string) (*AgeAssuranceSessionResult, error) {
	if d.isProduction() {
		return nil, ErrProviderDisabledInProd
	}

	sessionID := fmt.Sprintf("dev_inq_%s_%d", userID, time.Now().UnixNano())
	return &AgeAssuranceSessionResult{
		SessionID: sessionID,
		VendorURL: fmt.Sprintf("https://dev-verify.aura.local/session/%s", sessionID),
		ExpiresAt: time.Now().UTC().Add(1 * time.Hour),
	}, nil
}

func (d *DevAgeAssuranceProvider) VerifyWebhook(ctx context.Context, payload []byte, signatureHeader string) (*AgeAssuranceWebhookResult, error) {
	if d.isProduction() {
		return nil, ErrProviderDisabledInProd
	}

	if signatureHeader != "dev-mock-valid-sig" {
		return nil, ErrInvalidWebhookSignature
	}

	var req struct {
		EventID   string             `json:"event_id"`
		SessionID string             `json:"session_id"`
		UserID    string             `json:"user_id"`
		Status    AgeAssuranceStatus `json:"status"`
		RiskScore int                `json:"risk_score"`
	}

	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid dev webhook json: %w", err)
	}

	now := time.Now().UTC()
	var verifiedAt *time.Time
	if req.Status == AgeVerified {
		verifiedAt = &now
	}

	return &AgeAssuranceWebhookResult{
		EventID:    req.EventID,
		SessionID:  req.SessionID,
		UserID:     req.UserID,
		Status:     req.Status,
		RiskScore:  req.RiskScore,
		VerifiedAt: verifiedAt,
	}, nil
}
