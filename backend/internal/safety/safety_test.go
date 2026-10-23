package safety_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/safety"
)

type mockHub struct {
	mu           sync.Mutex
	disconnected []string
}

func (m *mockHub) DisconnectUser(userID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.disconnected = append(m.disconnected, userID)
}

func (m *mockHub) WasDisconnected(userID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, id := range m.disconnected {
		if id == userID {
			return true
		}
	}
	return false
}

func createTestPersonaSignature(secret string, timestamp int64, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strconv.FormatInt(timestamp, 10)))
	mac.Write([]byte("."))
	mac.Write(payload)
	sigHex := hex.EncodeToString(mac.Sum(nil))
	return fmt.Sprintf("t=%d,v1=%s", timestamp, sigHex)
}

func newMockPersonaServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		// POST /api/v1/inquiries
		if strings.HasPrefix(r.URL.Path, "/api/v1/inquiries") && r.Method == http.MethodPost {
			auth := r.Header.Get("Authorization")
			if !strings.HasPrefix(auth, "Bearer ") {
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"errors": []map[string]any{{"title": "Unauthorized"}},
				})
				return
			}

			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}

			data, _ := body["data"].(map[string]any)
			attrs, _ := data["attributes"].(map[string]any)
			templateID, _ := attrs["inquiry-template-id"].(string)
			refID, _ := attrs["reference-id"].(string)

			if templateID == "itmpl_invalid_trigger_422" {
				w.WriteHeader(http.StatusUnprocessableEntity)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"errors": []map[string]any{
						{
							"title":  "Unprocessable Entity",
							"detail": "The inquiry template requires passport configuration",
						},
					},
				})
				return
			}

			if refID == "" {
				refID = "user_default"
			}
			inquiryID := "inq_" + refID

			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"id":   inquiryID,
					"type": "inquiry",
					"attributes": map[string]any{
						"status":       "pending",
						"reference-id": refID,
						"hosted-url":   "https://withpersona.com/verify?inquiry-id=" + inquiryID,
						"expires-at":   time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
					},
				},
			})
			return
		}

		// GET /api/v1/inquiry-templates/<id>
		if strings.HasPrefix(r.URL.Path, "/api/v1/inquiry-templates/") && r.Method == http.MethodGet {
			templateID := strings.TrimPrefix(r.URL.Path, "/api/v1/inquiry-templates/")
			if templateID == "itmpl_sandbox_forbidden" {
				w.WriteHeader(http.StatusForbidden)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"errors": []map[string]any{{"title": "Sandbox key restricted"}},
				})
				return
			}
			if templateID == "itmpl_not_found" {
				w.WriteHeader(http.StatusNotFound)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"errors": []map[string]any{{"title": "Template not found"}},
				})
				return
			}

			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"id":   templateID,
					"type": "inquiry-template",
					"attributes": map[string]any{
						"name":   "Passport Verification Template",
						"status": "active",
					},
				},
			})
			return
		}

		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)
	return server
}

func setupTestSafetyWithServer(t *testing.T) (*safety.Service, *safety.MemoryRepository, *identity.MemoryRepository, *mockHub, *safety.PersonaAgeAssuranceProvider, *httptest.Server) {
	t.Helper()
	repo := safety.NewMemoryRepository()
	idRepo := identity.NewMemoryRepository()
	hub := &mockHub{}
	mockServer := newMockPersonaServer(t)

	provider := safety.NewPersonaAgeAssuranceProvider(
		"test_persona_api_key",
		"test_webhook_secret_xyz",
		"itmpl_passport_test_123",
		safety.WithPersonaBaseURL(mockServer.URL),
	)
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))

	svc := safety.NewService(repo, idRepo, provider, hub, logger)
	return svc, repo, idRepo, hub, provider, mockServer
}

func setupTestSafety(t *testing.T) (*safety.Service, *safety.MemoryRepository, *identity.MemoryRepository, *mockHub, *safety.PersonaAgeAssuranceProvider) {
	svc, repo, idRepo, hub, provider, _ := setupTestSafetyWithServer(t)
	return svc, repo, idRepo, hub, provider
}

// -----------------------------------------------------------------------------
// 1. RBAC & Permissions Matrix Tests
// -----------------------------------------------------------------------------

func TestRBAC_PermissionsMatrix(t *testing.T) {
	// SuperAdmin has everything
	for _, perm := range []safety.Permission{
		safety.PermModerationRead,
		safety.PermModerationAction,
		safety.PermFinanceRead,
		safety.PermFinanceApprove,
		safety.PermAgeReview,
		safety.PermSuperAdmin,
		safety.PermAuditRead,
	} {
		if !safety.HasPermission(identity.RoleSuperAdmin, perm) {
			t.Errorf("expected SuperAdmin to have permission %s", perm)
		}
	}

	// Trust & Safety
	if !safety.HasPermission(identity.RoleTrustAndSafety, safety.PermModerationRead) {
		t.Errorf("TrustAndSafety should have PermModerationRead")
	}
	if !safety.HasPermission(identity.RoleTrustAndSafety, safety.PermModerationAction) {
		t.Errorf("TrustAndSafety should have PermModerationAction")
	}
	if !safety.HasPermission(identity.RoleTrustAndSafety, safety.PermAgeReview) {
		t.Errorf("TrustAndSafety should have PermAgeReview")
	}
	if !safety.HasPermission(identity.RoleTrustAndSafety, safety.PermAuditRead) {
		t.Errorf("TrustAndSafety should have PermAuditRead")
	}
	if safety.HasPermission(identity.RoleTrustAndSafety, safety.PermFinanceApprove) {
		t.Errorf("TrustAndSafety must NOT have PermFinanceApprove")
	}

	// Finance Admin
	if !safety.HasPermission(identity.RoleFinanceAdmin, safety.PermFinanceRead) {
		t.Errorf("FinanceAdmin should have PermFinanceRead")
	}
	if !safety.HasPermission(identity.RoleFinanceAdmin, safety.PermFinanceApprove) {
		t.Errorf("FinanceAdmin should have PermFinanceApprove")
	}
	if safety.HasPermission(identity.RoleFinanceAdmin, safety.PermModerationAction) {
		t.Errorf("FinanceAdmin must NOT have PermModerationAction")
	}

	// Member role has zero admin permissions
	if safety.HasPermission(identity.RoleMember, safety.PermModerationRead) {
		t.Errorf("Member role must not have PermModerationRead")
	}
}

func TestValidateNonSelfAction(t *testing.T) {
	if err := safety.ValidateNonSelfAction("user_1", "user_1"); err != safety.ErrSelfActionProhibited {
		t.Errorf("expected ErrSelfActionProhibited, got %v", err)
	}

	if err := safety.ValidateNonSelfAction(" USER_1 ", "user_1"); err != safety.ErrSelfActionProhibited {
		t.Errorf("expected ErrSelfActionProhibited with whitespace/case, got %v", err)
	}

	if err := safety.ValidateNonSelfAction("admin_1", "user_2"); err != nil {
		t.Errorf("expected nil error for distinct actor and target, got %v", err)
	}

	if err := safety.ValidateNonSelfAction("", "user_2"); err == nil {
		t.Errorf("expected error for empty actorID")
	}
}

