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
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/apperror"
	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/database"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/safety"
	"github.com/auradating/platform/backend/internal/server"
)

// InMemoryTestNotificationSink provides an isolated out-of-band delivery sink for tests
// so that API responses never leak raw OTPs or password-reset tokens.
type InMemoryTestNotificationSink struct {
	mu        sync.Mutex
	lastOTP   map[string]string // target -> last OTP
	lastReset map[string]string // email -> last reset token
}

func newTestNotificationSink() *InMemoryTestNotificationSink {
	return &InMemoryTestNotificationSink{
		lastOTP:   make(map[string]string),
		lastReset: make(map[string]string),
	}
}

func (s *InMemoryTestNotificationSink) DeliverVerificationOTP(_ context.Context, target, channel, otp string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastOTP[target] = otp
	return nil
}

func (s *InMemoryTestNotificationSink) DeliverPasswordReset(_ context.Context, email, resetToken string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastReset[email] = resetToken
	return nil
}

func (s *InMemoryTestNotificationSink) GetOTP(target string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastOTP[target]
}

func (s *InMemoryTestNotificationSink) GetResetToken(email string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastReset[email]
}

func getAuthTestDatabaseURL(t *testing.T) string {
	_, _ = config.LoadFromEnv()
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		dbURL = os.Getenv("DATABASE_URL")
	}
	if dbURL == "" {
		t.Skip("Skipping PostgreSQL authentication verification: Neither TEST_DATABASE_URL nor DATABASE_URL is configured.")
	}
	return dbURL
}

