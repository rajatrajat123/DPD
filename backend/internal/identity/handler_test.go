package identity

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func setupTestRouter() (http.Handler, *Service, string) {
	repo := NewMemoryRepository()
	secret := "test-secret-at-least-32-bytes-long-for-hmac-sha256"
	svc := NewService(repo, secret, WithFastCrypto())
	handler := NewHandler(svc, 1024*1024)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/register", handler.Register)
	mux.HandleFunc("/api/v1/auth/login", handler.Login)
	mux.HandleFunc("/api/v1/auth/refresh", handler.RefreshToken)
	mux.HandleFunc("/api/v1/auth/logout", handler.Logout)
	mux.HandleFunc("/api/v1/auth/password-reset/request", handler.RequestPasswordReset)
	mux.HandleFunc("/api/v1/auth/password-reset/confirm", handler.ConfirmPasswordReset)
	mux.HandleFunc("/auth/reset-password", handler.ResetPasswordWebPage)

	authMiddleware := RequireAuth(secret)
	mux.Handle("/api/v1/auth/verify/send", authMiddleware(http.HandlerFunc(handler.SendVerification)))
	mux.Handle("/api/v1/auth/verify/confirm", authMiddleware(http.HandlerFunc(handler.ConfirmVerification)))
	mux.Handle("/api/v1/profiles/me", authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handler.GetMyProfile(w, r)
		} else if r.Method == http.MethodPut {
			handler.UpdateMyProfile(w, r)
		}
	})))
	mux.Handle("/api/v1/profiles/me/location", authMiddleware(http.HandlerFunc(handler.UpdateMyLocation)))
	mux.Handle("/api/v1/profiles/me/preferences", authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handler.GetMyPreferences(w, r)
		} else if r.Method == http.MethodPut {
			handler.UpdateMyPreferences(w, r)
		}
	})))

	return mux, svc, secret
}

func TestHandler_RegisterAndLogin_HTTP(t *testing.T) {
	router, _, _ := setupTestRouter()

	t.Run("POST /api/v1/auth/register returns 201 Created", func(t *testing.T) {
		body := map[string]any{
			"email":                "morgan@aura.dating",
			"password":             "Passphrase123!",
			"display_name":         "Morgan Chen",
			"birthdate":            "1995-04-12",
			"gender_identities":    []string{"genderfluid", "non-binary"},
			"sexual_orientations":  []string{"queer", "bisexual"},
			"pronouns":             []string{"they/them"},
			"relationship_intents": []string{"serious dating"},
		}
		jsonBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader(jsonBytes))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d: %s", rec.Code, rec.Body.String())
		}

		var authResp AuthResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &authResp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if authResp.AccessToken == "" {
			t.Errorf("expected non-empty access token")
		}
	})

	t.Run("POST /api/v1/auth/login returns 200 OK", func(t *testing.T) {
		body := map[string]any{
			"email":    "morgan@aura.dating",
			"password": "Passphrase123!",
		}
		jsonBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(jsonBytes))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET /api/v1/profiles/me requires authentication (401)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/profiles/me", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d", rec.Code)
		}
	})
}

func TestHandler_AuthenticatedProfileAndPreferences_HTTP(t *testing.T) {
	router, svc, _ := setupTestRouter()

	// Register user
	regResp, err := svc.Register(context.Background(), validRegisterReq(), ClientInfo{})
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}

	token := regResp.AccessToken

	t.Run("GET /api/v1/profiles/me returns 200 with profile", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/profiles/me", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
		}

		var fullProf FullProfileResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &fullProf); err != nil {
			t.Fatalf("failed to decode profile response: %v", err)
		}
		if fullProf.Profile.DisplayName != "Jordan Rivera" {
			t.Errorf("expected Jordan Rivera, got %s", fullProf.Profile.DisplayName)
		}
	})

	t.Run("PUT /api/v1/profiles/me updates profile bio", func(t *testing.T) {
		newBio := "Exploring queer culture and writing fiction."
		body := map[string]any{
			"bio": newBio,
		}
		jsonBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPut, "/api/v1/profiles/me", bytes.NewReader(jsonBytes))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("PUT /api/v1/profiles/me/preferences updates discovery filters", func(t *testing.T) {
		body := map[string]any{
			"min_age":         22,
			"max_age":         45,
			"max_distance_km": 75,
		}
		jsonBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPut, "/api/v1/profiles/me/preferences", bytes.NewReader(jsonBytes))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
		}

		var pref DatingPreferences
		if err := json.Unmarshal(rec.Body.Bytes(), &pref); err != nil {
			t.Fatalf("failed to decode preferences: %v", err)
		}
		if pref.MinAge != 22 || pref.MaxAge != 45 || pref.MaxDistanceKm != 75 {
			t.Errorf("unexpected preferences: %v", pref)
		}
	})
}