// -----------------------------------------------------------------------------
// 2. Audit Logging & Privacy Sanitization Tests
// -----------------------------------------------------------------------------

func TestSanitizeAuditMetadata(t *testing.T) {
	raw := map[string]any{
		"user_id":     "usr_123",
		"password":    "super_secret_password",
		"auth_token":  "jwt.token.here",
		"credit_card": "4111-2222-3333-4444",
		"nested": map[string]any{
			"cvv":          "123",
			"public_info":  "ok",
			"biometric_id": "face_scan_123",
		},
	}

	sanitized := safety.SanitizeAuditMetadata(raw)

	if sanitized["user_id"] != "usr_123" {
		t.Errorf("expected user_id to remain intact")
	}
	if sanitized["password"] != "[REDACTED]" {
		t.Errorf("expected password to be [REDACTED], got %v", sanitized["password"])
	}
	if sanitized["auth_token"] != "[REDACTED]" {
		t.Errorf("expected auth_token to be [REDACTED]")
	}
	if sanitized["credit_card"] != "[REDACTED]" {
		t.Errorf("expected credit_card to be [REDACTED]")
	}

	nested, ok := sanitized["nested"].(map[string]any)
	if !ok {
		t.Fatalf("expected nested map to be map[string]any")
	}
	if nested["public_info"] != "ok" {
		t.Errorf("expected public_info to remain intact")
	}
	if nested["cvv"] != "[REDACTED]" {
		t.Errorf("expected cvv to be [REDACTED]")
	}
	if nested["biometric_id"] != "[REDACTED]" {
		t.Errorf("expected biometric_id to be [REDACTED]")
	}
}

func TestPseudonymizeIP(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"192.168.1.150", "192.168.1.0"},
		{"10.0.4.55:8080", "10.0.4.0"},
		{"", ""},
		{"2001:0db8:85a3:0000:0000:8a2e:0370:7334", "2001:db8:85a3::"},
	}

	for _, tc := range tests {
		got := safety.PseudonymizeIP(tc.input)
		if got != tc.expected {
			t.Errorf("PseudonymizeIP(%q) = %q, expected %q", tc.input, got, tc.expected)
		}
	}
}

// -----------------------------------------------------------------------------
// 3. Fraud Brute-Force Tracking Tests
// -----------------------------------------------------------------------------

func TestFraudManager_BruteForceLockout(t *testing.T) {
	repo := safety.NewMemoryRepository()
	fraud := safety.NewFraudManager(repo)
	ctx := context.Background()

	email := "victim@aura.dating"
	ip := "203.0.113.195"

	// Initial state allows login
	if err := fraud.CheckLoginAllowed(ctx, email, ip); err != nil {
		t.Fatalf("expected login to be allowed initially, got %v", err)
	}

	// 4 failed attempts should not trigger lockout
	for i := 1; i <= 4; i++ {
		count, lockUntil, err := fraud.RecordFailedLogin(ctx, email, ip)
		if err != nil {
			t.Fatalf("failed to record attempt %d: %v", i, err)
		}
		if count != i {
			t.Errorf("expected count %d, got %d", i, count)
		}
		if lockUntil != nil {
			t.Errorf("should not be locked out at %d attempts", i)
		}
	}

	// 5th failed attempt triggers lockout
	count, lockUntil, err := fraud.RecordFailedLogin(ctx, email, ip)
	if err != nil {
		t.Fatalf("failed to record 5th attempt: %v", err)
	}
	if count != 5 {
		t.Errorf("expected count 5, got %d", count)
	}
	if lockUntil == nil {
		t.Fatalf("expected non-nil lockUntil after 5 attempts")
	}

	// CheckLoginAllowed now returns ErrLoginLockoutActive
	err = fraud.CheckLoginAllowed(ctx, email, ip)
	if err != safety.ErrLoginLockoutActive {
		t.Fatalf("expected ErrLoginLockoutActive, got %v", err)
	}

	// Successful login resets the counter
	if err := fraud.RecordSuccessfulLogin(ctx, email, ip); err != nil {
		t.Fatalf("failed to record successful login: %v", err)
	}

	// Login is allowed again
	if err := fraud.CheckLoginAllowed(ctx, email, ip); err != nil {
		t.Fatalf("expected login to be allowed after reset, got %v", err)
	}
}

// -----------------------------------------------------------------------------
// 4. Age Assurance Provider Tests
// -----------------------------------------------------------------------------

