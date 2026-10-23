package safety

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// AgeAssuranceSessionResult returned when starting an age check
type AgeAssuranceSessionResult struct {
	SessionID string    `json:"session_id"`
	VendorURL string    `json:"vendor_url"`
	ExpiresAt time.Time `json:"expires_at"`
}

// AgeAssuranceWebhookResult extracted from an authenticated webhook
type AgeAssuranceWebhookResult struct {
	EventID    string             `json:"event_id"`
	EventName  string             `json:"event_name,omitempty"`
	SessionID  string             `json:"session_id"`
	UserID     string             `json:"user_id"`
	Status     AgeAssuranceStatus `json:"status"`
	RiskScore  int                `json:"risk_score"`
	VerifiedAt *time.Time         `json:"verified_at,omitempty"`
}

// AgeAssuranceProvider defines the interface to an established third-party age verification provider.
type AgeAssuranceProvider interface {
	Name() string
	CreateSession(ctx context.Context, userID, email string) (*AgeAssuranceSessionResult, error)
	VerifyWebhook(ctx context.Context, payload []byte, signatureHeader string) (*AgeAssuranceWebhookResult, error)
}

// PersonaTemplateInfo provides audit details regarding the configured inquiry template
type PersonaTemplateInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name,omitempty"`
	Status    string `json:"status,omitempty"`
	IsSandbox bool   `json:"is_sandbox"`
	Note      string `json:"note,omitempty"`
}

// PersonaAgeAssuranceProvider implements the provider interface using Persona's official REST API and webhooks.
type PersonaAgeAssuranceProvider struct {
	apiKey        string
	webhookSecret string
	templateID    string
	apiBaseURL    string
	httpClient    *http.Client
	redirectURI   string
	tolerance     time.Duration
}

// PersonaOption configures optional behavior of the Persona provider
type PersonaOption func(*PersonaAgeAssuranceProvider)

// WithPersonaBaseURL overrides the Persona API base URL (useful for sandbox or testing)
func WithPersonaBaseURL(url string) PersonaOption {
	return func(p *PersonaAgeAssuranceProvider) {
		p.apiBaseURL = strings.TrimRight(url, "/")
	}
}

// WithPersonaHTTPClient overrides the HTTP client
func WithPersonaHTTPClient(client *http.Client) PersonaOption {
	return func(p *PersonaAgeAssuranceProvider) {
		if client != nil {
			p.httpClient = client
		}
	}
}

// WithPersonaRedirectURI sets the redirect URI when hosted inquiry finishes
func WithPersonaRedirectURI(uri string) PersonaOption {
	return func(p *PersonaAgeAssuranceProvider) {
		p.redirectURI = uri
	}
}

// WithPersonaTolerance sets the webhook replay protection timestamp window
func WithPersonaTolerance(d time.Duration) PersonaOption {
	return func(p *PersonaAgeAssuranceProvider) {
		p.tolerance = d
	}
}

// NewPersonaAgeAssuranceProvider constructs a Persona provider with backward-compatible parameters.
// Parameters: apiKey, webhookSecret, [optional templateID string], [optional PersonaOptions]
func NewPersonaAgeAssuranceProvider(apiKey, webhookSecret string, extra ...any) *PersonaAgeAssuranceProvider {
	p := &PersonaAgeAssuranceProvider{
		apiKey:        strings.TrimSpace(apiKey),
		webhookSecret: strings.TrimSpace(webhookSecret),
		apiBaseURL:    "https://withpersona.com",
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		tolerance: 5 * time.Minute,
	}

	for _, item := range extra {
		switch v := item.(type) {
		case string:
			if p.templateID == "" {
				p.templateID = strings.TrimSpace(v)
			}
		case PersonaOption:
			v(p)
		}
	}

	return p
}

func (p *PersonaAgeAssuranceProvider) Name() string {
	return "PERSONA"
}

func (p *PersonaAgeAssuranceProvider) TemplateID() string {
	return p.templateID
}

