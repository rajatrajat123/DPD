package analytics_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/analytics"
	"github.com/auradating/platform/backend/internal/identity"
)

func TestAnalytics_SummaryAndPrivacyInvariants(t *testing.T) {
	repo := analytics.NewMemoryRepository()
	svc := analytics.NewService(repo, nil)
	ctx := context.Background()

	summary, err := svc.GetPlatformSummary(ctx)
	if err != nil {
		t.Fatalf("failed to get summary: %v", err)
	}

	if summary.Funnel.TotalRegisteredUsers <= 0 {
		t.Errorf("expected positive total registered users, got %d", summary.Funnel.TotalRegisteredUsers)
	}
	if summary.Subscriptions.ActiveSubscriptions <= 0 {
		t.Errorf("expected positive active subscriptions, got %d", summary.Subscriptions.ActiveSubscriptions)
	}
	if summary.Notifications.Delivered <= 0 {
		t.Errorf("expected positive delivered notifications, got %d", summary.Notifications.Delivered)
	}

	// CRITICAL PRIVACY INVARIANT: Ensure serialized JSON never leaks sensitive individual fields
	jsonBytes, err := json.Marshal(summary)
	if err != nil {
		t.Fatalf("failed to marshal summary: %v", err)
	}

	jsonStr := strings.ToLower(string(jsonBytes))
	bannedTerms := []string{
		"sexual_orientation",
		"gender_identity",
		"latitude",
		"longitude",
		"raw_gps",
		"photo_url",
		"chat_message",
	}

	for _, banned := range bannedTerms {
		if strings.Contains(jsonStr, banned) {
			t.Errorf("privacy violation: analytics JSON contains banned sensitive term %q", banned)
		}
	}
}

func TestAnalytics_AdminHTTPEndpoint(t *testing.T) {
	repo := analytics.NewMemoryRepository()
	svc := analytics.NewService(repo, nil)
	handler := analytics.NewHandler(svc)

	jwtSecret := "test-jwt-secret-key-32b-must-be-long-enough"
	authMw := identity.RequireAuth(jwtSecret)

	adminUser := &identity.User{
		ID:    "admin-user-1",
		Email: "admin@aura.dating",
		Role:  identity.RoleSuperAdmin,
	}
	token, _ := identity.GenerateAccessToken(jwtSecret, adminUser, 1*time.Hour)

	mux := http.NewServeMux()
	mux.Handle("/api/v1/admin/analytics/summary", authMw(http.HandlerFunc(handler.Summary)))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/analytics/summary", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from analytics summary endpoint, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp analytics.AnalyticsSummaryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse analytics JSON: %v", err)
	}

	if resp.Funnel.TotalRegisteredUsers != 150 {
		t.Errorf("expected 150 users, got %d", resp.Funnel.TotalRegisteredUsers)
	}
}