func TestPersonaAgeAssuranceProvider(t *testing.T) {
	secret := "super_secret_webhook_key"
	mockServer := newMockPersonaServer(t)
	ctx := context.Background()

	t.Run("CreateSession_Success", func(t *testing.T) {
		provider := safety.NewPersonaAgeAssuranceProvider(
			"persona_key_123",
			secret,
			"itmpl_passport_test_123",
			safety.WithPersonaBaseURL(mockServer.URL),
			safety.WithPersonaRedirectURI("aura://auth/verify-age"),
		)

		sess, err := provider.CreateSession(ctx, "usr_100", "user@example.com")
		if err != nil {
			t.Fatalf("failed to create session: %v", err)
		}
		if !strings.HasPrefix(sess.SessionID, "inq_usr_100") {
			t.Errorf("expected session prefix inq_usr_100, got %s", sess.SessionID)
		}
		if !strings.Contains(sess.VendorURL, sess.SessionID) {
			t.Errorf("expected vendor URL to contain session ID: %s", sess.VendorURL)
		}
		if sess.ExpiresAt.IsZero() {
			t.Errorf("expected non-zero expiration time")
		}
	})

	t.Run("CreateSession_MissingConfig", func(t *testing.T) {
		noKey := safety.NewPersonaAgeAssuranceProvider("", secret, "itmpl_123")
		if _, err := noKey.CreateSession(ctx, "usr_1", ""); err == nil {
			t.Errorf("expected error when API key missing")
		}

		noTemplate := safety.NewPersonaAgeAssuranceProvider("key", secret)
		if _, err := noTemplate.CreateSession(ctx, "usr_1", ""); err == nil {
			t.Errorf("expected error when template ID missing")
		}
	})

	t.Run("CreateSession_VendorError", func(t *testing.T) {
		provider := safety.NewPersonaAgeAssuranceProvider(
			"persona_key_123",
			secret,
			"itmpl_invalid_trigger_422",
			safety.WithPersonaBaseURL(mockServer.URL),
		)
		_, err := provider.CreateSession(ctx, "usr_err", "err@aura.dating")
		if err == nil {
			t.Fatalf("expected error from 422 vendor response")
		}
		if !strings.Contains(err.Error(), "422") {
			t.Errorf("expected error to mention 422, got %v", err)
		}
	})

	t.Run("CheckTemplatePassportSupport", func(t *testing.T) {
		provider := safety.NewPersonaAgeAssuranceProvider(
			"persona_key_123",
			secret,
			"itmpl_passport_test_123",
			safety.WithPersonaBaseURL(mockServer.URL),
		)

		info, err := provider.CheckTemplatePassportSupport(ctx)
		if err != nil {
			t.Fatalf("unexpected error checking template: %v", err)
		}
		if info.Status != "active" {
			t.Errorf("expected active status, got %s", info.Status)
		}

		// Sandbox forbidden graceful note
		sandboxProvider := safety.NewPersonaAgeAssuranceProvider(
			"persona_sandbox_key",
			secret,
			"itmpl_sandbox_forbidden",
			safety.WithPersonaBaseURL(mockServer.URL),
		)
		sInfo, err := sandboxProvider.CheckTemplatePassportSupport(ctx)
		if err != nil {
			t.Fatalf("expected sandbox 403 to be handled gracefully, got err: %v", err)
		}
		if !sInfo.IsSandbox {
			t.Errorf("expected IsSandbox to be true")
		}

		// Non-existent template
		notFoundProvider := safety.NewPersonaAgeAssuranceProvider(
			"persona_key_123",
			secret,
			"itmpl_not_found",
			safety.WithPersonaBaseURL(mockServer.URL),
		)
		_, err = notFoundProvider.CheckTemplatePassportSupport(ctx)
		if err == nil {
			t.Fatalf("expected 404 template error")
		}
	})

	t.Run("VerifyWebhook_OfficialPersonaSignature", func(t *testing.T) {
		provider := safety.NewPersonaAgeAssuranceProvider("persona_key_123", secret)
		payload := []byte(`{
			"data": {
				"id": "inq_usr_100",
				"type": "inquiry",
				"attributes": {
					"status": "approved",
					"reference-id": "usr_100",
					"fields": {
						"birthdate": {"value": "1998-05-15"}
					}
				}
			}
		}`)

		now := time.Now().UTC().Unix()
		sigHeader := createTestPersonaSignature(secret, now, payload)

		res, err := provider.VerifyWebhook(ctx, payload, sigHeader)
		if err != nil {
			t.Fatalf("expected webhook verification to succeed: %v", err)
		}
		if res.Status != safety.AgeVerified {
			t.Errorf("expected AgeVerified, got %s", res.Status)
		}
		if res.SessionID != "inq_usr_100" {
			t.Errorf("expected inq_usr_100, got %s", res.SessionID)
		}
		if res.UserID != "usr_100" {
			t.Errorf("expected usr_100, got %s", res.UserID)
		}
	})

	t.Run("VerifyWebhook_ReplayProtectionExpired", func(t *testing.T) {
		provider := safety.NewPersonaAgeAssuranceProvider(
			"persona_key_123",
			secret,
			safety.WithPersonaTolerance(5*time.Minute),
		)
		payload := []byte(`{"data":{"id":"inq_123","attributes":{"status":"approved"}}}`)

		// 10 minutes in the past
		past := time.Now().UTC().Add(-10 * time.Minute).Unix()
		sigHeader := createTestPersonaSignature(secret, past, payload)

		_, err := provider.VerifyWebhook(ctx, payload, sigHeader)
		if !errors.Is(err, safety.ErrExpiredWebhookSignature) {
			t.Errorf("expected ErrExpiredWebhookSignature for 10-minute old webhook, got %v", err)
		}
	})

	t.Run("VerifyWebhook_InvalidSignature", func(t *testing.T) {
		provider := safety.NewPersonaAgeAssuranceProvider("persona_key_123", secret)
		payload := []byte(`{"data":{"id":"inq_123","attributes":{"status":"approved"}}}`)

		// Wrong secret
		sigHeader := createTestPersonaSignature("wrong_secret", time.Now().UTC().Unix(), payload)
		_, err := provider.VerifyWebhook(ctx, payload, sigHeader)
		if !errors.Is(err, safety.ErrInvalidWebhookSignature) {
			t.Errorf("expected ErrInvalidWebhookSignature, got %v", err)
		}

		// Tampered payload
		tamperedSig := createTestPersonaSignature(secret, time.Now().UTC().Unix(), []byte(`tampered`))
		_, err = provider.VerifyWebhook(ctx, payload, tamperedSig)
		if !errors.Is(err, safety.ErrInvalidWebhookSignature) {
			t.Errorf("expected ErrInvalidWebhookSignature for tampered payload, got %v", err)
		}
	})

	t.Run("VerifyWebhook_LegacyFallback", func(t *testing.T) {
		provider := safety.NewPersonaAgeAssuranceProvider("persona_key_123", secret)
		payload := []byte(`{"data":{"id":"inq_legacy","attributes":{"status":"passed","reference-id":"usr_legacy"}}}`)

		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(payload)
		legacySig := hex.EncodeToString(mac.Sum(nil))

		res, err := provider.VerifyWebhook(ctx, payload, legacySig)
		if err != nil {
			t.Fatalf("expected legacy hex signature to succeed: %v", err)
		}
		if res.Status != safety.AgeVerified {
			t.Errorf("expected AgeVerified, got %s", res.Status)
		}
	})

	t.Run("VerifyWebhook_OutcomeStatusMapping", func(t *testing.T) {
		provider := safety.NewPersonaAgeAssuranceProvider("persona_key_123", secret)

		testCases := []struct {
			providerStatus string
			expected       safety.AgeAssuranceStatus
		}{
			{"approved", safety.AgeVerified},
			{"passed", safety.AgeVerified},
			{"declined", safety.AgeRejected},
			{"failed", safety.AgeRejected},
			{"needs_review", safety.AgeManualReview},
			{"marked_for_review", safety.AgeManualReview},
			{"completed", safety.AgePending},
			{"expired", safety.AgeExpired},
		}

		for _, tc := range testCases {
			payload := []byte(fmt.Sprintf(`{"data":{"id":"inq_status","attributes":{"status":"%s"}}}`, tc.providerStatus))
			sig := createTestPersonaSignature(secret, time.Now().UTC().Unix(), payload)
			res, err := provider.VerifyWebhook(ctx, payload, sig)
			if err != nil {
				t.Fatalf("status %s verification failed: %v", tc.providerStatus, err)
			}
			if res.Status != tc.expected {
				t.Errorf("status %s: expected %s, got %s", tc.providerStatus, tc.expected, res.Status)
			}
		}
	})
}

func TestDevAgeAssuranceProvider_ProductionGuard(t *testing.T) {
	// Dev provider should fail immediately if APP_ENV=production
	prodProvider := safety.NewDevAgeAssuranceProvider("production")
	ctx := context.Background()

	_, err := prodProvider.CreateSession(ctx, "usr_1", "test@aura.dating")
	if err != safety.ErrProviderDisabledInProd {
		t.Errorf("expected ErrProviderDisabledInProd in production, got %v", err)
	}

	_, err = prodProvider.VerifyWebhook(ctx, []byte(`{}`), "dev-mock-valid-sig")
	if err != safety.ErrProviderDisabledInProd {
		t.Errorf("expected ErrProviderDisabledInProd in production webhook, got %v", err)
	}

	// Local provider succeeds
	localProvider := safety.NewDevAgeAssuranceProvider("local")
	sess, err := localProvider.CreateSession(ctx, "usr_1", "test@aura.dating")
	if err != nil {
		t.Fatalf("expected success in local env, got %v", err)
	}
	if sess.SessionID == "" {
		t.Errorf("expected session ID to be non-empty")
	}
}