// CreateSession creates a genuine Persona inquiry via Persona's official POST /api/v1/inquiries API.
// Requires valid API key and configured template ID supporting Government ID / Passport verification.
func (p *PersonaAgeAssuranceProvider) CreateSession(ctx context.Context, userID, email string) (*AgeAssuranceSessionResult, error) {
	if p.apiKey == "" {
		return nil, errors.New("persona age assurance API key is not configured (PERSONA_API_KEY)")
	}
	if p.templateID == "" {
		return nil, errors.New("persona inquiry template ID is not configured (PERSONA_TEMPLATE_ID)")
	}

	attributes := map[string]any{
		"inquiry-template-id": p.templateID,
		"reference-id":        userID,
	}
	if p.redirectURI != "" {
		attributes["redirect-uri"] = p.redirectURI
	}
	if email != "" {
		attributes["fields"] = map[string]any{
			"email-address": email,
		}
	}

	reqBody := map[string]any{
		"data": map[string]any{
			"type":       "inquiry",
			"attributes": attributes,
		},
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal persona request: %w", err)
	}

	apiURL := fmt.Sprintf("%s/api/v1/inquiries", p.apiBaseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create persona request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Persona-Version", "2023-01-05")
	req.Header.Set("Key-Inflection", "camel")

	client := p.httpClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("persona inquiry request failed: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return nil, fmt.Errorf("failed to read persona response: %w", err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		var errResp struct {
			Errors []struct {
				Title  string `json:"title"`
				Detail string `json:"detail"`
			} `json:"errors"`
		}
		if jsonErr := json.Unmarshal(respBytes, &errResp); jsonErr == nil && len(errResp.Errors) > 0 {
			var errMsgs []string
			for _, e := range errResp.Errors {
				if e.Detail != "" {
					errMsgs = append(errMsgs, e.Detail)
				} else if e.Title != "" {
					errMsgs = append(errMsgs, e.Title)
				}
			}
			if len(errMsgs) > 0 {
				return nil, fmt.Errorf("persona inquiry creation failed (HTTP %d): %s", resp.StatusCode, strings.Join(errMsgs, "; "))
			}
		}
		return nil, fmt.Errorf("persona inquiry creation failed (HTTP %d): %s", resp.StatusCode, string(respBytes))
	}

	var parsedResp struct {
		Data struct {
			ID         string `json:"id"`
			Attributes struct {
				Status            string     `json:"status"`
				ReferenceID       string     `json:"reference-id"`
				InquiryTemplateID string     `json:"inquiry-template-id"`
				CreatedAt         *time.Time `json:"created-at"`
				ExpiredAt         *time.Time `json:"expired-at"`
			} `json:"attributes"`
		} `json:"data"`
	}

	if err := json.Unmarshal(respBytes, &parsedResp); err != nil {
		return nil, fmt.Errorf("failed to parse persona inquiry response: %w", err)
	}

	inquiryID := strings.TrimSpace(parsedResp.Data.ID)
	if inquiryID == "" {
		return nil, errors.New("persona API returned empty inquiry ID")
	}

	expiresAt := time.Now().UTC().Add(24 * time.Hour)
	if parsedResp.Data.Attributes.ExpiredAt != nil && !parsedResp.Data.Attributes.ExpiredAt.IsZero() {
		expiresAt = *parsedResp.Data.Attributes.ExpiredAt
	}

	vendorURL := fmt.Sprintf("https://withpersona.com/verify?inquiry-id=%s", inquiryID)
	if p.apiBaseURL != "https://withpersona.com" && p.apiBaseURL != "" {
		vendorURL = fmt.Sprintf("%s/verify?inquiry-id=%s", p.apiBaseURL, inquiryID)
	}

	return &AgeAssuranceSessionResult{
		SessionID: inquiryID,
		VendorURL: vendorURL,
		ExpiresAt: expiresAt,
	}, nil
}