func TestHandler_ResetPasswordWebPage(t *testing.T) {
	router, _, _ := setupTestRouter()

	t.Run("GET /auth/reset-password with missing token renders incomplete link notice", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/auth/reset-password", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d", rec.Code)
		}
		ct := rec.Header().Get("Content-Type")
		if !strings.Contains(ct, "text/html") {
			t.Errorf("expected text/html Content-Type, got: %s", ct)
		}
		if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("expected X-Content-Type-Options nosniff")
		}
		if rec.Header().Get("X-Frame-Options") != "DENY" {
			t.Errorf("expected X-Frame-Options DENY")
		}
		body := rec.Body.String()
		if !strings.Contains(body, "Reset Link Incomplete") {
			t.Errorf("expected missing token notice, got body: %s", body)
		}
	})

	t.Run("GET /auth/reset-password with valid token renders Expo Go & standalone links and web form", func(t *testing.T) {
		token := "a1b2c3d4e5f678901234567890abcdef"
		req := httptest.NewRequest(http.MethodGet, "/auth/reset-password?token="+token, nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d", rec.Code)
		}
		body := rec.Body.String()
		if !strings.Contains(body, "exp://192.168.29.15:8081/--/reset-password?token="+token) {
			t.Errorf("expected Expo Go deep link in HTML, got body: %s", body)
		}
		if !strings.Contains(body, "aura://reset-password?token="+token) {
			t.Errorf("expected standalone aura deep link in HTML, got body: %s", body)
		}
		if !strings.Contains(body, "Account Recovery") {
			t.Errorf("expected Account Recovery title in HTML")
		}
		if !strings.Contains(body, "Update Password") {
			t.Errorf("expected Update Password button in HTML")
		}
	})

	t.Run("POST /auth/reset-password returns 405 Method Not Allowed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/auth/reset-password", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("expected 405 Method Not Allowed, got %d", rec.Code)
		}
	})
}

func TestHandler_PasswordResetEndToEnd_Flow(t *testing.T) {
	router, svc, _ := setupTestRouter()

	// 1. Register test member
	regBody := map[string]any{
		"email":                "flow_member@aura.dating",
		"password":             "OriginalPass123!",
		"display_name":         "Flow Member",
		"birthdate":            "1998-05-15",
		"gender_identities":    []string{"non-binary"},
		"sexual_orientations":  []string{"queer"},
		"pronouns":             []string{"they/them"},
		"relationship_intents": []string{"serious dating"},
	}
	regBytes, _ := json.Marshal(regBody)
	regReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader(regBytes))
	regReq.Header.Set("Content-Type", "application/json")
	regRec := httptest.NewRecorder()
	router.ServeHTTP(regRec, regReq)
	if regRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on registration, got %d: %s", regRec.Code, regRec.Body.String())
	}

	// 2. Request password reset via service to acquire token
	token, err := svc.RequestPasswordReset(context.Background(), "flow_member@aura.dating")
	if err != nil {
		t.Fatalf("failed to request password reset: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty reset token")
	}

	// 3. Confirm reset with weak password -> fails policy validation
	weakBody := map[string]string{
		"token":        token,
		"new_password": "short",
	}
	weakBytes, _ := json.Marshal(weakBody)
	weakReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/confirm", bytes.NewReader(weakBytes))
	weakReq.Header.Set("Content-Type", "application/json")
	weakRec := httptest.NewRecorder()
	router.ServeHTTP(weakRec, weakReq)
	if weakRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on weak password, got %d", weakRec.Code)
	}

	// 4. Confirm reset with policy-compliant password -> succeeds
	confirmBody := map[string]string{
		"token":        token,
		"new_password": "NewSecretPass456!",
	}
	confirmBytes, _ := json.Marshal(confirmBody)
	confirmReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/confirm", bytes.NewReader(confirmBytes))
	confirmReq.Header.Set("Content-Type", "application/json")
	confirmRec := httptest.NewRecorder()
	router.ServeHTTP(confirmRec, confirmReq)
	if confirmRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on confirm password reset, got %d: %s", confirmRec.Code, confirmRec.Body.String())
	}

	// 5. Token reuse -> rejected (single use token)
	reuseReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/confirm", bytes.NewReader(confirmBytes))
	reuseReq.Header.Set("Content-Type", "application/json")
	reuseRec := httptest.NewRecorder()
	router.ServeHTTP(reuseRec, reuseReq)
	if reuseRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on token reuse, got %d", reuseRec.Code)
	}

	// 6. Old password no longer works
	oldLogin := map[string]string{
		"email":    "flow_member@aura.dating",
		"password": "OriginalPass123!",
	}
	oldBytes, _ := json.Marshal(oldLogin)
	oldReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(oldBytes))
	oldReq.Header.Set("Content-Type", "application/json")
	oldRec := httptest.NewRecorder()
	router.ServeHTTP(oldRec, oldReq)
	if oldRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for old password, got %d", oldRec.Code)
	}

	// 7. New password succeeds
	newLogin := map[string]string{
		"email":    "flow_member@aura.dating",
		"password": "NewSecretPass456!",
	}
	newBytes, _ := json.Marshal(newLogin)
	newReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(newBytes))
	newReq.Header.Set("Content-Type", "application/json")
	newRec := httptest.NewRecorder()
	router.ServeHTTP(newRec, newReq)
	if newRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for new password login, got %d: %s", newRec.Code, newRec.Body.String())
	}
}