// -----------------------------------------------------------------------------
// 5. Safety Service Workflows & Workflows Under Age Test
// -----------------------------------------------------------------------------

func TestSafetyService_AgeAssuranceWorkflow(t *testing.T) {
	svc, _, idRepo, hub, _ := setupTestSafety(t)
	ctx := context.Background()
	userID := "usr_dating_member"

	// 1. Initial status: unverified
	verified, err := svc.IsAgeVerified(ctx, userID)
	if err != nil {
		t.Fatalf("failed check: %v", err)
	}
	if verified {
		t.Fatalf("new user must not be age verified by default")
	}

	// 2. Start session
	sess, err := svc.CreateAgeVerificationSession(ctx, userID, "dating@aura.dating", "127.0.0.1")
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}
	if sess.SessionID == "" {
		t.Fatalf("expected non-empty session ID")
	}

	// 3. Status is PENDING
	aa, err := svc.GetAgeAssuranceStatus(ctx, userID)
	if err != nil {
		t.Fatalf("failed to get status: %v", err)
	}
	if aa.Status != safety.AgePending {
		t.Errorf("expected status PENDING, got %s", aa.Status)
	}

	// 4. Webhook returns REJECTED (Suspected underage)
	// Create identity account to verify suspension cascade
	_ = idRepo.CreateUser(ctx, &identity.User{
		ID:     userID,
		Email:  "dating@aura.dating",
		Status: identity.StatusActive,
		Role:   identity.RoleMember,
	})

	webhookPayload := []byte(`{
		"event_id": "evt_reject_1",
		"data": {
			"id": "` + sess.SessionID + `",
			"attributes": {
				"status": "failed",
				"reference_id": "` + userID + `",
				"risk_score": 95
			}
		}
	}`)

	mac := hmac.New(sha256.New, []byte("test_webhook_secret_xyz"))
	mac.Write(webhookPayload)
	sig := hex.EncodeToString(mac.Sum(nil))

	_, err = svc.ProcessAgeVerificationWebhook(ctx, webhookPayload, sig)
	if err != nil {
		t.Fatalf("failed to process webhook: %v", err)
	}

	// User should be rejected, account suspended, WebSocket disconnected
	updatedUser, err := idRepo.GetUserByID(ctx, userID)
	if err != nil {
		t.Fatalf("failed to get user: %v", err)
	}
	if updatedUser.Status != identity.StatusSuspended {
		t.Errorf("expected user status SUSPENDED after age rejection, got %s", updatedUser.Status)
	}
	if !hub.WasDisconnected(userID) {
		t.Errorf("expected user to be disconnected from WebSocket")
	}

	// 5. Admin override restores to VERIFIED
	adminUser := &identity.AuthUser{
		ID:    "adm_trust",
		Email: "trust@aura.dating",
		Role:  identity.RoleTrustAndSafety,
	}

	err = svc.AdminOverrideAgeAssurance(ctx, adminUser, userID, safety.AdminAgeOverrideRequest{
		Status: safety.AgeVerified,
		Reason: "Manual passport review confirmed age 25",
	}, "127.0.0.1", "req_ovr_1")
	if err != nil {
		t.Fatalf("failed admin override: %v", err)
	}

	verified, err = svc.IsAgeVerified(ctx, userID)
	if err != nil {
		t.Fatalf("failed is age verified: %v", err)
	}
	if !verified {
		t.Errorf("user should now be age verified")
	}
}

// -----------------------------------------------------------------------------
// 6. Moderation, Reporting, SLA & Appeals Lifecycle Tests
// -----------------------------------------------------------------------------

func TestSafetyService_ModerationAndAppeals(t *testing.T) {
	svc, repo, idRepo, hub, _ := setupTestSafety(t)
	ctx := context.Background()

	reporter := &identity.AuthUser{
		ID:    "usr_reporter",
		Email: "reporter@aura.dating",
		Role:  identity.RoleMember,
	}

	targetUserID := "usr_offender"
	_ = idRepo.CreateUser(ctx, &identity.User{
		ID:     targetUserID,
		Email:  "offender@aura.dating",
		Status: identity.StatusActive,
		Role:   identity.RoleMember,
	})

	// 1. Submit report (Harassment -> Priority HIGH, 12h SLA)
	report, err := svc.SubmitReport(ctx, reporter, safety.CreateReportRequest{
		ReportedUserID: targetUserID,
		TargetType:     safety.TargetUser,
		TargetID:       targetUserID,
		Category:       safety.CategoryHarassment,
		Reason:         "Harassing messages in chat",
	}, "127.0.0.1", "req_rep_1")
	if err != nil {
		t.Fatalf("failed to submit report: %v", err)
	}
	if report.Status != safety.ReportPending {
		t.Errorf("expected ReportPending, got %s", report.Status)
	}

	// Open case should be generated
	openCase, err := repo.GetOpenCaseByTargetUser(ctx, targetUserID)
	if err != nil || openCase == nil {
		t.Fatalf("expected open case to be created, got %v", err)
	}
	if openCase.Priority != safety.PriorityHigh {
		t.Errorf("expected PriorityHigh for harassment, got %s", openCase.Priority)
	}

	// 2. Admin assigns case
	adminMod := &identity.AuthUser{
		ID:    "adm_mod_1",
		Email: "mod1@aura.dating",
		Role:  identity.RoleTrustAndSafety,
	}

	assignedCase, err := svc.AssignCase(ctx, adminMod, openCase.ID, adminMod.ID, "127.0.0.1", "req_assign_1")
	if err != nil {
		t.Fatalf("failed to assign case: %v", err)
	}
	if assignedCase.Status != safety.CaseInvestigating {
		t.Errorf("expected CaseInvestigating, got %s", assignedCase.Status)
	}

	// 3. Admin retrieves case details and audits evidence view
	details, err := svc.GetCaseDetails(ctx, adminMod, openCase.ID, "127.0.0.1", "req_det_1")
	if err != nil {
		t.Fatalf("failed to get case details: %v", err)
	}
	if len(details.Reports) != 1 {
		t.Errorf("expected 1 report in case details, got %d", len(details.Reports))
	}

	// 4. Admin executes BAN action
	action, err := svc.ExecuteModerationAction(ctx, adminMod, openCase.ID, safety.CreateModerationActionRequest{
		ActionType: safety.ActionBan,
		Reason:     "Confirmed severe harassment violating safety rules",
	}, "127.0.0.1", "req_act_1")
	if err != nil {
		t.Fatalf("failed to execute moderation action: %v", err)
	}
	if action.ActionType != safety.ActionBan {
		t.Errorf("expected ActionBan, got %s", action.ActionType)
	}

	// Check target user is banned and disconnected
	offenderUser, _ := idRepo.GetUserByID(ctx, targetUserID)
	if offenderUser.Status != identity.StatusBanned {
		t.Errorf("expected offender to be StatusBanned, got %s", offenderUser.Status)
	}
	if !hub.WasDisconnected(targetUserID) {
		t.Errorf("expected offender to be disconnected from WebSocket")
	}

	// 5. Offender submits Appeal
	offenderAuth := &identity.AuthUser{
		ID:    targetUserID,
		Email: "offender@aura.dating",
		Role:  identity.RoleMember,
	}
	appeal, err := svc.SubmitAppeal(ctx, offenderAuth, safety.CreateAppealRequest{
		ActionID: &action.ID,
		Reason:   "I believe this was a misunderstanding and I apologize",
	})
	if err != nil {
		t.Fatalf("failed to submit appeal: %v", err)
	}
	if appeal.Status != safety.AppealPending {
		t.Errorf("expected AppealPending, got %s", appeal.Status)
	}

	// 6. Admin decides Appeal -> APPROVED (Restores account)
	decidedAppeal, err := svc.DecideAppeal(ctx, adminMod, appeal.ID, safety.DecideAppealRequest{
		Approved:    true,
		ReviewNotes: "First offense, user acknowledged mistake and reviewed guidelines",
	}, "127.0.0.1", "req_dec_1")
	if err != nil {
		t.Fatalf("failed to decide appeal: %v", err)
	}
	if decidedAppeal.Status != safety.AppealApproved {
		t.Errorf("expected AppealApproved, got %s", decidedAppeal.Status)
	}

	restoredUser, _ := idRepo.GetUserByID(ctx, targetUserID)
	if restoredUser.Status != identity.StatusActive {
		t.Errorf("expected restored user to be StatusActive, got %s", restoredUser.Status)
	}

	// 7. Audit log verification
	logs, err := svc.QueryAuditLogs(ctx, adminMod, "", "", "", 50)
	if err != nil {
		t.Fatalf("failed to query audit logs: %v", err)
	}
	if len(logs) == 0 {
		t.Fatalf("expected recorded audit logs, got 0")
	}
}