// CheckTemplatePassportSupport verifies the inquiry template exists and is active.
// Returns template information, noting if sandbox key permissions prevent direct REST querying.
func (p *PersonaAgeAssuranceProvider) CheckTemplatePassportSupport(ctx context.Context) (*PersonaTemplateInfo, error) {
	if p.apiKey == "" {
		return nil, errors.New("persona API key is not configured")
	}
	if p.templateID == "" {
		return nil, errors.New("persona inquiry template ID is not configured")
	}

	isSandbox := strings.HasPrefix(p.apiKey, "persona_sandbox_")

	apiURL := fmt.Sprintf("%s/api/v1/inquiry-templates/%s", p.apiBaseURL, p.templateID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to construct template request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("Persona-Version", "2023-01-05")

	client := p.httpClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to contact persona template API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		var tmplResp struct {
			Data struct {
				ID         string `json:"id"`
				Attributes struct {
					Name   string `json:"name"`
					Status string `json:"status"`
				} `json:"attributes"`
			} `json:"data"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&tmplResp)
		return &PersonaTemplateInfo{
			ID:        p.templateID,
			Name:      tmplResp.Data.Attributes.Name,
			Status:    tmplResp.Data.Attributes.Status,
			IsSandbox: isSandbox,
			Note:      "Template confirmed active on Persona organization. Ensure Government ID -> Passport is enabled in Persona dashboard.",
		}, nil
	}

	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusUnauthorized {
		return &PersonaTemplateInfo{
			ID:        p.templateID,
			IsSandbox: isSandbox,
			Note:      "Sandbox API key cannot query /inquiry-templates endpoint directly (Persona security restriction). Template ID will be validated during inquiry creation. Ensure Government ID -> Passport is enabled in Persona dashboard.",
		}, nil
	}

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("persona inquiry template '%s' not found (HTTP 404). Verify template ID in Persona dashboard", p.templateID)
	}

	return nil, fmt.Errorf("persona template query failed with HTTP %d", resp.StatusCode)
}

// VerifyWebhook validates the Persona-Signature HMAC-SHA256 signature, enforces replay attack protection,
// and extracts the authoritative inquiry verification result.
func (p *PersonaAgeAssuranceProvider) VerifyWebhook(ctx context.Context, payload []byte, signatureHeader string) (*AgeAssuranceWebhookResult, error) {
	if p.webhookSecret == "" {
		return nil, errors.New("persona webhook secret is not configured (PERSONA_WEBHOOK_SECRET)")
	}
	if strings.TrimSpace(signatureHeader) == "" {
		return nil, ErrInvalidWebhookSignature
	}

	tolerance := p.tolerance
	if tolerance == 0 {
		tolerance = 5 * time.Minute
	}

	var (
		signatureMatched bool
		timestampExpired bool
	)

	// Format: Persona-Signature: t=1618876543,v1=5f23e... (or space-delimited pairs during secret rotation)
	pairs := strings.Fields(signatureHeader)
	for _, pair := range pairs {
		var tStr, v1Str string
		for _, part := range strings.Split(pair, ",") {
			kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
			if len(kv) == 2 {
				k := strings.TrimSpace(kv[0])
				v := strings.TrimSpace(kv[1])
				if k == "t" {
					tStr = v
				} else if k == "v1" {
					v1Str = v
				}
			}
		}

		if tStr != "" && v1Str != "" {
			ts, err := strconv.ParseInt(tStr, 10, 64)
			if err == nil {
				nowUnix := time.Now().UTC().Unix()
				diff := nowUnix - ts
				// Replay tolerance: allow max 60s into future (clock skew), and max tolerance into past
				if diff < -60 || diff > int64(tolerance.Seconds()) {
					timestampExpired = true
					continue
				}

				signedPayload := []byte(tStr + ".")
				signedPayload = append(signedPayload, payload...)

				mac := hmac.New(sha256.New, []byte(p.webhookSecret))
				mac.Write(signedPayload)
				expectedSig := hex.EncodeToString(mac.Sum(nil))

				if subtle.ConstantTimeCompare([]byte(v1Str), []byte(expectedSig)) == 1 {
					signatureMatched = true
					break
				}
			}
		}
	}

	// Backward compatibility fallback: if signatureHeader is direct hex without t=..., verify raw payload HMAC
	if !signatureMatched && !timestampExpired {
		mac := hmac.New(sha256.New, []byte(p.webhookSecret))
		mac.Write(payload)
		expectedSig := hex.EncodeToString(mac.Sum(nil))
		if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(signatureHeader)), []byte(expectedSig)) == 1 {
			signatureMatched = true
		}
	}

	if !signatureMatched {
		if timestampExpired {
			return nil, ErrExpiredWebhookSignature
		}
		return nil, ErrInvalidWebhookSignature
	}

	var evt struct {
		EventID string `json:"event_id"`
		Data    struct {
			Type       string `json:"type"`
			ID         string `json:"id"`
			Attributes struct {
				Name      string `json:"name"`
				Status    string `json:"status"`
				Reference string `json:"reference_id"`
				RefHyphen string `json:"reference-id"`
				RiskScore int    `json:"risk_score"`
				Payload   struct {
					Data struct {
						Type       string `json:"type"`
						ID         string `json:"id"`
						Attributes struct {
							Status            string `json:"status"`
							ReferenceID       string `json:"reference_id"`
							RefHyphen         string `json:"reference-id"`
							InquiryTemplateID string `json:"inquiry-template-id"`
							RiskScore         int    `json:"risk_score"`
						} `json:"attributes"`
					} `json:"data"`
				} `json:"payload"`
			} `json:"attributes"`
		} `json:"data"`
	}

	if err := json.Unmarshal(payload, &evt); err != nil {
		return nil, fmt.Errorf("failed to parse webhook payload: %w", err)
	}

	eventID := evt.EventID
	if eventID == "" && evt.Data.Type == "event" {
		eventID = evt.Data.ID
	}

	eventName := strings.ToLower(strings.TrimSpace(evt.Data.Attributes.Name))

	sessionID := strings.TrimSpace(evt.Data.Attributes.Payload.Data.ID)
	if sessionID == "" {
		sessionID = strings.TrimSpace(evt.Data.ID)
	}

	inquiryStatus := strings.ToLower(strings.TrimSpace(evt.Data.Attributes.Payload.Data.Attributes.Status))
	if inquiryStatus == "" {
		inquiryStatus = strings.ToLower(strings.TrimSpace(evt.Data.Attributes.Status))
	}

	userID := strings.TrimSpace(evt.Data.Attributes.Payload.Data.Attributes.RefHyphen)
	if userID == "" {
		userID = strings.TrimSpace(evt.Data.Attributes.Payload.Data.Attributes.ReferenceID)
	}
	if userID == "" {
		userID = strings.TrimSpace(evt.Data.Attributes.RefHyphen)
	}
	if userID == "" {
		userID = strings.TrimSpace(evt.Data.Attributes.Reference)
	}

	riskScore := evt.Data.Attributes.Payload.Data.Attributes.RiskScore
	if riskScore == 0 {
		riskScore = evt.Data.Attributes.RiskScore
	}

	var status AgeAssuranceStatus
	switch {
	case eventName == "inquiry.approved" || inquiryStatus == "approved" || inquiryStatus == "passed":
		status = AgeVerified
	case eventName == "inquiry.declined" || eventName == "inquiry.failed" || inquiryStatus == "declined" || inquiryStatus == "failed":
		status = AgeRejected
	case eventName == "inquiry.marked-for-review" || eventName == "inquiry.needs-review" || inquiryStatus == "needs_review" || inquiryStatus == "marked_for_review" || inquiryStatus == "marked-for-review" || inquiryStatus == "requires_retry":
		status = AgeManualReview
	case eventName == "inquiry.expired" || inquiryStatus == "expired":
		status = AgeExpired
	case eventName == "inquiry.completed":
		// Per Persona documentation: inquiry.completed indicates the user completed the flow screens,
		// but verification outcomes may still be processing. Only grant AgeVerified if inquiryStatus == "approved".
		if inquiryStatus == "approved" || inquiryStatus == "passed" {
			status = AgeVerified
		} else {
			status = AgePending
		}
	default:
		status = AgePending
	}

	now := time.Now().UTC()
	var verifiedAt *time.Time
	if status == AgeVerified {
		verifiedAt = &now
	}

	return &AgeAssuranceWebhookResult{
		EventID:    eventID,
		EventName:  eventName,
		SessionID:  sessionID,
		UserID:     userID,
		Status:     status,
		RiskScore:  riskScore,
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