func setupRealPostgresAuthServer(t *testing.T) (*database.Postgres, *server.Server, *httptest.Server, *http.Client, *InMemoryTestNotificationSink, string) {
	dbURL := getAuthTestDatabaseURL(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	jwtSecret := "auth-test-jwt-secret-must-be-at-least-32-bytes-long!"
	cfg, err := config.Load(func(k string) string {
		switch k {
		case "DATABASE_URL":
			return dbURL
		case "APP_ENV":
			return "development"
		case "JWT_SIGNING_SECRET":
			return jwtSecret
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatalf("failed to create auth test config: %v", err)
	}

	pg, err := database.NewPostgres(ctx, cfg)
	if err != nil {
		t.Fatalf("failed to connect to test postgres pool: %v", err)
	}
	t.Cleanup(func() {
		pg.Close()
	})

	if err := pg.HealthCheck(ctx); err != nil {
		t.Fatalf("database healthcheck failed: %v", err)
	}

	testSink := newTestNotificationSink()

	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	srv := server.New(cfg, logger, pg, nopProbe{})
	if srv.IdentityService() != nil {
		srv.IdentityService().SetNotificationSink(testSink)
	}
	t.Cleanup(func() {
		if srv.MediaService() != nil {
			srv.MediaService().Stop()
		}
	})

	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(func() {
		ts.Close()
	})

	return pg, srv, ts, ts.Client(), testSink, jwtSecret
}

func doAuthJSON(t *testing.T, client *http.Client, method, url string, body any, token string) (*http.Response, []byte) {
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
		t.Fatalf("failed to construct request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("HTTP request failed: %v", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("failed to read response body: %v", err)
	}
	return resp, respBytes
}

func cleanupTestAccounts(ctx context.Context, pg *database.Postgres, runPrefix string) error {
	pattern := runPrefix + "%"
	// Deleting from users cascades to user_sessions, profiles, dating_preferences, account_verifications, password_resets
	_, err := pg.Pool.Exec(ctx, `DELETE FROM users WHERE email LIKE $1`, pattern)
	if err != nil {
		return fmt.Errorf("failed to clean test users: %w", err)
	}
	_, err = pg.Pool.Exec(ctx, `DELETE FROM login_attempts WHERE email LIKE $1`, pattern)
	if err != nil {
		return fmt.Errorf("failed to clean test login attempts: %w", err)
	}
	return nil
}

func TestPostgres_RealAuthVerificationGate(t *testing.T) {
	pg, _, ts, client, testSink, jwtSecret := setupRealPostgresAuthServer(t)
	ctx := context.Background()

	runID := time.Now().UnixNano()
	runPrefix := fmt.Sprintf("test_auth_%d_", runID)

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := cleanupTestAccounts(cleanCtx, pg, runPrefix); err != nil {
			t.Logf("cleanup error: %v", err)
		}
	})

	// =========================================================================
	// 1. Password Hashing & Verification (Argon2id Invariant)
	// =========================================================================
	t.Run("1. Argon2id Password Hashing & Cryptographic Verification", func(t *testing.T) {
		plainPassword := "SecretPassword123!Safe"
		encodedHash, err := identity.HashPasswordWithParams(plainPassword, identity.FastTestArgonParams)
		if err != nil {
			t.Fatalf("failed to generate argon2id password hash: %v", err)
		}

		if !strings.HasPrefix(encodedHash, "$argon2id$v=19$m=") {
			t.Fatalf("argon2id hash does not follow standard RFC format, got: %s", encodedHash)
		}

		valid, err := identity.VerifyPassword(plainPassword, encodedHash)
		if err != nil || !valid {
			t.Fatalf("expected valid password verification, got valid=%v, err=%v", valid, err)
		}

		invalidMatch, err := identity.VerifyPassword("WrongPassword456!", encodedHash)
		if err != nil || invalidMatch {
			t.Fatalf("expected invalid password to be rejected, got match=%v, err=%v", invalidMatch, err)
		}
		t.Logf("Argon2id password hashing and verification passed.")
	})

	// =========================================================================
	// 2. Minimum Age Requirements & Input Validation
	// =========================================================================
	t.Run("2. Server-Enforced Minimum Age (18+) & Input Validation", func(t *testing.T) {
		// 2a. Underage registration rejected (< 18)
		underageEmail := runPrefix + "underage@auratest.internal"
		underageReq := identity.RegisterRequest{
			Email:               underageEmail,
			Password:            "ValidPass123!",
			DisplayName:         "Underage Candidate",
			Birthdate:           time.Now().AddDate(-17, 0, 0).Format("2006-01-02"), // 17 years old
			GenderIdentities:    []string{"non-binary"},
			SexualOrientations:  []string{"queer"},
			Pronouns:            []string{"they/them"},
			RelationshipIntents: []string{"serious dating"},
		}
		resp, body := doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/register", underageReq, "")
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request for underage user, got %d: %s", resp.StatusCode, string(body))
		}
		if !strings.Contains(string(body), "must be at least 18 years old") {
			t.Fatalf("expected error message to state 18+ requirement, got: %s", string(body))
		}

		// Verify zero rows in PostgreSQL
		var count int
		err := pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM users WHERE email = $1", underageEmail).Scan(&count)
		if err != nil || count != 0 {
			t.Fatalf("underage account was incorrectly saved to database (count=%d, err=%v)", count, err)
		}

		// 2b. Password too short (<8 chars)
		shortPassReq := underageReq
		shortPassReq.Email = runPrefix + "shortpass@auratest.internal"
		shortPassReq.Birthdate = "1998-05-15"
		shortPassReq.Password = "short"
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/register", shortPassReq, "")
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 for short password, got %d: %s", resp.StatusCode, string(body))
		}

		// 2c. Blank display name
		blankNameReq := shortPassReq
		blankNameReq.Password = "ValidPass123!"
		blankNameReq.DisplayName = "   "
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/register", blankNameReq, "")
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 for blank display name, got %d: %s", resp.StatusCode, string(body))
		}

		// 2d. Invalid taxonomy vocabulary
		invalidTaxReq := shortPassReq
		invalidTaxReq.Password = "ValidPass123!"
		invalidTaxReq.DisplayName = "Valid Name"
		invalidTaxReq.GenderIdentities = []string{"unrecognized-alien-gender"}
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/register", invalidTaxReq, "")
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 for unrecognized taxonomy, got %d: %s", resp.StatusCode, string(body))
		}
		t.Logf("Minimum age and input validation verified.")
	})

	// =========================================================================
	// 3. Valid Registration & Duplicate-Account Handling on PostgreSQL
	// =========================================================================
	aliceEmail := runPrefix + "alice@auratest.internal"
	alicePass := "AliceSecurePass123!"
	var aliceAuth identity.AuthResponse

	t.Run("3. Valid Registration, Real PostgreSQL Persistence & Duplicate Handling", func(t *testing.T) {
		regReq := identity.RegisterRequest{
			Email:                 aliceEmail,
			Password:              alicePass,
			DisplayName:           "Alice Rivera",
			Birthdate:             "1998-04-12", // 28 years old
			GenderIdentities:      []string{"non-binary", "transgender woman"},
			SexualOrientations:    []string{"queer", "lesbian"},
			Pronouns:              []string{"they/them", "she/her"},
			RelationshipIntents:   []string{"serious dating", "community / friends"},
			RelationshipStructure: identity.StructureMonogamous,
		}

		resp, body := doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/register", regReq, "")
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 Created for valid registration, got %d: %s", resp.StatusCode, string(body))
		}
		if err := json.Unmarshal(body, &aliceAuth); err != nil {
			t.Fatalf("failed to parse auth response: %v", err)
		}

		if aliceAuth.AccessToken == "" || aliceAuth.RefreshToken == "" {
			t.Fatalf("expected access and refresh tokens in registration response")
		}
		if aliceAuth.User.Email != aliceEmail {
			t.Fatalf("expected user email %s, got %s", aliceEmail, aliceAuth.User.Email)
		}

		// Direct PostgreSQL table assertions
		var dbStatus, dbRole, dbHash string
		err := pg.Pool.QueryRow(ctx, "SELECT status, role, password_hash FROM users WHERE id = $1", aliceAuth.User.ID).
			Scan(&dbStatus, &dbRole, &dbHash)
		if err != nil {
			t.Fatalf("failed to find user in PostgreSQL: %v", err)
		}
		if dbStatus != "ACTIVE" || dbRole != "MEMBER" {
			t.Fatalf("unexpected user status/role in DB: status=%s, role=%s", dbStatus, dbRole)
		}
		if !strings.HasPrefix(dbHash, "$argon2id$") {
			t.Fatalf("expected argon2id password hash in DB, got: %s", dbHash)
		}

		// Profile in DB
		var dbDisplayName string
		err = pg.Pool.QueryRow(ctx, "SELECT display_name FROM profiles WHERE user_id = $1", aliceAuth.User.ID).
			Scan(&dbDisplayName)
		if err != nil || dbDisplayName != "Alice Rivera" {
			t.Fatalf("failed to find profile in PostgreSQL: display_name=%s, err=%v", dbDisplayName, err)
		}

		// Dating preferences in DB
		var dbMinAge, dbMaxAge int
		err = pg.Pool.QueryRow(ctx, "SELECT min_age, max_age FROM dating_preferences WHERE user_id = $1", aliceAuth.User.ID).
			Scan(&dbMinAge, &dbMaxAge)
		if err != nil || dbMinAge != 18 || dbMaxAge != 99 {
			t.Fatalf("unexpected dating preferences in DB: min=%d, max=%d, err=%v", dbMinAge, dbMaxAge, err)
		}

		// User session in DB
		var sessionCount int
		err = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL", aliceAuth.User.ID).
			Scan(&sessionCount)
		if err != nil || sessionCount != 1 {
			t.Fatalf("expected exactly 1 active session in DB, got %d, err=%v", sessionCount, err)
		}

		// 3b. Duplicate registration rejected
		dupResp, dupBody := doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/register", regReq, "")
		if dupResp.StatusCode != http.StatusConflict {
			t.Fatalf("expected 409 Conflict for duplicate registration, got %d: %s", dupResp.StatusCode, string(dupBody))
		}

		var count int
		_ = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM users WHERE email = $1", aliceEmail).Scan(&count)
		if count != 1 {
			t.Fatalf("duplicate registration created multiple user rows: %d", count)
		}
		t.Logf("Valid registration and duplicate prevention verified against live PostgreSQL.")
	})

	// =========================================================================
	// 4. Login with Valid, Invalid, and Non-Existent Credentials
	// =========================================================================
	t.Run("4. Login with Valid and Invalid Credentials", func(t *testing.T) {
		// 4a. Valid login
		loginReq := identity.LoginRequest{
			Email:    aliceEmail,
			Password: alicePass,
		}
		resp, body := doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", loginReq, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK for valid login, got %d: %s", resp.StatusCode, string(body))
		}
		var loginResp identity.AuthResponse
		if err := json.Unmarshal(body, &loginResp); err != nil {
			t.Fatalf("failed to decode login response: %v", err)
		}
		if loginResp.AccessToken == "" || loginResp.RefreshToken == "" {
			t.Fatalf("expected non-empty tokens on login")
		}

		// Verify last_active_at was updated in PostgreSQL
		var lastActiveAt *time.Time
		err := pg.Pool.QueryRow(ctx, "SELECT last_active_at FROM users WHERE id = $1", aliceAuth.User.ID).Scan(&lastActiveAt)
		if err != nil || lastActiveAt == nil {
			t.Fatalf("expected last_active_at to be updated in PostgreSQL, got %v, err=%v", lastActiveAt, err)
		}

		// 4b. Invalid password
		badPassReq := identity.LoginRequest{
			Email:    aliceEmail,
			Password: "WrongPassword999!",
		}
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", badPassReq, "")
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized for bad password, got %d: %s", resp.StatusCode, string(body))
		}
		if !strings.Contains(string(body), "Invalid email or password") {
			t.Fatalf("expected generic invalid credentials message, got: %s", string(body))
		}

		// 4c. Non-existent email (defense against enumeration)
		nonExistentReq := identity.LoginRequest{
			Email:    runPrefix + "ghost@auratest.internal",
			Password: "SomePassword123!",
		}
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", nonExistentReq, "")
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized for non-existent user, got %d: %s", resp.StatusCode, string(body))
		}
		if !strings.Contains(string(body), "Invalid email or password") {
			t.Fatalf("expected generic message for non-existent user, got: %s", string(body))
		}
		t.Logf("Login validation and anti-enumeration verified.")
	})

	// =========================================================================
	// 5. Session/Access-Token Validation, Refresh and Logout
	// =========================================================================
	t.Run("5. Session Validation, Token Rotation, Reuse Detection & Logout", func(t *testing.T) {
		// Log in to get fresh session
		loginReq := identity.LoginRequest{Email: aliceEmail, Password: alicePass}
		resp, body := doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", loginReq, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("login failed: %d", resp.StatusCode)
		}
		var currentAuth identity.AuthResponse
		_ = json.Unmarshal(body, &currentAuth)

		initialRefresh := currentAuth.RefreshToken
		initialHash := identity.HashRefreshToken(initialRefresh)

		// 5a. Refresh token rotation
		refreshReq := map[string]string{"refresh_token": initialRefresh}
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/refresh", refreshReq, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK on refresh, got %d: %s", resp.StatusCode, string(body))
		}
		var rotatedAuth identity.AuthResponse
		_ = json.Unmarshal(body, &rotatedAuth)
		if rotatedAuth.RefreshToken == initialRefresh {
			t.Fatalf("refresh token was not rotated")
		}

		// Verify old session revoked in PostgreSQL
		var oldRevokedAt *time.Time
		err := pg.Pool.QueryRow(ctx, "SELECT revoked_at FROM user_sessions WHERE refresh_token_hash = $1", initialHash).
			Scan(&oldRevokedAt)
		if err != nil || oldRevokedAt == nil {
			t.Fatalf("expected initial session to be revoked in PostgreSQL, got %v, err=%v", oldRevokedAt, err)
		}

		// 5b. Token reuse detection (replay attack with revoked token)
		reuseResp, reuseBody := doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/refresh", refreshReq, "")
		if reuseResp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 on token reuse, got %d: %s", reuseResp.StatusCode, string(reuseBody))
		}

		// Replay detection should revoke the entire family!
		newHash := identity.HashRefreshToken(rotatedAuth.RefreshToken)
		var familyRevokedAt *time.Time
		err = pg.Pool.QueryRow(ctx, "SELECT revoked_at FROM user_sessions WHERE refresh_token_hash = $1", newHash).
			Scan(&familyRevokedAt)
		if err != nil || familyRevokedAt == nil {
			t.Fatalf("expected family revocation on token reuse attack, got %v, err=%v", familyRevokedAt, err)
		}

		// 5c. Logout flow
		// Log in again for clean logout test
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", loginReq, "")
		_ = json.Unmarshal(body, &currentAuth)

		logoutReq := map[string]string{"refresh_token": currentAuth.RefreshToken}
		logoutResp, _ := doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/logout", logoutReq, "")
		if logoutResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK on logout, got %d", logoutResp.StatusCode)
		}

		// Verify revoked in PostgreSQL
		logoutHash := identity.HashRefreshToken(currentAuth.RefreshToken)
		var logoutRevokedAt *time.Time
		_ = pg.Pool.QueryRow(ctx, "SELECT revoked_at FROM user_sessions WHERE refresh_token_hash = $1", logoutHash).
			Scan(&logoutRevokedAt)
		if logoutRevokedAt == nil {
			t.Fatalf("expected session to be revoked in PostgreSQL upon logout")
		}

		// Subsequent refresh fails
		refAfterLogout, _ := doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/refresh", logoutReq, "")
		if refAfterLogout.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized for refresh after logout, got %d", refAfterLogout.StatusCode)
		}
		t.Logf("Session rotation, replay protection and logout verified on real PostgreSQL.")
	})

	// =========================================================================
	// 6. Protected Endpoints & User Isolation
	// =========================================================================
	t.Run("6. Protected Endpoints Rejection & Isolation Between Users", func(t *testing.T) {
		// 6a. Unauthenticated request rejected
		resp, _ := doAuthJSON(t, client, http.MethodGet, ts.URL+"/api/v1/profiles/me", nil, "")
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized for unauthenticated request, got %d", resp.StatusCode)
		}

		// 6b. Tampered token rejected
		resp, _ = doAuthJSON(t, client, http.MethodGet, ts.URL+"/api/v1/profiles/me", nil, "invalid.bearer.jwt.token")
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 for tampered JWT, got %d", resp.StatusCode)
		}

		// 6c. Valid token accepted
		loginReq := identity.LoginRequest{Email: aliceEmail, Password: alicePass}
		resp, body := doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", loginReq, "")
		var aliceSession identity.AuthResponse
		_ = json.Unmarshal(body, &aliceSession)

		resp, body = doAuthJSON(t, client, http.MethodGet, ts.URL+"/api/v1/profiles/me", nil, aliceSession.AccessToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK for authenticated profile, got %d: %s", resp.StatusCode, string(body))
		}
		var fullProfile identity.FullProfileResponse
		if err := json.Unmarshal(body, &fullProfile); err != nil {
			t.Fatalf("failed to decode profile: %v", err)
		}
		if fullProfile.Profile.DisplayName != "Alice Rivera" {
			t.Fatalf("expected Alice Rivera, got %s", fullProfile.Profile.DisplayName)
		}

		// 6d. User Isolation: Register Bob and verify Bob cannot see Alice's data
		bobEmail := runPrefix + "bob@auratest.internal"
		bobReg := identity.RegisterRequest{
			Email:               bobEmail,
			Password:            "BobSecurePass123!",
			DisplayName:         "Bob Vance",
			Birthdate:           "1990-01-01",
			GenderIdentities:    []string{"cisgender man"},
			SexualOrientations:  []string{"gay"},
			RelationshipIntents: []string{"serious dating"},
		}
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/register", bobReg, "")
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 Created for Bob, got %d: %s", resp.StatusCode, string(body))
		}
		var bobSession identity.AuthResponse
		_ = json.Unmarshal(body, &bobSession)

		// Bob fetches own profile
		resp, body = doAuthJSON(t, client, http.MethodGet, ts.URL+"/api/v1/profiles/me", nil, bobSession.AccessToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 for Bob, got %d", resp.StatusCode)
		}
		var bobProfile identity.FullProfileResponse
		_ = json.Unmarshal(body, &bobProfile)
		if bobProfile.Profile.DisplayName != "Bob Vance" {
			t.Fatalf("expected Bob Vance, got %s", bobProfile.Profile.DisplayName)
		}
		if bobProfile.User.ID == fullProfile.User.ID {
			t.Fatalf("user isolation breached: Bob has Alice's ID")
		}
		t.Logf("Protected endpoints and user isolation verified.")
	})

	// =========================================================================
	// 7. Email Verification & Password Recovery (Real PostgreSQL persistence)
	// =========================================================================
	t.Run("7. Email Verification & Password Recovery", func(t *testing.T) {
		loginReq := identity.LoginRequest{Email: aliceEmail, Password: alicePass}
		resp, body := doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", loginReq, "")
		var aliceSession identity.AuthResponse
		_ = json.Unmarshal(body, &aliceSession)

		// 7a. Send email verification
		sendReq := map[string]string{"channel": "EMAIL"}
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/verify/send", sendReq, aliceSession.AccessToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK on verify/send, got %d: %s", resp.StatusCode, string(body))
		}

		// MANDATORY SECRET PROTECTION ASSERTION: Raw OTP must NEVER be in HTTP response
		if strings.Contains(string(body), "otp") {
			t.Fatalf("SECRET LEAK: Raw OTP exposed in verify/send response: %s", string(body))
		}

		// Retrieve OTP from isolated test sink fixture (out-of-band delivery)
		deliveredOTP := testSink.GetOTP(aliceEmail)
		if deliveredOTP == "" {
			t.Fatalf("expected OTP to be delivered to test notification sink fixture")
		}

		// Verify record exists in PostgreSQL account_verifications
		var dbCodeHash string
		var dbAttempts int
		err := pg.Pool.QueryRow(ctx, `
			SELECT code_hash, attempts FROM account_verifications
			WHERE user_id = $1 AND channel = 'EMAIL' ORDER BY created_at DESC LIMIT 1
		`, aliceAuth.User.ID).Scan(&dbCodeHash, &dbAttempts)
		if err != nil {
			t.Fatalf("failed to query account_verifications in DB: %v", err)
		}
		if dbAttempts != 0 {
			t.Fatalf("expected 0 attempts, got %d", dbAttempts)
		}

		// Confirm with wrong code
		badConfirm := map[string]string{"channel": "EMAIL", "code": "000000"}
		resp, _ = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/verify/confirm", badConfirm, aliceSession.AccessToken)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request on wrong OTP, got %d", resp.StatusCode)
		}

		// Attempts incremented in DB
		_ = pg.Pool.QueryRow(ctx, `
			SELECT attempts FROM account_verifications
			WHERE user_id = $1 AND channel = 'EMAIL' ORDER BY created_at DESC LIMIT 1
		`, aliceAuth.User.ID).Scan(&dbAttempts)
		if dbAttempts != 1 {
			t.Fatalf("expected attempts to be incremented to 1 in DB, got %d", dbAttempts)
		}

		// Confirm with correct code from test sink
		goodConfirm := map[string]string{"channel": "EMAIL", "code": deliveredOTP}
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/verify/confirm", goodConfirm, aliceSession.AccessToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK on correct OTP, got %d: %s", resp.StatusCode, string(body))
		}

		// Verify email_verified_at set in PostgreSQL users table
		var emailVerifiedAt *time.Time
		err = pg.Pool.QueryRow(ctx, "SELECT email_verified_at FROM users WHERE id = $1", aliceAuth.User.ID).Scan(&emailVerifiedAt)
		if err != nil || emailVerifiedAt == nil {
			t.Fatalf("expected email_verified_at to be populated in PostgreSQL, got %v, err=%v", emailVerifiedAt, err)
		}

		// 7b. Password Reset Flow
		// Request reset
		resetReq := map[string]string{"email": aliceEmail}
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/password-reset/request", resetReq, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK on password reset request, got %d: %s", resp.StatusCode, string(body))
		}

		// MANDATORY SECRET PROTECTION ASSERTION: Raw reset token must NEVER be in HTTP response
		if strings.Contains(string(body), "token") {
			t.Fatalf("SECRET LEAK: Raw reset token exposed in password-reset/request response: %s", string(body))
		}

		// Retrieve reset token from isolated test sink fixture (out-of-band delivery)
		deliveredResetToken := testSink.GetResetToken(aliceEmail)
		if deliveredResetToken == "" {
			t.Fatalf("expected reset token to be delivered to test notification sink fixture")
		}

		// Verify record exists in PostgreSQL password_resets
		var dbUsedAt *time.Time
		err = pg.Pool.QueryRow(ctx, "SELECT used_at FROM password_resets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", aliceAuth.User.ID).
			Scan(&dbUsedAt)
		if err != nil {
			t.Fatalf("failed to query password_resets in DB: %v", err)
		}
		if dbUsedAt != nil {
			t.Fatalf("expected used_at to be NULL before confirm")
		}

		// Confirm password reset
		newPassword := "AliceNewPassword789!"
		confirmResetReq := map[string]string{
			"token":        deliveredResetToken,
			"new_password": newPassword,
		}
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/password-reset/confirm", confirmResetReq, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK on confirm reset, got %d: %s", resp.StatusCode, string(body))
		}

		// Verify used_at set in PostgreSQL
		_ = pg.Pool.QueryRow(ctx, "SELECT used_at FROM password_resets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", aliceAuth.User.ID).
			Scan(&dbUsedAt)
		if dbUsedAt == nil {
			t.Fatalf("expected used_at to be set in DB after confirm")
		}

		// Replay reset token fails
		resp, _ = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/password-reset/confirm", confirmResetReq, "")
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request on replayed reset token, got %d", resp.StatusCode)
		}

		// Login with old password fails
		oldLogin := identity.LoginRequest{Email: aliceEmail, Password: alicePass}
		resp, _ = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", oldLogin, "")
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized for old password, got %d", resp.StatusCode)
		}

		// Login with new password succeeds
		newLogin := identity.LoginRequest{Email: aliceEmail, Password: newPassword}
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", newLogin, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK for new password login, got %d: %s", resp.StatusCode, string(body))
		}
		t.Logf("Email verification and password recovery verified on real PostgreSQL without secret leakage.")
	})

	// =========================================================================
	// 8. Rate Limiting & Brute-Force Abuse Protections (login_attempts table)
	// =========================================================================
	t.Run("8. Rate Limiting & Brute-Force Abuse Protection (Lockout Gate)", func(t *testing.T) {
		eveEmail := runPrefix + "eve@auratest.internal"
		evePass := "EveSecurePass123!"
		eveReg := identity.RegisterRequest{
			Email:               eveEmail,
			Password:            evePass,
			DisplayName:         "Eve Hacker",
			Birthdate:           "1996-03-21",
			GenderIdentities:    []string{"non-binary"},
			SexualOrientations:  []string{"queer"},
			RelationshipIntents: []string{"casual dating"},
		}
		resp, body := doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/register", eveReg, "")
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("failed to register Eve: %d: %s", resp.StatusCode, string(body))
		}

		// Execute 5 consecutive failed logins
		badLogin := identity.LoginRequest{Email: eveEmail, Password: "WrongPassword!"}
		for i := 1; i <= 5; i++ {
			resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", badLogin, "")
			if resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("attempt %d: expected 401 Unauthorized, got %d: %s", i, resp.StatusCode, string(body))
			}
		}

		// Verify login_attempts in PostgreSQL has count >= 5 and locked_until > NOW()
		var attemptCount int
		var lockedUntil *time.Time
		err := pg.Pool.QueryRow(ctx, "SELECT attempt_count, locked_until FROM login_attempts WHERE email = $1", eveEmail).
			Scan(&attemptCount, &lockedUntil)
		if err != nil {
			t.Fatalf("failed to query login_attempts in DB: %v", err)
		}
		if attemptCount < 5 {
			t.Fatalf("expected attempt_count >= 5 in DB, got %d", attemptCount)
		}
		if lockedUntil == nil || lockedUntil.Before(time.Now().UTC()) {
			t.Fatalf("expected locked_until to be set in the future in DB, got %v", lockedUntil)
		}

		// 6th attempt: even with Eve's CORRECT password, account must be locked out!
		goodLogin := identity.LoginRequest{Email: eveEmail, Password: evePass}
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", goodLogin, "")
		if resp.StatusCode != http.StatusTooManyRequests {
			t.Fatalf("expected 429 Too Many Requests for locked out account, got %d: %s", resp.StatusCode, string(body))
		}
		var appErr apperror.ErrorEnvelope
		_ = json.Unmarshal(body, &appErr)
		if appErr.Error.Code != "ACCOUNT_LOCKED" {
			t.Fatalf("expected error code ACCOUNT_LOCKED, got %s", appErr.Error.Code)
		}

		// Simulate lockout expiration in PostgreSQL
		_, err = pg.Pool.Exec(ctx, "UPDATE login_attempts SET locked_until = NOW() - INTERVAL '1 second' WHERE email = $1", eveEmail)
		if err != nil {
			t.Fatalf("failed to simulate lockout expiration: %v", err)
		}

		// Now login with correct credentials succeeds
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", goodLogin, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK after lockout expiration, got %d: %s", resp.StatusCode, string(body))
		}

		// Verify successful login clears/resets login_attempts
		var remainingAttempts int
		_ = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM login_attempts WHERE email = $1", eveEmail).Scan(&remainingAttempts)
		if remainingAttempts != 0 {
			t.Fatalf("expected login_attempts to be reset upon successful login, got %d rows", remainingAttempts)
		}
		t.Logf("Brute-force lockout and reset verified against PostgreSQL login_attempts.")
	})

	// =========================================================================
	// 9. Role-Based Access Control (RBAC) & Step-Up Security Challenge
	// =========================================================================
	t.Run("9. Role-Based Access Control (RBAC) & Step-Up Authentication", func(t *testing.T) {
		// 9a. Standard MEMBER cannot access /api/v1/admin/audit-logs
		memberLogin := identity.LoginRequest{Email: aliceEmail, Password: "AliceNewPassword789!"}
		resp, body := doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", memberLogin, "")
		var memberAuth identity.AuthResponse
		_ = json.Unmarshal(body, &memberAuth)

		resp, body = doAuthJSON(t, client, http.MethodGet, ts.URL+"/api/v1/admin/audit-logs", nil, memberAuth.AccessToken)
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for member accessing admin endpoint, got %d: %s", resp.StatusCode, string(body))
		}
		if !strings.Contains(string(body), "insufficient administrative permissions") {
			t.Fatalf("expected error message to explain RBAC denial, got: %s", string(body))
		}

		// 9b. SUPER_ADMIN user can access /api/v1/admin/audit-logs
		adminUser := &identity.User{
			ID:     "c0000000-0000-0000-0000-000000000001",
			Email:  runPrefix + "superadmin@auratest.internal",
			Role:   identity.RoleSuperAdmin,
			Status: identity.StatusActive,
		}
		adminToken, err := identity.GenerateAccessToken(jwtSecret, adminUser, 15*time.Minute)
		if err != nil {
			t.Fatalf("failed to generate admin token: %v", err)
		}

		resp, body = doAuthJSON(t, client, http.MethodGet, ts.URL+"/api/v1/admin/audit-logs", nil, adminToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK for super admin accessing audit logs, got %d: %s", resp.StatusCode, string(body))
		}

		// 9c. Step-Up Security Check: Sensitive admin action requires step-up verification
		financeUser := &identity.User{
			ID:     "f0000000-0000-0000-0000-000000000001",
			Email:  runPrefix + "finance@auratest.internal",
			Role:   identity.RoleFinanceAdmin,
			Status: identity.StatusActive,
		}
		financeToken, _ := identity.GenerateAccessToken(jwtSecret, financeUser, 15*time.Minute)

		refundReq := map[string]any{
			"transaction_id": "tx_test_123",
			"reason":         "Customer request",
		}
		// Request without Step-Up header
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/admin/billing/refund", refundReq, financeToken)
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden without step-up header, got %d: %s", resp.StatusCode, string(body))
		}
		if !strings.Contains(string(body), "STEP_UP_REQUIRED") {
			t.Fatalf("expected STEP_UP_REQUIRED error code, got: %s", string(body))
		}

		// Request with valid Step-Up token
		stepUpVerifier := safety.NewTokenStepUpVerifier(jwtSecret)
		stepUpToken, err := stepUpVerifier.GenerateStepUpToken(financeUser.ID, 10*time.Minute)
		if err != nil {
			t.Fatalf("failed to generate step up token: %v", err)
		}

		req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/admin/billing/refund", bytes.NewReader([]byte(`{"transaction_id":"tx_fake","reason":"test"}`)))
		if err != nil {
			t.Fatalf("failed to build refund request: %v", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+financeToken)
		req.Header.Set("X-Aura-Step-Up", stepUpToken)

		resp, _ = client.Do(req)
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusUnauthorized {
			t.Fatalf("step-up authentication was rejected, got status: %d", resp.StatusCode)
		}
		t.Logf("Role-based access control and step-up security verification passed.")
	})

	// =========================================================================
	// 10. End-to-End Secret Protection (Zero Secrets in Responses, Logs & Probes)
	// =========================================================================
	t.Run("10. Mandatory Secret Protection Invariant for All Environments", func(t *testing.T) {
		// 10a. User Registration Response: assert zero password_hash, salt, or secrets
		testReg := identity.RegisterRequest{
			Email:               runPrefix + "secretcheck@auratest.internal",
			Password:            "Password123!Safe",
			DisplayName:         "Secret Check User",
			Birthdate:           "1995-01-01",
			GenderIdentities:    []string{"non-binary"},
			SexualOrientations:  []string{"queer"},
			RelationshipIntents: []string{"serious dating"},
		}
		resp, body := doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/register", testReg, "")
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("registration failed: %d: %s", resp.StatusCode, string(body))
		}
		bodyStr := string(body)
		if strings.Contains(bodyStr, "password_hash") || strings.Contains(bodyStr, "$argon2id$") {
			t.Fatalf("SECRET LEAK: password hash or argon2id string found in registration response: %s", bodyStr)
		}

		// 10b. User Login Response: assert zero password_hash
		loginReq := identity.LoginRequest{
			Email:    testReg.Email,
			Password: testReg.Password,
		}
		resp, body = doAuthJSON(t, client, http.MethodPost, ts.URL+"/api/v1/auth/login", loginReq, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("login failed: %d", resp.StatusCode)
		}
		bodyStr = string(body)
		if strings.Contains(bodyStr, "password_hash") || strings.Contains(bodyStr, "$argon2id$") {
			t.Fatalf("SECRET LEAK: password hash found in login response: %s", bodyStr)
		}

		// 10c. Health / Diagnostics Probes: assert zero database passwords or credentials
		resp, body = doAuthJSON(t, client, http.MethodGet, ts.URL+"/readyz", nil, "")
		bodyStr = string(body)
		if strings.Contains(bodyStr, "postgres://") || strings.Contains(bodyStr, "password") {
			t.Fatalf("SECRET LEAK: database connection string or password found in /readyz diagnostic response: %s", bodyStr)
		}

		// 10d. Error Responses: assert zero internal secrets or connection strings in error payloads
		badReq, err := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/auth/login", strings.NewReader("invalid-json{"))
		if err != nil {
			t.Fatalf("failed to build bad request: %v", err)
		}
		badReq.Header.Set("Content-Type", "application/json")
		errResp, err := client.Do(badReq)
		if err != nil {
			t.Fatalf("request failed: %v", err)
		}
		defer errResp.Body.Close()
		errBytes, _ := io.ReadAll(errResp.Body)
		errStr := string(errBytes)
		if strings.Contains(errStr, "postgres://") || strings.Contains(errStr, "DATABASE_URL") {
			t.Fatalf("SECRET LEAK: internal environment variable or connection URL found in error response: %s", errStr)
		}

		t.Logf("End-to-end secret protection invariants verified: zero leaks across responses, diagnostics, and error envelopes.")
	})
}