// -----------------------------------------------------------------------------
// 7. Middleware Tests
// -----------------------------------------------------------------------------

func TestSafetyMiddleware(t *testing.T) {
	svc, _, idRepo, _, _ := setupTestSafety(t)
	ctx := context.Background()

	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// 1. RequireAgeVerified
	ageMw := safety.RequireAgeVerified(svc)
	wrappedAge := ageMw(testHandler)

	// Unauthenticated -> 401
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/community/feed", nil)
	wrappedAge.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized, got %d", rec.Code)
	}

	// Authenticated but unverified -> 403 AGE_VERIFICATION_REQUIRED
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/community/feed", nil)
	req = req.WithContext(identity.ContextWithAuthUser(ctx, &identity.AuthUser{
		ID:    "usr_unverified",
		Email: "unverified@aura.dating",
		Role:  identity.RoleMember,
	}))
	wrappedAge.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for unverified user, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "AGE_VERIFICATION_REQUIRED") {
		t.Errorf("expected AGE_VERIFICATION_REQUIRED error code in body: %s", rec.Body.String())
	}

	// 2. RequirePermission with Step-Up
	permMw := safety.RequirePermission(safety.PermFinanceApprove, true)
	wrappedPerm := permMw(testHandler)

	// User without finance permission -> 403 FORBIDDEN
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/admin/payouts/1/approve", nil)
	req = req.WithContext(identity.ContextWithAuthUser(ctx, &identity.AuthUser{
		ID:    "usr_member",
		Email: "member@aura.dating",
		Role:  identity.RoleMember,
	}))
	wrappedPerm.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden, got %d", rec.Code)
	}

	// User with finance permission but missing step-up -> 403 STEP_UP_REQUIRED
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/admin/payouts/1/approve", nil)
	req = req.WithContext(identity.ContextWithAuthUser(ctx, &identity.AuthUser{
		ID:    "adm_fin",
		Email: "finance@aura.dating",
		Role:  identity.RoleFinanceAdmin,
	}))
	wrappedPerm.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for missing step-up, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "STEP_UP_REQUIRED") {
		t.Errorf("expected STEP_UP_REQUIRED in body: %s", rec.Body.String())
	}

	// With step-up header -> 200 OK
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/admin/payouts/1/approve", nil)
	req.Header.Set("X-Aura-Step-Up", "verified")
	req = req.WithContext(identity.ContextWithAuthUser(ctx, &identity.AuthUser{
		ID:    "adm_fin",
		Email: "finance@aura.dating",
		Role:  identity.RoleFinanceAdmin,
	}))
	wrappedPerm.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 OK with valid step-up, got %d", rec.Code)
	}

	// 3. RequireActiveAccount
	_ = idRepo.CreateUser(ctx, &identity.User{
		ID:     "usr_banned",
		Email:  "banned@aura.dating",
		Status: identity.StatusBanned,
		Role:   identity.RoleMember,
	})

	activeMw := safety.RequireActiveAccount(idRepo)
	wrappedActive := activeMw(testHandler)

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/me", nil)
	req = req.WithContext(identity.ContextWithAuthUser(ctx, &identity.AuthUser{
		ID:    "usr_banned",
		Email: "banned@aura.dating",
		Role:  identity.RoleMember,
	}))
	wrappedActive.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for banned user, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "ACCOUNT_BANNED") {
		t.Errorf("expected ACCOUNT_BANNED code in body: %s", rec.Body.String())
	}
}

// -----------------------------------------------------------------------------
// 8. Handler HTTP Endpoint Unit Tests
// -----------------------------------------------------------------------------

