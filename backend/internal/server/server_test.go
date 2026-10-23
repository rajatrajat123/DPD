package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/affiliate"
	"github.com/auradating/platform/backend/internal/billing"
	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/events"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/safety"
)

type healthyProbe struct{}

func (healthyProbe) HealthCheck(_ context.Context) error {
	return nil
}

func TestServer_RoutesAndErrorEnvelope(t *testing.T) {
	t.Setenv("APP_ENV", "local")
	cfg, err := config.LoadFromEnv()
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	srv := New(cfg, logger, healthyProbe{}, healthyProbe{})
	t.Cleanup(func() {
		if srv.MediaService() != nil {
			srv.MediaService().Stop()
		}
	})

	t.Run("GET /healthz returns 200 with X-Request-ID", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d", rec.Code)
		}
		if rec.Header().Get("X-Request-ID") == "" {
			t.Errorf("expected X-Request-ID header on response")
		}
	})

	t.Run("GET /api/v1/readyz returns 200 when probes pass", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/readyz", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d", rec.Code)
		}
	})

	t.Run("GET /api/v1/migrations/manifest returns embedded SQL migrations", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/migrations/manifest", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
		}

		var body struct {
			Count int `json:"count"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("failed to parse manifest response: %v", err)
		}
		if body.Count < 4 {
			t.Errorf("expected at least 4 migrations in manifest, got %d", body.Count)
		}
	})

	t.Run("POST /api/v1/auth/register returns 201 Created through router", func(t *testing.T) {
		reqBody := `{"email":"testrouter@aura.dating","password":"Password123!Secure","display_name":"Router Test","birthdate":"1996-01-01","gender_identities":["non-binary"],"sexual_orientations":["queer"]}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(reqBody))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created from server router, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("POST /api/v1/media/upload rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/media/upload", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/media/stream/ missing token returns 403 Forbidden", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/media/stream/approved/test/thumb.jpg", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/discovery/feed rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/discovery/feed", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("POST /api/v1/swipes rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/swipes", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/matches rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/matches", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/conversations rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/conversations", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/ws rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/ws", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("POST /api/v1/notifications/push-token rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/notifications/push-token", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/billing/plans returns 200 OK with catalog", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/billing/plans", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("POST /api/v1/billing/checkout rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/checkout", strings.NewReader(`{"plan_code":"AURA_PLUS_MONTHLY"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/billing/subscription rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/billing/subscription", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/boosts/status rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/boosts/status", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /r/UNKNOWN returns 404 for non-existent partner code", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/r/NONEXISTENT", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected 404 Not Found, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("POST /api/v1/affiliates/register rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/affiliates/register", strings.NewReader(`{"partner_code":"TEST","terms_accepted":true}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/affiliates/me rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/affiliates/me", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/admin/affiliates rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/affiliates", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/affiliates/validate/{code} rejects invalid code with 404", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/affiliates/validate/NONEXISTENT_PARTNER", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected 404 Not Found, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("POST /api/v1/auth/register with invalid referral code fails with 400", func(t *testing.T) {
		payload := `{
			"email": "invalid_ref_reg@aura.dating",
			"password": "Password123!",
			"display_name": "Test User",
			"birthdate": "1995-05-15",
			"gender_identities": ["WOMAN"],
			"sexual_orientations": ["LESBIAN"],
			"referral_code": "DOES_NOT_EXIST"
		}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request on invalid referral code, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("POST /api/v1/age-assurance/session rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/age-assurance/session", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("POST /api/v1/reports rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/reports", strings.NewReader(`{"reported_user_id":"target","target_type":"USER","target_id":"target","category":"OTHER","reason":"test"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/admin/moderation/cases rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/moderation/cases", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/admin/audit-logs rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/audit-logs", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/discovery/feed and GET /api/v1/matches allow eligible adult pending verification", func(t *testing.T) {
		reqBody := `{"email":"adult_pending@aura.dating","password":"Password123!Secure","display_name":"Adult Pending User","birthdate":"1995-05-05","gender_identities":["non-binary"],"sexual_orientations":["queer"]}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(reqBody))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created from register, got %d: %s", rec.Code, rec.Body.String())
		}

		var authResp struct {
			AccessToken string `json:"access_token"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &authResp); err != nil {
			t.Fatalf("failed to decode auth response: %v", err)
		}

		// 1. Discovery feed is accessible to adult member with pending third-party verification
		feedReq := httptest.NewRequest(http.MethodGet, "/api/v1/discovery/feed", nil)
		feedReq.Header.Set("Authorization", "Bearer "+authResp.AccessToken)
		feedRec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(feedRec, feedReq)

		if feedRec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for adult pending user browsing feed, got %d: %s", feedRec.Code, feedRec.Body.String())
		}

		// 2. Matches is accessible to adult member with pending third-party verification
		matchReq := httptest.NewRequest(http.MethodGet, "/api/v1/matches", nil)
		matchReq.Header.Set("Authorization", "Bearer "+authResp.AccessToken)
		matchRec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(matchRec, matchReq)

		if matchRec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for adult pending user on matches, got %d: %s", matchRec.Code, matchRec.Body.String())
		}
	})

	t.Run("GET /unknown-route returns 404 standardized error envelope", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/does-not-exist", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected 404 Not Found, got %d", rec.Code)
		}

		var env struct {
			Error struct {
				Code      string `json:"code"`
				RequestID string `json:"request_id"`
			} `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("failed to unmarshal 404 JSON: %v", err)
		}
		if env.Error.Code != "RESOURCE_NOT_FOUND" {
			t.Errorf("expected error.code='RESOURCE_NOT_FOUND', got %q", env.Error.Code)
		}
		if env.Error.RequestID == "" {
			t.Errorf("expected non-empty error.request_id")
		}
	})

	t.Run("GET /api/v1/discovery/matching-summary rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/discovery/matching-summary", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/notifications/preferences rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/notifications/preferences", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/admin/analytics/summary rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/analytics/summary", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/admin/analytics/summary returns 200 OK for superadmin", func(t *testing.T) {
		adminUser := &identity.User{
			ID:    "superadmin-analytics-test",
			Email: "superadmin@aura.dating",
			Role:  identity.RoleSuperAdmin,
		}
		adminToken, err := identity.GenerateAccessToken(cfg.JWTSigningSecret, adminUser, 1*time.Hour)
		if err != nil {
			t.Fatalf("failed to generate admin token: %v", err)
		}

		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/analytics/summary", nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/cms/public returns 200 OK for seeded content", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/cms/public?key=homepage.hero", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/admin/cms/content RBAC enforcement", func(t *testing.T) {
		// Unauthenticated returns 401
		reqUnauth := httptest.NewRequest(http.MethodGet, "/api/v1/admin/cms/content", nil)
		recUnauth := httptest.NewRecorder()
		srv.Handler().ServeHTTP(recUnauth, reqUnauth)
		if recUnauth.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d", recUnauth.Code)
		}

		// Member returns 403 Forbidden
		memberUser := &identity.User{
			ID:    "member-test-01",
			Email: "member@aura.dating",
			Role:  identity.RoleMember,
		}
		memberToken, _ := identity.GenerateAccessToken(cfg.JWTSigningSecret, memberUser, 1*time.Hour)
		reqMember := httptest.NewRequest(http.MethodGet, "/api/v1/admin/cms/content", nil)
		reqMember.Header.Set("Authorization", "Bearer "+memberToken)
		recMember := httptest.NewRecorder()
		srv.Handler().ServeHTTP(recMember, reqMember)
		if recMember.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for member, got %d", recMember.Code)
		}

		// Editorial CMS returns 200 OK
		editorUser := &identity.User{
			ID:    "editor-test-01",
			Email: "editor@aura.dating",
			Role:  identity.RoleEditorialCMS,
		}
		editorToken, _ := identity.GenerateAccessToken(cfg.JWTSigningSecret, editorUser, 1*time.Hour)
		reqEditor := httptest.NewRequest(http.MethodGet, "/api/v1/admin/cms/content", nil)
		reqEditor.Header.Set("Authorization", "Bearer "+editorToken)
		recEditor := httptest.NewRecorder()
		srv.Handler().ServeHTTP(recEditor, reqEditor)
		if recEditor.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for editor, got %d: %s", recEditor.Code, recEditor.Body.String())
		}
	})

	t.Run("Admin Billing & Users RBAC and anti-self action", func(t *testing.T) {
		supportUser := &identity.User{
			ID:    "support-test-01",
			Email: "support@aura.dating",
			Role:  identity.RoleCustomerSupport,
		}
		supportToken, _ := identity.GenerateAccessToken(cfg.JWTSigningSecret, supportUser, 1*time.Hour)

		// Support can list users
		reqList := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil)
		reqList.Header.Set("Authorization", "Bearer "+supportToken)
		recList := httptest.NewRecorder()
		srv.Handler().ServeHTTP(recList, reqList)
		if recList.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for support user list, got %d: %s", recList.Code, recList.Body.String())
		}

		// Support cannot change roles (requires SuperAdmin)
		reqRole := httptest.NewRequest(http.MethodPut, "/api/v1/admin/users/member-test-01/role", strings.NewReader(`{"role":"SUPER_ADMIN"}`))
		reqRole.Header.Set("Authorization", "Bearer "+supportToken)
		recRole := httptest.NewRecorder()
		srv.Handler().ServeHTTP(recRole, reqRole)
		if recRole.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden when non-superadmin tries to change role, got %d", recRole.Code)
		}
	})
}

func TestServer_AffiliateBillingEventIntegration(t *testing.T) {
	t.Setenv("APP_ENV", "local")
	cfg, err := config.LoadFromEnv()
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	srv := New(cfg, logger, healthyProbe{}, healthyProbe{})
	t.Cleanup(func() {
		if srv.MediaService() != nil {
			srv.MediaService().Stop()
		}
	})

	ctx := context.Background()
	affSvc := srv.AffiliateService()
	affRepo := srv.AffiliateRepository()
	billingRepo := srv.BillingRepository()

	// 1. Register an affiliate partner
	aff, err := affSvc.RegisterAffiliate(ctx, "usr_aff_partner_server_1", affiliate.RegisterAffiliateRequest{
		PartnerCode:   "SERVER_INTEG_PARTNER",
		TermsAccepted: true,
	})
	if err != nil {
		t.Fatalf("failed to register affiliate: %v", err)
	}

	// 2. Attribute a registered user to the affiliate
	referredUser := "usr_referred_subscriber_1"
	_, err = affSvc.AttributeRegistration(ctx, referredUser, "SERVER_INTEG_PARTNER", "direct")
	if err != nil {
		t.Fatalf("failed to attribute registration: %v", err)
	}

	// 3. Billing verified purchase event is emitted through billingRepo (outbox)
	txID := "tx_verified_server_integ_001"
	verifiedPayload, err := json.Marshal(map[string]any{
		"transaction_id":      txID,
		"user_id":             referredUser,
		"gross_amount_cents":  3499,
		"net_amount_cents":    3499,
		"currency":            "USD",
		"billing_cycle_index": 1,
	})
	if err != nil {
		t.Fatalf("failed to marshal verified payload: %v", err)
	}

	verifiedEnv, err := events.NewEnvelope("billing_transaction", txID, "billing.transaction_verified.v1", "", 1, map[string]any{
		"transaction_id":      txID,
		"user_id":             referredUser,
		"gross_amount_cents":  3499,
		"net_amount_cents":    3499,
		"currency":            "USD",
		"billing_cycle_index": 1,
	})
	if err != nil {
		t.Fatalf("failed to create verified event envelope: %v", err)
	}
	_ = verifiedPayload

	if err := billingRepo.PublishOutboxEvent(ctx, verifiedEnv); err != nil {
		t.Fatalf("failed to publish verified event to billingRepo outbox: %v", err)
	}

	// Verify commission was automatically created via event dispatch
	comm, err := affRepo.GetCommissionByTransactionID(ctx, txID)
	if err != nil || comm == nil {
		t.Fatalf("expected commission created from billing event, got %v (comm=%v)", err, comm)
	}
	expectedCommAmount := int64((3499 * 2500) / 10000) // 25% default = 874 cents
	if comm.CommissionAmountCents != expectedCommAmount {
		t.Errorf("expected commission amount %d, got %d", expectedCommAmount, comm.CommissionAmountCents)
	}

	// Verify affiliate balances in escrow
	escrow, payable, paid, err := affRepo.GetAffiliateBalances(ctx, aff.ID)
	if err != nil {
		t.Fatalf("failed to get affiliate balances: %v", err)
	}
	if escrow != expectedCommAmount {
		t.Errorf("expected escrow %d, got %d", expectedCommAmount, escrow)
	}
	if payable != 0 || paid != 0 {
		t.Errorf("expected payable=0, paid=0; got payable=%d, paid=%d", payable, paid)
	}

	// 4. Duplicate verified event - verify idempotency
	dupEnv, err := events.NewEnvelope("billing_transaction", txID, "billing.transaction_verified.v1", "", 1, map[string]any{
		"transaction_id":      txID,
		"user_id":             referredUser,
		"gross_amount_cents":  3499,
		"net_amount_cents":    3499,
		"currency":            "USD",
		"billing_cycle_index": 1,
	})
	if err != nil {
		t.Fatalf("failed to create duplicate event envelope: %v", err)
	}
	if err := billingRepo.PublishOutboxEvent(ctx, dupEnv); err != nil {
		t.Fatalf("failed to publish duplicate event: %v", err)
	}
	escrowAfterDup, _, _, _ := affRepo.GetAffiliateBalances(ctx, aff.ID)
	if escrowAfterDup != escrow {
		t.Errorf("expected escrow to remain %d after duplicate, got %d", escrow, escrowAfterDup)
	}

	// 5. Refund event (billing.transaction_refunded.v1) - verify clawback and escrow reversal
	refundEnv, err := events.NewEnvelope("billing_transaction", txID, "billing.transaction_refunded.v1", "", 1, map[string]any{
		"transaction_id": txID,
		"refunded_cents": 3499,
	})
	if err != nil {
		t.Fatalf("failed to create refund event envelope: %v", err)
	}
	if err := billingRepo.PublishOutboxEvent(ctx, refundEnv); err != nil {
		t.Fatalf("failed to publish refund event: %v", err)
	}

	commAfterRefund, err := affRepo.GetCommissionByTransactionID(ctx, txID)
	if err != nil || commAfterRefund == nil {
		t.Fatalf("failed to get commission after refund: %v", err)
	}
	if commAfterRefund.Status != affiliate.CommissionClawedBack {
		t.Errorf("expected commission status %s, got %s", affiliate.CommissionClawedBack, commAfterRefund.Status)
	}

	escrowAfterRefund, _, _, _ := affRepo.GetAffiliateBalances(ctx, aff.ID)
	if escrowAfterRefund != 0 {
		t.Errorf("expected escrow 0 after refund clawback, got %d", escrowAfterRefund)
	}

	// 6. Second transaction with billing.refund_issued.v1 format (issued by admin refund)
	txID2 := "tx_verified_server_integ_002"
	verifiedEnv2, err := events.NewEnvelope("billing_transaction", txID2, "billing.transaction_verified.v1", "", 1, map[string]any{
		"transaction_id":      txID2,
		"user_id":             referredUser,
		"gross_amount_cents":  4999,
		"net_amount_cents":    4999,
		"currency":            "USD",
		"billing_cycle_index": 1,
	})
	if err != nil {
		t.Fatalf("failed to create second verified event: %v", err)
	}
	if err := billingRepo.PublishOutboxEvent(ctx, verifiedEnv2); err != nil {
		t.Fatalf("failed to publish second verified event: %v", err)
	}

	expectedComm2 := int64((4999 * 2500) / 10000)
	escrowBeforeRefund2, _, _, _ := affRepo.GetAffiliateBalances(ctx, aff.ID)
	if escrowBeforeRefund2 != expectedComm2 {
		t.Errorf("expected escrow %d, got %d", expectedComm2, escrowBeforeRefund2)
	}

	// Emit billing.refund_issued.v1 with AggregateID as txID
	refundIssuedEnv, err := events.NewEnvelope("billing_transaction", txID2, "billing.refund_issued.v1", "", 1, map[string]any{
		"amount_cents": 4999,
		"currency":     "USD",
		"reason":       "customer_request",
	})
	if err != nil {
		t.Fatalf("failed to create refund_issued event: %v", err)
	}
	if err := billingRepo.PublishOutboxEvent(ctx, refundIssuedEnv); err != nil {
		t.Fatalf("failed to publish refund_issued event: %v", err)
	}

	commAfterRefund2, err := affRepo.GetCommissionByTransactionID(ctx, txID2)
	if err != nil || commAfterRefund2 == nil {
		t.Fatalf("failed to get commission after refund_issued: %v", err)
	}
	if commAfterRefund2.Status != affiliate.CommissionClawedBack {
		t.Errorf("expected commission status %s, got %s", affiliate.CommissionClawedBack, commAfterRefund2.Status)
	}

	escrowAfterRefund2, _, _, _ := affRepo.GetAffiliateBalances(ctx, aff.ID)
	if escrowAfterRefund2 != 0 {
		t.Errorf("expected escrow 0 after refund_issued clawback, got %d", escrowAfterRefund2)
	}
}

func TestServer_AffiliateBillingEventFailureAndRetry(t *testing.T) {
	t.Setenv("APP_ENV", "local")
	cfg, err := config.LoadFromEnv()
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	srv := New(cfg, logger, healthyProbe{}, healthyProbe{})
	t.Cleanup(func() {
		if srv.MediaService() != nil {
			srv.MediaService().Stop()
		}
	})

	ctx := context.Background()
	affSvc := srv.AffiliateService()
	affRepo := srv.AffiliateRepository()
	billingRepo := srv.BillingRepository()

	// 1. Register affiliate & attribute user
	aff, err := affSvc.RegisterAffiliate(ctx, "usr_aff_retry_partner", affiliate.RegisterAffiliateRequest{
		PartnerCode:   "RETRY_PARTNER",
		TermsAccepted: true,
	})
	if err != nil {
		t.Fatalf("failed to register affiliate: %v", err)
	}
	referredUser := "usr_retry_customer"
	_, err = affSvc.AttributeRegistration(ctx, referredUser, "RETRY_PARTNER", "social")
	if err != nil {
		t.Fatalf("failed to attribute user: %v", err)
	}

	// 2. Simulate affiliate service transient unavailability during verified purchase
	dec, ok := billingRepo.(*affiliateBillingOutboxDecorator)
	if !ok {
		t.Fatalf("expected billingRepo to be affiliateBillingOutboxDecorator")
	}
	dec.mu.Lock()
	dec.affSvc = nil // Temporarily detach to simulate handler outage
	dec.mu.Unlock()

	txID1 := "tx_retry_purchase_001"
	verifiedEnv1, err := events.NewEnvelope("billing_transaction", txID1, "billing.transaction_verified.v1", "", 1, map[string]any{
		"transaction_id":      txID1,
		"user_id":             referredUser,
		"gross_amount_cents":  2999,
		"net_amount_cents":    2999,
		"currency":            "USD",
		"billing_cycle_index": 1,
	})
	if err != nil {
		t.Fatalf("failed to create verified event envelope: %v", err)
	}

	// Publish outbox event - outbox persistence MUST succeed even when handler is unavailable
	if err := billingRepo.PublishOutboxEvent(ctx, verifiedEnv1); err != nil {
		t.Fatalf("expected outbox event to be safely persisted, got: %v", err)
	}

	// Verify event was queued for retry in failed events
	if srv.PendingAffiliateBillingEventsCount() != 1 {
		t.Fatalf("expected 1 pending affiliate event queued for retry, got %d", srv.PendingAffiliateBillingEventsCount())
	}

	// Verify commission was NOT yet created
	commBeforeRetry, _ := affRepo.GetCommissionByTransactionID(ctx, txID1)
	if commBeforeRetry != nil {
		t.Fatalf("expected commission to not exist yet before recovery")
	}

	// 3. Reconnect affiliate service and trigger recovery
	dec.mu.Lock()
	dec.affSvc = affSvc
	dec.mu.Unlock()

	recovered, err := srv.RetryPendingAffiliateBillingEvents(ctx)
	if err != nil {
		t.Fatalf("unexpected error during retry recovery: %v", err)
	}
	if recovered != 1 {
		t.Fatalf("expected 1 event recovered, got %d", recovered)
	}
	if srv.PendingAffiliateBillingEventsCount() != 0 {
		t.Fatalf("expected 0 pending events after successful retry, got %d", srv.PendingAffiliateBillingEventsCount())
	}

	// Verify commission was safely created and balances updated
	commAfterRetry, err := affRepo.GetCommissionByTransactionID(ctx, txID1)
	if err != nil || commAfterRetry == nil {
		t.Fatalf("expected commission to exist after recovery, got %v", err)
	}
	expectedComm := int64((2999 * 2500) / 10000)
	if commAfterRetry.CommissionAmountCents != expectedComm {
		t.Errorf("expected commission %d, got %d", expectedComm, commAfterRetry.CommissionAmountCents)
	}
	escrow, _, _, _ := affRepo.GetAffiliateBalances(ctx, aff.ID)
	if escrow != expectedComm {
		t.Errorf("expected escrow %d, got %d", expectedComm, escrow)
	}

	// 4. Retry again to verify idempotency - must not double-credit or fail
	recoveredAgain, err := srv.RetryPendingAffiliateBillingEvents(ctx)
	if err != nil {
		t.Fatalf("idempotent retry failed: %v", err)
	}
	if recoveredAgain != 0 {
		t.Errorf("expected 0 events on second retry, got %d", recoveredAgain)
	}
	escrowAgain, _, _, _ := affRepo.GetAffiliateBalances(ctx, aff.ID)
	if escrowAgain != expectedComm {
		t.Errorf("expected escrow unchanged %d, got %d", expectedComm, escrowAgain)
	}

	// 5. Test Refund failure and recovery
	dec.mu.Lock()
	dec.affSvc = nil // Temporarily detach to simulate outage during refund
	dec.mu.Unlock()

	refundEnv, err := events.NewEnvelope("billing_transaction", txID1, "billing.transaction_refunded.v1", "", 1, map[string]any{
		"transaction_id": txID1,
		"refunded_cents": 2999,
	})
	if err != nil {
		t.Fatalf("failed to create refund event envelope: %v", err)
	}

	if err := billingRepo.PublishOutboxEvent(ctx, refundEnv); err != nil {
		t.Fatalf("expected outbox event to be safely persisted, got: %v", err)
	}

	if srv.PendingAffiliateBillingEventsCount() != 1 {
		t.Fatalf("expected 1 pending refund event queued, got %d", srv.PendingAffiliateBillingEventsCount())
	}

	// Commission status should still be PENDING_CLEARANCE before recovery
	commBeforeRefundRetry, _ := affRepo.GetCommissionByTransactionID(ctx, txID1)
	if commBeforeRefundRetry.Status != affiliate.CommissionPendingClearance {
		t.Errorf("expected status %s before refund retry, got %s", affiliate.CommissionPendingClearance, commBeforeRefundRetry.Status)
	}

	// Reconnect service and retry refund
	dec.mu.Lock()
	dec.affSvc = affSvc
	dec.mu.Unlock()

	recoveredRefund, err := srv.RetryPendingAffiliateBillingEvents(ctx)
	if err != nil {
		t.Fatalf("error during refund retry recovery: %v", err)
	}
	if recoveredRefund != 1 {
		t.Fatalf("expected 1 refund event recovered, got %d", recoveredRefund)
	}
	if srv.PendingAffiliateBillingEventsCount() != 0 {
		t.Fatalf("expected 0 pending events after refund retry, got %d", srv.PendingAffiliateBillingEventsCount())
	}

	commAfterRefundRetry, _ := affRepo.GetCommissionByTransactionID(ctx, txID1)
	if commAfterRefundRetry.Status != affiliate.CommissionClawedBack {
		t.Errorf("expected status %s after refund retry, got %s", affiliate.CommissionClawedBack, commAfterRefundRetry.Status)
	}
	escrowAfterRefund, _, _, _ := affRepo.GetAffiliateBalances(ctx, aff.ID)
	if escrowAfterRefund != 0 {
		t.Errorf("expected escrow 0 after refund retry, got %d", escrowAfterRefund)
	}
}

func TestServer_AffiliateBillingEventRestartRecovery(t *testing.T) {
	t.Setenv("APP_ENV", "local")
	cfg, err := config.LoadFromEnv()
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))

	// Shared durable repositories representing external storage (PostgreSQL/Redis/persisted database)
	identRepo := identity.NewMemoryRepository()
	baseBillingRepo := billing.NewMemoryRepository()
	affRepo := affiliate.NewMemoryRepository()

	ctx := context.Background()

	// 1. PROCESS 1 (Initial Server run):
	srv1 := NewWithCustomRepos(cfg, logger, healthyProbe{}, healthyProbe{}, []identity.Repository{identRepo}, baseBillingRepo, affRepo)
	t.Cleanup(func() {
		if srv1 != nil && srv1.MediaService() != nil {
			srv1.MediaService().Stop()
		}
	})

	// Setup affiliate partner and attribution on Server 1
	affSvc1 := srv1.AffiliateService()
	aff, err := affSvc1.RegisterAffiliate(ctx, "usr_aff_restart_partner", affiliate.RegisterAffiliateRequest{
		PartnerCode:   "RESTART_PARTNER",
		TermsAccepted: true,
	})
	if err != nil {
		t.Fatalf("failed to register affiliate on srv1: %v", err)
	}
	referredUser := "usr_restart_buyer"
	_, err = affSvc1.AttributeRegistration(ctx, referredUser, "RESTART_PARTNER", "campaign_restart")
	if err != nil {
		t.Fatalf("failed to attribute user on srv1: %v", err)
	}

	// 2. Verified purchase occurs and is written into durable outbox, but Server 1 crashes before in-memory dispatch
	txID := "tx_restart_durability_001"
	verifiedEnv, err := events.NewEnvelope("billing_transaction", txID, "billing.transaction_verified.v1", "", 1, map[string]any{
		"transaction_id":      txID,
		"user_id":             referredUser,
		"gross_amount_cents":  3999,
		"net_amount_cents":    3999,
		"currency":            "USD",
		"billing_cycle_index": 1,
	})
	if err != nil {
		t.Fatalf("failed to create verified event envelope: %v", err)
	}

	// Persist outbox event directly into base durable storage (simulating outbox write right before crash)
	if err := baseBillingRepo.PublishOutboxEvent(ctx, verifiedEnv); err != nil {
		t.Fatalf("failed to persist outbox event: %v", err)
	}

	// Verify commission does NOT exist yet on Server 1
	commPreRestart, _ := affRepo.GetCommissionByTransactionID(ctx, txID)
	if commPreRestart != nil {
		t.Fatalf("expected commission to not exist prior to restart recovery")
	}

	// CRASH / TERMINATE PROCESS 1
	if srv1.MediaService() != nil {
		srv1.MediaService().Stop()
	}
	srv1 = nil // Completely tear down Server 1 and destroy all in-memory buffers

	// 3. PROCESS 2 (Server restart with durable storage):
	// Fresh server starts up against the same persisted storage
	srv2 := NewWithCustomRepos(cfg, logger, healthyProbe{}, healthyProbe{}, []identity.Repository{identRepo}, baseBillingRepo, affRepo)
	t.Cleanup(func() {
		if srv2 != nil && srv2.MediaService() != nil {
			srv2.MediaService().Stop()
		}
	})

	// Server 2 starts with an empty in-memory failedEvents queue
	if srv2.PendingAffiliateBillingEventsCount() != 0 {
		t.Errorf("expected clean in-memory state on Server 2 restart, got %d", srv2.PendingAffiliateBillingEventsCount())
	}

	// On Server 2 startup, SetAffiliateService automatically executed RecoverPersistedOutbox!
	// Verify that the persisted verified purchase was successfully recovered:
	commPostRestart, err := affRepo.GetCommissionByTransactionID(ctx, txID)
	if err != nil || commPostRestart == nil {
		t.Fatalf("expected commission to be recovered from persisted outbox on restart, got: %v", err)
	}
	expectedComm := int64((3999 * 2500) / 10000) // 25% = 999 cents
	if commPostRestart.CommissionAmountCents != expectedComm {
		t.Errorf("expected commission %d, got %d", expectedComm, commPostRestart.CommissionAmountCents)
	}

	escrowPostRestart, _, _, err := affRepo.GetAffiliateBalances(ctx, aff.ID)
	if err != nil {
		t.Fatalf("failed to get balances: %v", err)
	}
	if escrowPostRestart != expectedComm {
		t.Errorf("expected escrow %d after restart recovery, got %d", expectedComm, escrowPostRestart)
	}

	// 4. REFUND OUTBOX PERSISTENCE & RESTART RECOVERY:
	refundEnv, err := events.NewEnvelope("billing_transaction", txID, "billing.transaction_refunded.v1", "", 1, map[string]any{
		"transaction_id": txID,
		"refunded_cents": 3999,
	})
	if err != nil {
		t.Fatalf("failed to create refund event envelope: %v", err)
	}

	// Persist refund into durable outbox while Server 2 is shutting down
	if err := baseBillingRepo.PublishOutboxEvent(ctx, refundEnv); err != nil {
		t.Fatalf("failed to persist refund event: %v", err)
	}

	// Terminate Server 2
	if srv2.MediaService() != nil {
		srv2.MediaService().Stop()
	}
	srv2 = nil

	// PROCESS 3 (Restart Server 3):
	srv3 := NewWithCustomRepos(cfg, logger, healthyProbe{}, healthyProbe{}, []identity.Repository{identRepo}, baseBillingRepo, affRepo)
	t.Cleanup(func() {
		if srv3 != nil && srv3.MediaService() != nil {
			srv3.MediaService().Stop()
		}
	})

	// Verify refund was recovered from persisted outbox on restart
	commRefundRecovered, err := affRepo.GetCommissionByTransactionID(ctx, txID)
	if err != nil || commRefundRecovered == nil {
		t.Fatalf("failed to get commission after refund recovery: %v", err)
	}
	if commRefundRecovered.Status != affiliate.CommissionClawedBack {
		t.Errorf("expected status %s after restart refund recovery, got %s", affiliate.CommissionClawedBack, commRefundRecovered.Status)
	}

	escrowRefundRecovered, _, _, _ := affRepo.GetAffiliateBalances(ctx, aff.ID)
	if escrowRefundRecovered != 0 {
		t.Errorf("expected escrow 0 after refund restart recovery, got %d", escrowRefundRecovered)
	}

	// 5. Verify Idempotency of durable recovery
	recoveredAgain, err := srv3.RecoverPersistedOutboxEvents(ctx)
	if err != nil {
		t.Fatalf("unexpected error re-running persisted outbox recovery: %v", err)
	}
	if recoveredAgain != 2 {
		t.Errorf("expected 2 outbox events evaluated idempotently, got %d", recoveredAgain)
	}
	escrowFinal, _, _, _ := affRepo.GetAffiliateBalances(ctx, aff.ID)
	if escrowFinal != 0 {
		t.Errorf("expected escrow balance unchanged at 0, got %d", escrowFinal)
	}
}

func TestServer_SuperAdminAuthorizationAndAudit(t *testing.T) {
	t.Setenv("APP_ENV", "local")
	cfg, err := config.LoadFromEnv()
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	srv := New(cfg, logger, healthyProbe{}, healthyProbe{})
	t.Cleanup(func() {
		if srv.MediaService() != nil {
			srv.MediaService().Stop()
		}
	})

	ctx := context.Background()
	idRepo := srv.IdentityRepository()
	safetyRepo := srv.SafetyRepository()

	// Create test users
	memberUser := &identity.User{
		ID:        "usr_member_01",
		Email:     "member@aura.dating",
		Role:      identity.RoleMember,
		Status:    identity.StatusActive,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	_ = idRepo.CreateUser(ctx, memberUser)
	memberToken, _ := identity.GenerateAccessToken(cfg.JWTSigningSecret, memberUser, 1*time.Hour)

	supportUser := &identity.User{
		ID:        "usr_support_01",
		Email:     "support@aura.dating",
		Role:      identity.RoleCustomerSupport,
		Status:    identity.StatusActive,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	_ = idRepo.CreateUser(ctx, supportUser)
	supportToken, _ := identity.GenerateAccessToken(cfg.JWTSigningSecret, supportUser, 1*time.Hour)

	superAdminUser := &identity.User{
		ID:        "usr_superadmin_01",
		Email:     "superadmin@aura.dating",
		Role:      identity.RoleSuperAdmin,
		Status:    identity.StatusActive,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	_ = idRepo.CreateUser(ctx, superAdminUser)
	superAdminToken, _ := identity.GenerateAccessToken(cfg.JWTSigningSecret, superAdminUser, 1*time.Hour)

	stepUpVerifier := safety.NewTokenStepUpVerifier(cfg.JWTSigningSecret)
	superAdminStepUp, err := stepUpVerifier.GenerateStepUpToken(superAdminUser.ID, 15*time.Minute)
	if err != nil {
		t.Fatalf("failed to generate step-up token: %v", err)
	}

	targetUser := &identity.User{
		ID:        "usr_target_candidate",
		Email:     "candidate@aura.dating",
		Role:      identity.RoleMember,
		Status:    identity.StatusActive,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	_ = idRepo.CreateUser(ctx, targetUser)

	t.Run("Normal member is denied Super Admin API routes", func(t *testing.T) {
		// Attempt role modification
		req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/users/usr_target_candidate/role", strings.NewReader(`{"role":"SUPER_ADMIN"}`))
		req.Header.Set("Authorization", "Bearer "+memberToken)
		req.Header.Set("X-Aura-Step-Up", "step-up-pass")
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for normal member on role modification, got %d", rec.Code)
		}

		// Attempt platform config access
		reqConfig := httptest.NewRequest(http.MethodGet, "/api/v1/admin/config", nil)
		reqConfig.Header.Set("Authorization", "Bearer "+memberToken)
		recConfig := httptest.NewRecorder()
		srv.Handler().ServeHTTP(recConfig, reqConfig)
		if recConfig.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for normal member on config API, got %d", recConfig.Code)
		}
	})

	t.Run("Non-superadmin admin is denied role modification and config", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/users/usr_target_candidate/role", strings.NewReader(`{"role":"SUPER_ADMIN"}`))
		req.Header.Set("Authorization", "Bearer "+supportToken)
		req.Header.Set("X-Aura-Step-Up", "step-up-pass")
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for support admin, got %d", rec.Code)
		}

		reqConfig := httptest.NewRequest(http.MethodGet, "/api/v1/admin/config", nil)
		reqConfig.Header.Set("Authorization", "Bearer "+supportToken)
		recConfig := httptest.NewRecorder()
		srv.Handler().ServeHTTP(recConfig, reqConfig)
		if recConfig.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for support admin on config, got %d", recConfig.Code)
		}
	})

	t.Run("Super Admin cannot promote or modify their own role (anti-self-action)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/users/"+superAdminUser.ID+"/role", strings.NewReader(`{"role":"SUPER_ADMIN"}`))
		req.Header.Set("Authorization", "Bearer "+superAdminToken)
		req.Header.Set("X-Aura-Step-Up", superAdminStepUp)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden when superadmin attempts self-action, got %d", rec.Code)
		}

		// Verify audit log recorded self-action rejection
		logs, err := safetyRepo.ListAuditLogs(ctx, superAdminUser.ID, "admin.role_update_rejected", "USER", 10)
		if err != nil {
			t.Fatalf("failed to query audit logs: %v", err)
		}
		if len(logs) == 0 {
			t.Fatalf("expected audit log for rejected self-action role modification")
		}
		if logs[0].Outcome != safety.AuditFailure {
			t.Errorf("expected audit outcome FAILURE, got %s", logs[0].Outcome)
		}
	})

	t.Run("Super Admin can promote other users and action is audited", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/users/"+targetUser.ID+"/role", strings.NewReader(`{"role":"TRUST_AND_SAFETY"}`))
		req.Header.Set("Authorization", "Bearer "+superAdminToken)
		req.Header.Set("X-Aura-Step-Up", superAdminStepUp)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for superadmin role modification, got %d: %s", rec.Code, rec.Body.String())
		}

		// Verify user role was updated in DB
		updatedUser, err := idRepo.GetUserByID(ctx, targetUser.ID)
		if err != nil || updatedUser == nil {
			t.Fatalf("failed to get updated user: %v", err)
		}
		if updatedUser.Role != identity.RoleTrustAndSafety {
			t.Errorf("expected role TRUST_AND_SAFETY, got %s", updatedUser.Role)
		}

		// Verify audit log was recorded
		logs, err := safetyRepo.ListAuditLogs(ctx, superAdminUser.ID, "admin.role_updated", "USER", 10)
		if err != nil {
			t.Fatalf("failed to query audit logs: %v", err)
		}
		if len(logs) == 0 {
			t.Fatalf("expected audit log for successful role update")
		}
		if logs[0].Outcome != safety.AuditSuccess {
			t.Errorf("expected audit outcome SUCCESS, got %s", logs[0].Outcome)
		}
	})

	t.Run("Super Admin config updates are audited", func(t *testing.T) {
		payload := `{"swipe_feed_ad_interval": 10, "native_match_list_ad_interval": 5, "min_seconds_between_interstitials": 30}`
		req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/config/advertising", strings.NewReader(payload))
		req.Header.Set("Authorization", "Bearer "+superAdminToken)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for config update, got %d: %s", rec.Code, rec.Body.String())
		}

		logs, err := safetyRepo.ListAuditLogs(ctx, superAdminUser.ID, "admin.config_updated", "CONFIG", 10)
		if err != nil {
			t.Fatalf("failed to query audit logs: %v", err)
		}
		if len(logs) == 0 {
			t.Fatalf("expected audit log for config update")
		}
		if logs[0].TargetID != "advertising" {
			t.Errorf("expected target ID 'advertising', got %s", logs[0].TargetID)
		}
	})

	t.Run("Super Admin user management returns login method, subscription status, pagination without secrets", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users?limit=10&offset=0", nil)
		req.Header.Set("Authorization", "Bearer "+superAdminToken)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for admin users, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Users []map[string]any `json:"users"`
			Total int              `json:"total"`
			Limit int              `json:"limit"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode admin users response: %v", err)
		}
		if len(resp.Users) == 0 {
			t.Fatalf("expected users in response")
		}

		first := resp.Users[0]
		if _, hasMethod := first["login_method"]; !hasMethod {
			t.Errorf("expected login_method in user item")
		}
		if _, hasTier := first["subscription_tier"]; !hasTier {
			t.Errorf("expected subscription_tier in user item")
		}
		if _, hasStatus := first["subscription_status"]; !hasStatus {
			t.Errorf("expected subscription_status in user item")
		}

		// Verify absolute secrecy: password hash and location data must NEVER be exposed
		rawJSON := rec.Body.String()
		if strings.Contains(rawJSON, "password_hash") || strings.Contains(rawJSON, "$argon2id$") {
			t.Fatalf("CRITICAL SECURITY VIOLATION: password hash exposed in admin users response!")
		}
		if strings.Contains(rawJSON, "latitude") || strings.Contains(rawJSON, "longitude") {
			t.Fatalf("CRITICAL PRIVACY VIOLATION: precise location data exposed in admin users list!")
		}
	})

	t.Run("Super Admin pricing management updates catalog price and records audit log", func(t *testing.T) {
		payload := `{"price_cents": 2499, "currency": "USD"}`
		req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/billing/products/AURA_PLUS_MONTHLY", strings.NewReader(payload))
		req.Header.Set("Authorization", "Bearer "+superAdminToken)
		req.Header.Set("X-Aura-Step-Up", superAdminStepUp)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for pricing update, got %d: %s", rec.Code, rec.Body.String())
		}

		logs, err := safetyRepo.ListAuditLogs(ctx, superAdminUser.ID, "admin.pricing_updated", "BILLING_PRODUCT", 10)
		if err != nil {
			t.Fatalf("failed to query audit logs: %v", err)
		}
		if len(logs) == 0 {
			t.Fatalf("expected audit log for pricing update")
		}
		if logs[0].TargetID != "AURA_PLUS_MONTHLY" {
			t.Errorf("expected target ID 'AURA_PLUS_MONTHLY', got %s", logs[0].TargetID)
		}
	})

	t.Run("Affiliate management endpoints allow viewing campaigns, conversions and commissions", func(t *testing.T) {
		// Campaigns
		reqCamp := httptest.NewRequest(http.MethodGet, "/api/v1/admin/affiliates/campaigns", nil)
		reqCamp.Header.Set("Authorization", "Bearer "+superAdminToken)
		recCamp := httptest.NewRecorder()
		srv.Handler().ServeHTTP(recCamp, reqCamp)
		if recCamp.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for admin campaigns, got %d", recCamp.Code)
		}

		// Conversions
		reqConv := httptest.NewRequest(http.MethodGet, "/api/v1/admin/affiliates/conversions", nil)
		reqConv.Header.Set("Authorization", "Bearer "+superAdminToken)
		recConv := httptest.NewRecorder()
		srv.Handler().ServeHTTP(recConv, reqConv)
		if recConv.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for admin conversions, got %d", recConv.Code)
		}

		// Commissions
		reqComm := httptest.NewRequest(http.MethodGet, "/api/v1/admin/affiliates/commissions", nil)
		reqComm.Header.Set("Authorization", "Bearer "+superAdminToken)
		recComm := httptest.NewRecorder()
		srv.Handler().ServeHTTP(recComm, reqComm)
		if recComm.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for admin commissions, got %d", recComm.Code)
		}
	})
}
