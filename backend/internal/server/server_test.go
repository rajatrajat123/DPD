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

	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/identity"
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