func TestSafetyHandler_Endpoints(t *testing.T) {
	svc, repo, _, _, _ := setupTestSafety(t)
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	h := safety.NewHandler(svc, logger)
	ctx := context.Background()

	adminUser := &identity.AuthUser{
		ID:    "adm_ts",
		Email: "trust@aura.dating",
		Role:  identity.RoleTrustAndSafety,
	}

	// 1. POST /api/v1/age-assurance/session
	t.Run("StartAgeVerificationSession", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/age-assurance/session", nil)
		req = req.WithContext(identity.ContextWithAuthUser(ctx, &identity.AuthUser{
			ID:    "usr_test_sess",
			Email: "test@aura.dating",
			Role:  identity.RoleMember,
		}))
		rec := httptest.NewRecorder()
		h.StartAgeVerificationSession(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
		}
		var res safety.AgeAssuranceSessionResult
		if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if res.SessionID == "" {
			t.Errorf("expected non-empty session ID")
		}
	})

	// 2. GET /api/v1/age-assurance/status
	t.Run("GetAgeVerificationStatus", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/age-assurance/status", nil)
		req = req.WithContext(identity.ContextWithAuthUser(ctx, &identity.AuthUser{
			ID:    "usr_test_sess",
			Email: "test@aura.dating",
			Role:  identity.RoleMember,
		}))
		rec := httptest.NewRecorder()
		h.GetAgeVerificationStatus(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d", rec.Code)
		}
	})

	// 3. POST /api/v1/reports
	var createdReportID string
	t.Run("SubmitReport", func(t *testing.T) {
		body := `{"reported_user_id":"usr_target_99","target_type":"USER","target_id":"usr_target_99","category":"HARASSMENT","reason":"Harassing messages"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/reports", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(identity.ContextWithAuthUser(ctx, &identity.AuthUser{
			ID:    "usr_reporter_1",
			Email: "rep1@aura.dating",
			Role:  identity.RoleMember,
		}))
		rec := httptest.NewRecorder()
		h.SubmitReport(rec, req)

		if rec.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d: %s", rec.Code, rec.Body.String())
		}
		var rpt safety.ModerationReport
		if err := json.Unmarshal(rec.Body.Bytes(), &rpt); err != nil {
			t.Fatalf("failed to unmarshal report: %v", err)
		}
		createdReportID = rpt.ID
		if createdReportID == "" {
			t.Errorf("expected non-empty report ID")
		}
	})

	// 4. GET /api/v1/admin/moderation/cases
	t.Run("ListModerationCases", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/moderation/cases", nil)
		req = req.WithContext(identity.ContextWithAuthUser(ctx, adminUser))
		rec := httptest.NewRecorder()
		h.AdminCases(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Cases []safety.ModerationCase `json:"cases"`
			Count int                     `json:"count"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("failed to decode cases: %v", err)
		}
		if body.Count == 0 {
			t.Errorf("expected at least 1 moderation case created by report")
		}
	})

	// 5. POST /api/v1/appeals
	var appealID string
	t.Run("SubmitAppeal", func(t *testing.T) {
		body := `{"reason":"Please reconsider my case"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/appeals", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(identity.ContextWithAuthUser(ctx, &identity.AuthUser{
			ID:    "usr_target_99",
			Email: "target@aura.dating",
			Role:  identity.RoleMember,
		}))
		rec := httptest.NewRecorder()
		h.Appeals(rec, req)

		if rec.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d: %s", rec.Code, rec.Body.String())
		}
		var app safety.ModerationAppeal
		if err := json.Unmarshal(rec.Body.Bytes(), &app); err != nil {
			t.Fatalf("failed to parse appeal: %v", err)
		}
		appealID = app.ID
	})

	// 6. POST /api/v1/admin/moderation/appeals/{id}/decide
	t.Run("DecideAppeal", func(t *testing.T) {
		body := `{"approved":true,"review_notes":"Reinstated after review"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/moderation/appeals/"+appealID+"/decide", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(identity.ContextWithAuthUser(ctx, adminUser))
		rec := httptest.NewRecorder()
		h.AdminAppeals(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 7. GET /api/v1/admin/audit-logs
	t.Run("QueryAuditLogs", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/audit-logs", nil)
		req = req.WithContext(identity.ContextWithAuthUser(ctx, adminUser))
		rec := httptest.NewRecorder()
		h.AdminAuditLogs(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 8. Prevent Self-Action on Admin Endpoints
	t.Run("PreventSelfActionOnModeration", func(t *testing.T) {
		// Admin attempting to act on a case where the target is themselves
		c := &safety.ModerationCase{
			TargetUserID:    adminUser.ID,
			PrimaryCategory: safety.CategoryOther,
			Priority:        safety.PriorityLow,
			Status:          safety.CaseOpen,
			SLADueAt:        time.Now().Add(24 * time.Hour),
		}
		_ = repo.CreateCase(ctx, c)

		body := `{"action_type":"BAN","reason":"Self-ban test"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/moderation/cases/"+c.ID+"/actions", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(identity.ContextWithAuthUser(ctx, adminUser))
		rec := httptest.NewRecorder()
		h.AdminCases(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for self-action, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}

func TestTokenStepUpVerifier(t *testing.T) {
	secret := "secure_step_up_signing_secret_32bytes!"
	verifier := safety.NewTokenStepUpVerifier(secret)

	userID := "usr_admin_42"

	// 1. Valid token generation and verification
	token, err := verifier.GenerateStepUpToken(userID, 10*time.Minute)
	if err != nil {
		t.Fatalf("failed to generate step up token: %v", err)
	}

	if err := verifier.VerifyStepUpToken(token, userID); err != nil {
		t.Errorf("expected valid step up token, got: %v", err)
	}

	// 2. User mismatch rejected
	if err := verifier.VerifyStepUpToken(token, "usr_different_99"); err != safety.ErrStepUpUserMismatch {
		t.Errorf("expected ErrStepUpUserMismatch, got: %v", err)
	}

	// 3. Expired token rejected
	expiredToken, err := verifier.GenerateStepUpToken(userID, -1*time.Minute)
	if err != nil {
		t.Fatalf("failed to generate expired token: %v", err)
	}
	if err := verifier.VerifyStepUpToken(expiredToken, userID); err != safety.ErrInvalidStepUpToken {
		t.Errorf("expected ErrInvalidStepUpToken for expired token, got: %v", err)
	}

	// 4. Tampered signature rejected
	tampered := token + "evil"
	if err := verifier.VerifyStepUpToken(tampered, userID); err != safety.ErrInvalidStepUpToken {
		t.Errorf("expected ErrInvalidStepUpToken for tampered token, got: %v", err)
	}

	// 5. RequirePermission with StepUpVerifier enforces cryptographic verification
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mw := safety.RequirePermission(safety.PermFinanceApprove, true, verifier)
	wrapped := mw(testHandler)

	ctx := context.Background()
	adminUser := &identity.AuthUser{ID: userID, Email: "adm@aura.dating", Role: identity.RoleFinanceAdmin}

	// Arbitrary string header "verified" is REJECTED
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/payouts/approve", nil)
	req.Header.Set("X-Aura-Step-Up", "verified") // spoof attempt
	req = req.WithContext(identity.ContextWithAuthUser(ctx, adminUser))
	wrapped.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("spoofed X-Aura-Step-Up header must be rejected with 403, got %d", rec.Code)
	}

	// Authentic cryptographic step-up token is ACCEPTED
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/payouts/approve", nil)
	req.Header.Set("X-Aura-Step-Up", token)
	req = req.WithContext(identity.ContextWithAuthUser(ctx, adminUser))
	wrapped.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("authentic step-up token must be accepted with 200, got %d", rec.Code)
	}
}

func TestStepUpAuthEndpoint(t *testing.T) {
	svc, _, idRepo, _, _ := setupTestSafety(t)
	verifier := safety.NewTokenStepUpVerifier("test_step_up_secret_key_1234567890")
	svc.SetStepUpVerifier(verifier)
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	h := safety.NewHandler(svc, logger)
	ctx := context.Background()

	adminID := "usr_finance_admin"
	rawPassword := "Password123!Secure"
	hash, err := identity.HashPassword(rawPassword)
	if err != nil {
		t.Fatalf("failed to hash password: %v", err)
	}

	_ = idRepo.CreateUser(ctx, &identity.User{
		ID:           adminID,
		Email:        "fin@aura.dating",
		PasswordHash: hash,
		Role:         identity.RoleFinanceAdmin,
		Status:       identity.StatusActive,
	})

	adminAuth := &identity.AuthUser{ID: adminID, Email: "fin@aura.dating", Role: identity.RoleFinanceAdmin}

	// 1. Incorrect password returns 401
	body := `{"password":"WrongPassword123!"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/step-up", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(identity.ContextWithAuthUser(ctx, adminAuth))
	rec := httptest.NewRecorder()
	h.StepUpAuth(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for wrong password, got %d: %s", rec.Code, rec.Body.String())
	}

	// 2. Correct password returns 200 with valid step-up token
	body = `{"password":"` + rawPassword + `"}`
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/step-up", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(identity.ContextWithAuthUser(ctx, adminAuth))
	rec = httptest.NewRecorder()
	h.StepUpAuth(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for correct password, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		StepUpToken string `json:"step_up_token"`
		ExpiresAt   string `json:"expires_at"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse step-up response: %v", err)
	}
	if resp.StepUpToken == "" {
		t.Fatalf("expected non-empty step-up token")
	}

	// Token verifies cleanly against verifier
	if err := verifier.VerifyStepUpToken(resp.StepUpToken, adminID); err != nil {
		t.Errorf("issued step-up token must verify successfully, got: %v", err)
	}
}

// -----------------------------------------------------------------------------
// 10. Persona Age Assurance Security, Idempotency & Webhook Handler Tests
// -----------------------------------------------------------------------------

func TestSafetyService_AgeAssurance_Security(t *testing.T) {
	svc, _, _, _, _ := setupTestSafety(t)
	ctx := context.Background()
	secret := "test_webhook_secret_xyz"

	// 1. User mismatch rejection: session created for user_A, but webhook has reference-id user_B
	sess, err := svc.CreateAgeVerificationSession(ctx, "usr_alice", "alice@aura.dating", "127.0.0.1")
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	mismatchPayload := []byte(`{
		"event_id": "evt_mismatch_1",
		"data": {
			"id": "` + sess.SessionID + `",
			"attributes": {
				"status": "passed",
				"reference_id": "usr_bob_impersonator"
			}
		}
	}`)
	sig := createTestPersonaSignature(secret, time.Now().UTC().Unix(), mismatchPayload)
	_, err = svc.ProcessAgeVerificationWebhook(ctx, mismatchPayload, sig)
	if !errors.Is(err, safety.ErrUserMismatch) {
		t.Fatalf("expected ErrUserMismatch when reference-id doesn't match session owner, got %v", err)
	}

	// 2. Duplicate event idempotency
	validPayload := []byte(`{
		"event_id": "evt_idempotent_1",
		"data": {
			"id": "` + sess.SessionID + `",
			"attributes": {
				"status": "passed",
				"reference_id": "usr_alice"
			}
		}
	}`)
	sig = createTestPersonaSignature(secret, time.Now().UTC().Unix(), validPayload)

	// First delivery: succeeds and marks user VERIFIED
	res1, err := svc.ProcessAgeVerificationWebhook(ctx, validPayload, sig)
	if err != nil {
		t.Fatalf("first delivery failed: %v", err)
	}
	if res1.Status != safety.AgeVerified {
		t.Errorf("expected AgeVerified, got %s", res1.Status)
	}

	// Second delivery (duplicate): succeeds idempotently
	res2, err := svc.ProcessAgeVerificationWebhook(ctx, validPayload, sig)
	if err != nil {
		t.Fatalf("duplicate event must succeed idempotently, got %v", err)
	}
	if res2.Status != safety.AgeVerified {
		t.Errorf("expected AgeVerified on duplicate, got %s", res2.Status)
	}

	// 3. Monotonicity: verified status cannot be downgraded by delayed PENDING event
	pendingPayload := []byte(`{
		"event_id": "evt_delayed_pending_1",
		"data": {
			"id": "` + sess.SessionID + `",
			"attributes": {
				"status": "completed",
				"reference_id": "usr_alice"
			}
		}
	}`)
	pendingSig := createTestPersonaSignature(secret, time.Now().UTC().Unix(), pendingPayload)
	_, err = svc.ProcessAgeVerificationWebhook(ctx, pendingPayload, pendingSig)
	if err != nil {
		t.Fatalf("delayed pending event should be handled without error: %v", err)
	}

	status, err := svc.GetAgeAssuranceStatus(ctx, "usr_alice")
	if err != nil {
		t.Fatalf("failed to get status: %v", err)
	}
	if status.Status != safety.AgeVerified {
		t.Errorf("user status must remain VERIFIED and not be downgraded by delayed pending event, got %s", status.Status)
	}
}

func TestSafetyHandler_AgeVerificationWebhook(t *testing.T) {
	svc, _, _, _, _ := setupTestSafety(t)
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	h := safety.NewHandler(svc, logger)
	ctx := context.Background()
	secret := "test_webhook_secret_xyz"

	sess, err := svc.CreateAgeVerificationSession(ctx, "usr_webhook_test", "webhook@aura.dating", "127.0.0.1")
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	payload := []byte(`{
		"event_id": "evt_h_1",
		"data": {
			"id": "` + sess.SessionID + `",
			"attributes": {
				"status": "passed",
				"reference_id": "usr_webhook_test"
			}
		}
	}`)

	t.Run("MissingSignatureHeader", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/age-assurance/webhook", strings.NewReader(string(payload)))
		rec := httptest.NewRecorder()
		h.AgeVerificationWebhook(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 Unauthorized for missing signature, got %d", rec.Code)
		}
	})

	t.Run("ExpiredSignatureHeader", func(t *testing.T) {
		past := time.Now().UTC().Add(-10 * time.Minute).Unix()
		sig := createTestPersonaSignature(secret, past, payload)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/age-assurance/webhook", strings.NewReader(string(payload)))
		req.Header.Set("Persona-Signature", sig)
		rec := httptest.NewRecorder()
		h.AgeVerificationWebhook(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 Unauthorized for expired signature, got %d", rec.Code)
		}
	})

	t.Run("UserMismatchReturns403", func(t *testing.T) {
		mismatchPayload := []byte(`{
			"event_id": "evt_h_mismatch",
			"data": {
				"id": "` + sess.SessionID + `",
				"attributes": {
					"status": "passed",
					"reference_id": "usr_attacker"
				}
			}
		}`)
		sig := createTestPersonaSignature(secret, time.Now().UTC().Unix(), mismatchPayload)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/age-assurance/webhook", strings.NewReader(string(mismatchPayload)))
		req.Header.Set("Persona-Signature", sig)
		rec := httptest.NewRecorder()
		h.AgeVerificationWebhook(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Errorf("expected 403 Forbidden for user mismatch, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("ValidSignatureReturns200", func(t *testing.T) {
		sig := createTestPersonaSignature(secret, time.Now().UTC().Unix(), payload)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/age-assurance/webhook", strings.NewReader(string(payload)))
		req.Header.Set("Persona-Signature", sig)
		rec := httptest.NewRecorder()
		h.AgeVerificationWebhook(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected 200 OK for valid webhook, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}

type mockPassportEntitlementChecker struct {
	entitledUsers map[string]bool
}

func (m *mockPassportEntitlementChecker) HasPassportEntitlement(ctx context.Context, userID string) (bool, error) {
	return m.entitledUsers[userID], nil
}

func TestPassportVerificationTrialLifecycle(t *testing.T) {
	repo := safety.NewMemoryRepository()
	identRepo := identity.NewMemoryRepository()
	devProvider := safety.NewDevAgeAssuranceProvider("local")
	svc := safety.NewService(repo, identRepo, devProvider, nil, nil)
	mockChecker := &mockPassportEntitlementChecker{entitledUsers: make(map[string]bool)}
	svc.SetPassportEntitlementChecker(mockChecker)

	ctx := context.Background()
	userID := "usr_trial_tester_1"

	// 1. Initial trial status before first activation
	initialStatus, err := svc.GetPassportTrialStatus(ctx, userID)
	if err != nil {
		t.Fatalf("failed to get initial status: %v", err)
	}
	if initialStatus.HasStarted {
		t.Errorf("expected HasStarted=false before activation")
	}
	if initialStatus.RequiresUpgrade {
		t.Errorf("expected RequiresUpgrade=false before activation")
	}
	if !initialStatus.IsEntitled {
		t.Errorf("expected IsEntitled=true for eligible free user with unused 7-day trial")
	}

	// 2. First activation initiates 7-day trial
	sess, err := svc.CreateAgeVerificationSession(ctx, userID, "user@test.com", "127.0.0.1")
	if err != nil {
		t.Fatalf("first verification session should succeed: %v", err)
	}
	if sess.SessionID == "" {
		t.Errorf("expected non-empty session ID")
	}

	// Check status immediately after activation
	statusAfterStart, err := svc.GetPassportTrialStatus(ctx, userID)
	if err != nil {
		t.Fatalf("failed to get status after start: %v", err)
	}
	if !statusAfterStart.HasStarted || !statusAfterStart.IsActive {
		t.Errorf("expected active started trial, got: %+v", statusAfterStart)
	}
	if statusAfterStart.DaysRemaining < 6 || statusAfterStart.DaysRemaining > 7 {
		t.Errorf("expected 6-7 days remaining, got %d", statusAfterStart.DaysRemaining)
	}
	originalEndsAt := *statusAfterStart.EndsAt

	// 3. Subsequent session within trial period succeeds and does not extend ends_at
	_, err = svc.CreateAgeVerificationSession(ctx, userID, "user@test.com", "127.0.0.1")
	if err != nil {
		t.Fatalf("repeat session within trial should succeed: %v", err)
	}
	statusRepeat, _ := svc.GetPassportTrialStatus(ctx, userID)
	if !statusRepeat.EndsAt.Equal(originalEndsAt) {
		t.Errorf("repeat call must not extend trial duration, expected %v, got %v", originalEndsAt, statusRepeat.EndsAt)
	}

	// 4. Simulate trial expiration: set trial ends_at in the past
	expiredTrial := &safety.PassportVerificationTrial{
		UserID:    userID,
		StartedAt: time.Now().UTC().Add(-8 * 24 * time.Hour),
		EndsAt:    time.Now().UTC().Add(-1 * 24 * time.Hour),
		TrialUsed: true,
		CreatedAt: time.Now().UTC().Add(-8 * 24 * time.Hour),
		UpdatedAt: time.Now().UTC(),
	}
	_ = repo.SavePassportTrial(ctx, expiredTrial)

	// Status must reflect expired trial requiring upgrade
	expiredStatus, err := svc.GetPassportTrialStatus(ctx, userID)
	if err != nil {
		t.Fatalf("failed to get expired status: %v", err)
	}
	if expiredStatus.IsActive {
		t.Errorf("expired trial must not be active")
	}
	if !expiredStatus.RequiresUpgrade {
		t.Errorf("expired unentitled user must require upgrade")
	}

	// Attempting to create new verification session without entitlement must fail with ErrPassportTrialExpired
	_, err = svc.CreateAgeVerificationSession(ctx, userID, "user@test.com", "127.0.0.1")
	if !errors.Is(err, safety.ErrPassportTrialExpired) {
		t.Fatalf("expected ErrPassportTrialExpired for expired unentitled trial, got: %v", err)
	}

	// Mandatory basic age verification (e.g. selfie) must remain free even if passport trial has expired
	basicSess, err := svc.CreateAgeVerificationSession(ctx, userID, "user@test.com", "127.0.0.1", "selfie_asset_123")
	if err != nil {
		t.Fatalf("mandatory basic age verification must remain free even when passport trial expired: %v", err)
	}
	if basicSess.SessionID == "" {
		t.Errorf("expected valid session for mandatory basic age verification")
	}

	// 5. Test HTTP Handler mapping to 403 PASSPORT_TRIAL_EXPIRED
	handler := safety.NewHandler(svc, nil)
	authUser := &identity.AuthUser{ID: userID, Email: "user@test.com", Role: identity.RoleMember}
	authCtx := identity.ContextWithAuthUser(context.Background(), authUser)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/age-assurance/session", nil).WithContext(authCtx)
	rec := httptest.NewRecorder()
	handler.StartAgeVerificationSession(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden on expired trial, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "PASSPORT_TRIAL_EXPIRED") {
		t.Errorf("expected PASSPORT_TRIAL_EXPIRED in error code, got: %s", rec.Body.String())
	}

	// Test GET /api/v1/age-assurance/trial HTTP handler
	trialReq := httptest.NewRequest(http.MethodGet, "/api/v1/age-assurance/trial", nil).WithContext(authCtx)
	trialRec := httptest.NewRecorder()
	handler.GetPassportTrialStatus(trialRec, trialReq)

	if trialRec.Code != http.StatusOK {
		t.Errorf("expected 200 OK for trial status endpoint, got %d: %s", trialRec.Code, trialRec.Body.String())
	}
	if !strings.Contains(trialRec.Body.String(), "requires_upgrade") {
		t.Errorf("expected requires_upgrade in response, got: %s", trialRec.Body.String())
	}

	// 6. User upgrades to paid tier (Aura Plus / Aura Extra Premium)
	mockChecker.entitledUsers[userID] = true

	entitledStatus, _ := svc.GetPassportTrialStatus(ctx, userID)
	if !entitledStatus.IsEntitled {
		t.Errorf("expected IsEntitled=true after subscription upgrade")
	}
	if entitledStatus.RequiresUpgrade {
		t.Errorf("expected RequiresUpgrade=false after subscription upgrade")
	}

	// Session creation now succeeds
	entitledSess, err := svc.CreateAgeVerificationSession(ctx, userID, "user@test.com", "127.0.0.1")
	if err != nil {
		t.Fatalf("entitled subscriber should be able to create verification session even after trial expired: %v", err)
	}
	if entitledSess.SessionID == "" {
		t.Errorf("expected valid session for entitled user")
	}

	// 7. Verify that completed verification is preserved even if user is not currently in active trial
	now := time.Now().UTC()
	_ = repo.UpsertAgeAssurance(ctx, &safety.AgeAssurance{
		UserID:     userID,
		Provider:   "PERSONA",
		Status:     safety.AgeVerified,
		VerifiedAt: &now,
	})

	statusPreserved, _ := svc.GetPassportTrialStatus(ctx, userID)
	if statusPreserved.VerifiedStatus != safety.AgeVerified {
		t.Errorf("verified status must be preserved, expected VERIFIED, got: %s", statusPreserved.VerifiedStatus)
	}
}
