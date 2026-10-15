package identity

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
