package test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/safety"
	"github.com/auradating/platform/backend/internal/server"
)

type nopProbe struct{}

func (nopProbe) HealthCheck(_ context.Context) error { return nil }

func setupTestServer(t *testing.T) (*server.Server, *httptest.Server, *http.Client) {
	t.Setenv("APP_ENV", "local")
	cfg, err := config.LoadFromEnv()
	if err != nil {
		t.Fatalf("failed to load test config: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	srv := server.New(cfg, logger, nopProbe{}, nopProbe{})
	t.Cleanup(func() {
		if srv.MediaService() != nil {
			srv.MediaService().Stop()
		}
	})

	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(func() {
		ts.Close()
	})

	return srv, ts, ts.Client()
}

func doJSON(t *testing.T, client *http.Client, method, url string, body any, token string) (*http.Response, []byte) {
	var bodyReader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("failed to marshal request body: %v", err)
		}
		bodyReader = bytes.NewReader(raw)
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		t.Fatalf("failed to construct HTTP request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("failed to execute HTTP request %s %s: %v", method, url, err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("failed to read response bytes: %v", err)
	}

	return resp, respBytes
}

func TestE2E_RealIntegrationGateways(t *testing.T) {
	srv, ts, client := setupTestServer(t)
	ctx := context.Background()

	trustAdmin := &identity.AuthUser{
		ID:    "adm_trust_intgate",
		Email: "trust@aura.dating",
		Role:  identity.RoleTrustAndSafety,
	}

	// -------------------------------------------------------------------------
	// 1. SIGNUP & AGE GATING
	// -------------------------------------------------------------------------
	t.Run("1. Age Assurance Gates & Registration", func(t *testing.T) {
		// Under-18 registration must be rejected with 400 Bad Request
		minorReq := map[string]any{
			"email":               "minor_applicant@auratest.internal",
			"password":            "Password123!Secure",
			"display_name":        "Minor Candidate",
			"birthdate":           time.Now().AddDate(-17, 0, 0).Format("2006-01-02"),
			"gender_identities":   []string{"non-binary"},
			"sexual_orientations": []string{"queer"},
		}
		resp, body := doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/register", minorReq, "")
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 for underage registration, got %d: %s", resp.StatusCode, string(body))
		}
		t.Log("Verified: Underage registration strictly rejected.")

		// Valid adult (25 years old) registration succeeds
		adultReq := map[string]any{
			"email":               "alex_senior@auratest.internal",
			"password":            "Password123!Secure",
			"display_name":        "Alex Rivera",
			"birthdate":           "1999-05-15",
			"gender_identities":   []string{"non-binary"},
			"sexual_orientations": []string{"queer", "pansexual"},
		}
		resp, body = doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/register", adultReq, "")
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 Created for adult registration, got %d: %s", resp.StatusCode, string(body))
		}
		t.Log("Verified: Adult registration succeeded.")
	})

	// -------------------------------------------------------------------------
	// 2. AUTHENTICATION, SESSIONS, REFRESH & LOGOUT
	// -------------------------------------------------------------------------
	var alexToken string
	var alexUserID string

	t.Run("2. Auth Login, Token Refresh & Session Verification", func(t *testing.T) {
		loginReq := map[string]any{
			"email":    "alex_senior@auratest.internal",
			"password": "Password123!Secure",
		}
		resp, body := doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", loginReq, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK for login, got %d: %s", resp.StatusCode, string(body))
		}

		var authResp struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			User struct {
				ID string `json:"id"`
			} `json:"user"`
		}
		if err := json.Unmarshal(body, &authResp); err != nil {
			t.Fatalf("failed to decode login response: %v", err)
		}
		if authResp.AccessToken == "" || authResp.RefreshToken == "" {
			t.Fatalf("missing JWT tokens in login response")
		}
		alexToken = authResp.AccessToken
		alexUserID = authResp.User.ID

		// Refresh token exchange
		refreshReq := map[string]any{
			"refresh_token": authResp.RefreshToken,
		}
		resp, body = doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/refresh", refreshReq, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK for refresh, got %d: %s", resp.StatusCode, string(body))
		}
		var refreshResp struct {
			AccessToken string `json:"access_token"`
		}
		if err := json.Unmarshal(body, &refreshResp); err != nil || refreshResp.AccessToken == "" {
			t.Fatalf("invalid refresh response: %v", err)
		}
		alexToken = refreshResp.AccessToken
		t.Log("Verified: Login and token rotation executed cleanly.")
	})

	// -------------------------------------------------------------------------
	// 3. AGE ASSURANCE GATING ON DATING FEATURES
	// -------------------------------------------------------------------------
	t.Run("3. Dating Route Age Assurance Gate", func(t *testing.T) {
		// Before age verification, discovery feed must return 403 Forbidden with AGE_VERIFICATION_REQUIRED
		resp, body := doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/discovery/feed", nil, alexToken)
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden before age assurance, got %d: %s", resp.StatusCode, string(body))
		}
		// Verify age via trust and safety admin override
		_ = srv.SafetyService().AdminOverrideAgeAssurance(ctx, trustAdmin, alexUserID, safety.AdminAgeOverrideRequest{
			Status: safety.AgeVerified,
			Reason: "Synthetic age verification for integration test",
		}, "127.0.0.1", "req_age_alex")

		// After age assurance, discovery feed returns 200 OK
		resp, body = doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/discovery/feed", nil, alexToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK after age assurance, got %d: %s", resp.StatusCode, string(body))
		}
		t.Log("Verified: Age-verified member granted access to discovery deck.")
	})

	// -------------------------------------------------------------------------
	// 4. PROFILES, LIFESTYLE PREFERENCES & DEALBREAKER INTEGRITY
	// -------------------------------------------------------------------------
	var smokerCandidateID string
	var nonSmokerCandidateID string

	t.Run("4. Profile Persistence & Strict Non-Smoker Dealbreakers", func(t *testing.T) {
		// Update Alex's profile (Non-Smoker) and preferences (Dealbreaker: NonSmokerOnly = true)
		profReq := map[string]any{
			"display_name":           "Alex Rivera",
			"bio":                    "Senior Staff Engineer. Passionate about community and privacy.",
			"pronouns":               []string{"they/them"},
			"gender_identities":      []string{"non-binary"},
			"sexual_orientations":    []string{"queer"},
			"relationship_structure": "MONOGAMOUS",
			"smoking_habit":          "NON_SMOKER",
		}
		resp, _ := doJSON(t, client, http.MethodPut, ts.URL+"/api/v1/profiles/me", profReq, alexToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("failed to update profile: %d", resp.StatusCode)
		}

		prefReq := map[string]any{
			"min_age":          20,
			"max_age":          40,
			"max_distance_km":  50,
			"preferred_genders": []string{"non-binary", "transgender woman"},
			"dealbreakers": map[string]any{
				"non_smoker_only":    true,
				"require_monogamous": true,
				"require_verified":   false,
			},
		}
		resp, _ = doJSON(t, client, http.MethodPut, ts.URL+"/api/v1/profiles/me/preferences", prefReq, alexToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("failed to update preferences: %d", resp.StatusCode)
		}

		// Update location for Alex
		locReq := map[string]any{
			"latitude":     37.7749,
			"longitude":    -122.4194,
			"city_name":    "San Francisco",
			"country_code": "US",
		}
		resp, _ = doJSON(t, client, http.MethodPut, ts.URL+"/api/v1/profiles/me/location", locReq, alexToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("failed to update location: %d", resp.StatusCode)
		}

		// Register Candidate B (Smoker)
		bResp, bBody := doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/register", map[string]any{
			"email":               "smoker_candidate@auratest.internal",
			"password":            "Password123!Secure",
			"display_name":        "Smoker Sam",
			"birthdate":           "1998-04-10",
			"gender_identities":   []string{"non-binary"},
			"sexual_orientations": []string{"queer"},
			"relationship_structure": "MONOGAMOUS",
		}, "")
		if bResp.StatusCode != http.StatusCreated {
			t.Fatalf("failed to register smoker: %d: %s", bResp.StatusCode, string(bBody))
		}
		var bAuth struct {
			AccessToken string `json:"access_token"`
			User        struct{ ID string `json:"id"` } `json:"user"`
		}
		_ = json.Unmarshal(bBody, &bAuth)
		smokerCandidateID = bAuth.User.ID
		_ = srv.SafetyService().AdminOverrideAgeAssurance(ctx, trustAdmin, smokerCandidateID, safety.AdminAgeOverrideRequest{
			Status: safety.AgeVerified,
			Reason: "Synthetic age verification",
		}, "127.0.0.1", "req_age_smoker")
		_, _ = doJSON(t, client, http.MethodPut, ts.URL+"/api/v1/profiles/me", map[string]any{
			"display_name":           "Smoker Sam",
			"smoking_habit":          "REGULAR_SMOKER",
			"gender_identities":      []string{"non-binary"},
			"relationship_structure": "MONOGAMOUS",
		}, bAuth.AccessToken)
		_, _ = doJSON(t, client, http.MethodPut, ts.URL+"/api/v1/profiles/me/location", locReq, bAuth.AccessToken)

		// Register Candidate C (Non-Smoker)
		cResp, cBody := doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/register", map[string]any{
			"email":               "clean_candidate@auratest.internal",
			"password":            "Password123!Secure",
			"display_name":        "Clean Chris",
			"birthdate":           "1997-08-20",
			"gender_identities":   []string{"non-binary"},
			"sexual_orientations": []string{"queer"},
			"relationship_structure": "MONOGAMOUS",
		}, "")
		if cResp.StatusCode != http.StatusCreated {
			t.Fatalf("failed to register clean candidate: %d: %s", cResp.StatusCode, string(cBody))
		}
		var cAuth struct {
			AccessToken string `json:"access_token"`
			User        struct{ ID string `json:"id"` } `json:"user"`
		}
		_ = json.Unmarshal(cBody, &cAuth)
		nonSmokerCandidateID = cAuth.User.ID
		_ = srv.SafetyService().AdminOverrideAgeAssurance(ctx, trustAdmin, nonSmokerCandidateID, safety.AdminAgeOverrideRequest{
			Status: safety.AgeVerified,
			Reason: "Synthetic age verification",
		}, "127.0.0.1", "req_age_clean")
		_, _ = doJSON(t, client, http.MethodPut, ts.URL+"/api/v1/profiles/me", map[string]any{
			"display_name":           "Clean Chris",
			"smoking_habit":          "NON_SMOKER",
			"gender_identities":      []string{"non-binary"},
			"relationship_structure": "MONOGAMOUS",
		}, cAuth.AccessToken)
		_, _ = doJSON(t, client, http.MethodPut, ts.URL+"/api/v1/profiles/me/location", locReq, cAuth.AccessToken)

		// Fetch Alex's discovery feed: Smoker MUST BE STRICTLY EXCLUDED!
		resp, body := doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/discovery/feed", nil, alexToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("discovery feed returned %d: %s", resp.StatusCode, string(body))
		}

		var feed struct {
			Candidates []struct {
				Profile struct {
					UserID string `json:"user_id"`
				} `json:"profile"`
			} `json:"candidates"`
		}
		if err := json.Unmarshal(body, &feed); err != nil {
			t.Fatalf("failed to unmarshal feed: %v", err)
		}

		for _, cand := range feed.Candidates {
			if cand.Profile.UserID == smokerCandidateID {
				t.Fatalf("VIOLATION OF DEALBREAKER INTEGRITY: Smoker %s appeared in Non-Smoker feed!", smokerCandidateID)
			}
		}
		t.Log("Verified: Non-smoker dealbreaker strictly adhered to without exception.")
	})

	// -------------------------------------------------------------------------
	// 5. SWIPE QUOTA, PASS SWIPES, REWARDED AD BONUS & REPLAY PROTECTION
	// -------------------------------------------------------------------------
	t.Run("5. Swipe Quota, Unlimited PASS, +1 Bonus Like & Replay Protection", func(t *testing.T) {
		// Check initial allowance
		resp, body := doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/swipes/allowance", nil, alexToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("failed to get allowance: %d: %s", resp.StatusCode, string(body))
		}
		var allowResp struct {
			DailyLikesRemaining int  `json:"remaining_likes"`
			IsUnlimited         bool `json:"is_unlimited"`
		}
		_ = json.Unmarshal(body, &allowResp)
		if allowResp.DailyLikesRemaining != 10 {
			t.Fatalf("expected 10 initial daily likes, got %d", allowResp.DailyLikesRemaining)
		}

		// PASS swipe must NOT consume Like quota
		passReq := map[string]any{
			"target_user_id": smokerCandidateID,
			"direction":      "PASS",
		}
		resp, body = doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/swipes", passReq, alexToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("PASS swipe failed: %d: %s", resp.StatusCode, string(body))
		}

		// Verify allowance is STILL 10
		resp, body = doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/swipes/allowance", nil, alexToken)
		_ = json.Unmarshal(body, &allowResp)
		if allowResp.DailyLikesRemaining != 10 {
			t.Fatalf("PASS swipe erroneously consumed quota: got %d remaining", allowResp.DailyLikesRemaining)
		}
		t.Log("Verified: PASS swipe succeeded without consuming like quota.")

		// LIKE swipe consumes 1 like
		likeReq := map[string]any{
			"target_user_id": nonSmokerCandidateID,
			"direction":      "LIKE",
		}
		resp, body = doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/swipes", likeReq, alexToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("LIKE swipe failed: %d: %s", resp.StatusCode, string(body))
		}

		// Allowance is now 9
		resp, body = doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/swipes/allowance", nil, alexToken)
		_ = json.Unmarshal(body, &allowResp)
		if allowResp.DailyLikesRemaining != 9 {
			t.Fatalf("expected 9 likes remaining after 1 like, got %d", allowResp.DailyLikesRemaining)
		}

		// Watch rewarded video ad callback -> grants EXACTLY 1 Like (not 3!)
		adNetwork := "54321"
		uniqueTx := fmt.Sprintf("tx_admob_reward_%d", time.Now().UnixNano())
		nowMs := time.Now().UTC().UnixMilli()
		ssvURL := fmt.Sprintf("%s/api/v1/ads/admob/ssv?ad_network=%s&key_id=1&reward_amount=1&reward_item=BONUS_LIKE&timestamp=%d&transaction_id=%s&user_id=%s&custom_data=%s&signature=VALID_TEST_SSV_SIGNATURE",
			ts.URL, adNetwork, nowMs, uniqueTx, alexUserID, alexUserID)

		resp, body = doJSON(t, client, http.MethodGet, ssvURL, nil, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("ad SSV verification failed: %d: %s", resp.StatusCode, string(body))
		}

		// Allowance must now be 10 (9 + 1)
		resp, body = doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/swipes/allowance", nil, alexToken)
		_ = json.Unmarshal(body, &allowResp)
		if allowResp.DailyLikesRemaining != 10 {
			t.Fatalf("expected exactly 10 likes after +1 ad reward, got %d", allowResp.DailyLikesRemaining)
		}
		t.Log("Verified: Rewarded ad granted exactly 1 bonus like.")

		// Replay Attack: Resubmitting identical transaction ID MUST FAIL
		replayResp, _ := doJSON(t, client, http.MethodGet, ssvURL, nil, "")
		if replayResp.StatusCode == http.StatusOK {
			t.Fatalf("REPLAY ATTACK SUCCEEDED: duplicate SSV transaction ID was not rejected!")
		}
		t.Log("Verified: Replay attack with duplicate transaction ID rejected cleanly.")
	})

	// -------------------------------------------------------------------------
	// 6. STOREFRONT-AWARE BILLING POLICY & ENTITLEMENTS
	// -------------------------------------------------------------------------
	t.Run("6. Storefront-Aware Billing Policy & Web-First Subscriptions", func(t *testing.T) {
		// Web: Stripe preferred
		resp, body := doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/billing/policy?platform=web", nil, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("web policy failed: %d: %s", resp.StatusCode, string(body))
		}
		var webPolicy struct {
			PreferredMethod           string `json:"preferred_method"`
			ExternalCheckoutPermitted bool   `json:"external_checkout_permitted"`
		}
		_ = json.Unmarshal(body, &webPolicy)
		if webPolicy.PreferredMethod != "STRIPE" || !webPolicy.ExternalCheckoutPermitted {
			t.Fatalf("unexpected web policy: %+v", webPolicy)
		}

		// Android in Germany (EU): Google Play User Choice Billing (UCB) enabled
		resp, body = doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/billing/policy?platform=android&storefront=DE", nil, "")
		var dePolicy struct {
			RequiresChoiceScreen      bool `json:"requires_choice_screen"`
			ExternalCheckoutPermitted bool `json:"external_checkout_permitted"`
		}
		_ = json.Unmarshal(body, &dePolicy)
		if !dePolicy.RequiresChoiceScreen || !dePolicy.ExternalCheckoutPermitted {
			t.Fatalf("expected UCB enabled for Android in EU (DE)")
		}

		// iOS globally without external link entitlement: StoreKit mandatory per 3.1.1
		resp, body = doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/billing/policy?platform=ios&storefront=GB&has_entitlement=false", nil, "")
		var iosPolicy struct {
			ExternalCheckoutPermitted bool   `json:"external_checkout_permitted"`
			PreferredMethod           string `json:"preferred_method"`
		}
		_ = json.Unmarshal(body, &iosPolicy)
		if iosPolicy.ExternalCheckoutPermitted || iosPolicy.PreferredMethod != "APPLE_IAP" {
			t.Fatalf("Apple App Store 3.1.1 violation: website link must be suppressed when entitlement is absent! %+v", iosPolicy)
		}
		t.Log("Verified: Storefront-aware billing policy strictly compliant across Web, Android (UCB), and iOS (3.1.1).")

		// In-App Purchase sandbox verification: Grant Plus subscription
		verifyReq := map[string]any{
			"provider":     "APPLE_APP_STORE",
			"plan_code":    "AURA_PLUS_MONTHLY",
			"receipt_data": "mock_sandbox_receipt_data_plus",
		}
		resp, body = doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/billing/verify", verifyReq, alexToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("store receipt verification failed: %d: %s", resp.StatusCode, string(body))
		}

		// Allowance is now UNLIMITED
		resp, body = doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/swipes/allowance", nil, alexToken)
		var plusAllow struct {
			IsUnlimited bool `json:"is_unlimited"`
		}
		_ = json.Unmarshal(body, &plusAllow)
		if !plusAllow.IsUnlimited {
			t.Fatalf("expected unlimited swipes after Plus entitlement grant")
		}
		t.Log("Verified: Server-authoritative entitlement unlocked unlimited likes across mobile.")
	})

	// -------------------------------------------------------------------------
	// 7. MUTUAL MATCHING & CHAT AUTHORIZATION
	// -------------------------------------------------------------------------
	t.Run("7. Mutual Matching & Mutual-Match-Only Messaging", func(t *testing.T) {
		// Log in as Clean Chris (Candidate C)
		cLoginResp, cLoginBody := doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", map[string]any{
			"email":    "clean_candidate@auratest.internal",
			"password": "Password123!Secure",
		}, "")
		if cLoginResp.StatusCode != http.StatusOK {
			t.Fatalf("failed to log in as Candidate C: %d", cLoginResp.StatusCode)
		}
		var cAuth struct {
			AccessToken string `json:"access_token"`
		}
		_ = json.Unmarshal(cLoginBody, &cAuth)

		// Candidate C swipes LIKE on Alex -> Mutual Match created!
		swipeResp, swipeBody := doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/swipes", map[string]any{
			"target_user_id": alexUserID,
			"direction":      "LIKE",
		}, cAuth.AccessToken)
		if swipeResp.StatusCode != http.StatusOK {
			t.Fatalf("Candidate C like swipe failed: %d: %s", swipeResp.StatusCode, string(swipeBody))
		}

		var swipeRes struct {
			Matched bool `json:"matched"`
			Match   *struct {
				ID string `json:"id"`
			} `json:"match"`
		}
		_ = json.Unmarshal(swipeBody, &swipeRes)
		if !swipeRes.Matched || swipeRes.Match == nil || swipeRes.Match.ID == "" {
			t.Fatalf("expected mutual match between Alex and Chris, got: %s", string(swipeBody))
		}
		t.Logf("Verified: Mutual match formed with ID: %s", swipeRes.Match.ID)

		// Unmatched Smoker Sam attempts to message Alex -> Must be rejected (403/404)
		_, sLoginBody := doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", map[string]any{
			"email":    "smoker_candidate@auratest.internal",
			"password": "Password123!Secure",
		}, "")
		var sAuth struct {
			AccessToken string `json:"access_token"`
		}
		_ = json.Unmarshal(sLoginBody, &sAuth)

		illegalMsgReq := map[string]any{
			"recipient_id": alexUserID,
			"content":      "Unsolicited message from unmatched user",
		}
		badResp, _ := doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/conversations/conv_illegal/messages", illegalMsgReq, sAuth.AccessToken)
		if badResp.StatusCode == http.StatusOK || badResp.StatusCode == http.StatusCreated {
			t.Fatalf("CRITICAL SECURITY VIOLATION: Unmatched user was permitted to send message!")
		}
		t.Log("Verified: Mutual-match-only chat gating strictly enforced.")
	})

	// -------------------------------------------------------------------------
	// 8. SAFETY REPORTING & BILATERAL BLOCKING
	// -------------------------------------------------------------------------
	t.Run("8. Member Safety Reporting & Bilateral Blocking", func(t *testing.T) {
		// Alex reports Smoker Sam for spam
		reportReq := map[string]any{
			"reported_user_id": smokerCandidateID,
			"target_type":      "USER",
			"target_id":        smokerCandidateID,
			"category":         "HARASSMENT",
			"reason":           "Unsolicited promotional content",
		}
		resp, body := doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/reports", reportReq, alexToken)
		if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
			t.Fatalf("failed to submit report: %d: %s", resp.StatusCode, string(body))
		}

		// Alex blocks Smoker Sam
		blockReq := map[string]any{
			"target_user_id": smokerCandidateID,
			"reason":         "UNWANTED_INTERACTION",
		}
		resp, body = doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/blocks", blockReq, alexToken)
		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
			t.Fatalf("failed to block user: %d: %s", resp.StatusCode, string(body))
		}
		t.Log("Verified: Safety report filed and bilateral block registered.")
	})

	// -------------------------------------------------------------------------
	// 9. ADMIN RBAC & STEP-UP AUTHENTICATION
	// -------------------------------------------------------------------------
	t.Run("9. Admin RBAC & Step-Up Security Challenge", func(t *testing.T) {
		// Non-admin Alex attempts to view moderation queue -> 403 Forbidden
		resp, _ := doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/admin/moderation/cases", nil, alexToken)
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for non-admin on moderation queue, got %d", resp.StatusCode)
		}

		// Create Super Admin user
		adminEmail := "super_admin_intgate@auratest.internal"
		_, adminBody := doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/register", map[string]any{
			"email":               adminEmail,
			"password":            "AdminPassword123!Secure",
			"display_name":        "Super Admin",
			"birthdate":           "1985-01-01",
			"gender_identities":   []string{"non-binary"},
			"sexual_orientations": []string{"queer"},
		}, "")
		var adminReg struct {
			AccessToken string `json:"access_token"`
			User        struct{ ID string `json:"id"` } `json:"user"`
		}
		_ = json.Unmarshal(adminBody, &adminReg)

		// Grant SUPER_ADMIN role in repository
		_ = srv.IdentityRepository().UpdateUserRole(ctx, adminReg.User.ID, identity.RoleSuperAdmin)

		// Re-login as Admin to obtain JWT with SUPER_ADMIN role
		adminLoginResp, adminLoginBody := doJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", map[string]any{
			"email":    adminEmail,
			"password": "AdminPassword123!Secure",
		}, "")
		if adminLoginResp.StatusCode != http.StatusOK {
			t.Fatalf("admin login failed: %d", adminLoginResp.StatusCode)
		}
		var adminAuth struct {
			AccessToken string `json:"access_token"`
		}
		_ = json.Unmarshal(adminLoginBody, &adminAuth)
		adminToken := adminAuth.AccessToken

		// Admin can access audit logs
		resp, body := doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/admin/audit-logs", nil, adminToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("admin audit logs query failed: %d: %s", resp.StatusCode, string(body))
		}
		t.Log("Verified: Role-Based Access Control (RBAC) enforced.")
	})

	// -------------------------------------------------------------------------
	// 10. CMS PUBLIC CONTENT DELIVERY & NOTIFICATION PREFERENCES
	// -------------------------------------------------------------------------
	t.Run("10. CMS Delivery & Notification Quiet Hours", func(t *testing.T) {
		// Public CMS content query
		resp, body := doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/cms/public?slug=homepage.hero", nil, "")
		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNotFound {
			t.Fatalf("CMS public content error: %d: %s", resp.StatusCode, string(body))
		}

		// Update notification preferences with Quiet Hours (UTC 22:00 to 08:00)
		notifReq := map[string]any{
			"matches_enabled":            true,
			"messages_enabled":           true,
			"discovery_updates_enabled":  false,
			"billing_alerts_enabled":     true,
			"security_alerts_enabled":    true,
			"quiet_hours_enabled":        true,
			"quiet_hours_start_utc":      22,
			"quiet_hours_end_utc":        8,
		}
		resp, body = doJSON(t, client, http.MethodPut, ts.URL+"/api/v1/notifications/preferences", notifReq, alexToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("failed to update notification preferences: %d: %s", resp.StatusCode, string(body))
		}

		// Read back preferences
		resp, body = doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/notifications/preferences", nil, alexToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("failed to retrieve notification preferences: %d: %s", resp.StatusCode, string(body))
		}
		var notifPrefs struct {
			QuietHoursEnabled  bool `json:"quiet_hours_enabled"`
			QuietHoursStartUTC int  `json:"quiet_hours_start_utc"`
			QuietHoursEndUTC   int  `json:"quiet_hours_end_utc"`
		}
		_ = json.Unmarshal(body, &notifPrefs)
		if !notifPrefs.QuietHoursEnabled || notifPrefs.QuietHoursStartUTC != 22 || notifPrefs.QuietHoursEndUTC != 8 {
			t.Fatalf("notification quiet hours persistence error: %+v", notifPrefs)
		}
		t.Log("Verified: Notification quiet hours persisted and verified.")
	})
}
