package identity

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func newTestService() (*Service, *MemoryRepository) {
	repo := NewMemoryRepository()
	secret := "test-secret-at-least-32-bytes-long-for-hmac-sha256"
	svc := NewService(repo, secret, WithFastCrypto())
	return svc, repo
}

func validRegisterReq() RegisterRequest {
	return RegisterRequest{
		Email:                 "jordan@aura.dating",
		Password:              "Password123!Valid",
		DisplayName:           "Jordan Rivera",
		Birthdate:             "1998-06-15", // ~28 years old
		GenderIdentities:      []string{"non-binary", "transgender man"},
		SexualOrientations:    []string{"queer", "pansexual"},
		Pronouns:              []string{"they/them", "he/him"},
		RelationshipIntents:   []string{"serious dating", "community / friends"},
		RelationshipStructure: StructureMonogamous,
	}
}

func TestService_Register_SuccessAndUnder18Rejection(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()

	t.Run("valid registration succeeds", func(t *testing.T) {
		req := validRegisterReq()
		resp, err := svc.Register(ctx, req, ClientInfo{UserAgent: "TestAgent"})
		if err != nil {
			t.Fatalf("expected successful registration, got: %v", err)
		}
		if resp.User.Email != "jordan@aura.dating" {
			t.Errorf("expected email jordan@aura.dating, got %s", resp.User.Email)
		}
		if resp.AccessToken == "" || resp.RefreshToken == "" {
			t.Errorf("expected non-empty tokens in auth response")
		}
		if resp.Profile == nil || resp.Profile.DisplayName != "Jordan Rivera" {
			t.Errorf("expected initialized profile with Jordan Rivera")
		}
	})

	t.Run("under 18 registration is rejected", func(t *testing.T) {
		req := validRegisterReq()
		req.Email = "teen@aura.dating"
		// 16 years old
		recentDate := time.Now().AddDate(-16, 0, 0).Format("2006-01-02")
		req.Birthdate = recentDate

		_, err := svc.Register(ctx, req, ClientInfo{})
		if err == nil {
			t.Fatalf("expected registration to be rejected for under-18 user")
		}
	})

	t.Run("invalid LGBTQ+ taxonomy is rejected", func(t *testing.T) {
		req := validRegisterReq()
		req.Email = "invalid@aura.dating"
		req.GenderIdentities = []string{"unsupported-random-identity"}

		_, err := svc.Register(ctx, req, ClientInfo{})
		if err == nil {
			t.Fatalf("expected registration to fail with invalid taxonomy")
		}
	})

	t.Run("regression: cross-field taxonomy values are rejected", func(t *testing.T) {
		// 1. Sexual orientation submitted as gender identity (e.g. "Lesbian", "Gay") must fail
		req := validRegisterReq()
		req.Email = "lesbian_as_gender@aura.dating"
		req.GenderIdentities = []string{"Lesbian"}
		_, err := svc.Register(ctx, req, ClientInfo{})
		if err == nil || !strings.Contains(err.Error(), "unrecognized gender identity") {
			t.Fatalf("expected unrecognized gender identity error for Lesbian, got: %v", err)
		}

		req.GenderIdentities = []string{"Gay"}
		_, err = svc.Register(ctx, req, ClientInfo{})
		if err == nil || !strings.Contains(err.Error(), "unrecognized gender identity") {
			t.Fatalf("expected unrecognized gender identity error for Gay, got: %v", err)
		}

		// 2. Gender identity submitted as sexual orientation (e.g. "Non-Binary") must fail
		req = validRegisterReq()
		req.Email = "gender_as_orientation@aura.dating"
		req.SexualOrientations = []string{"Non-Binary"}
		_, err = svc.Register(ctx, req, ClientInfo{})
		if err == nil || !strings.Contains(err.Error(), "unrecognized sexual orientation") {
			t.Fatalf("expected unrecognized sexual orientation error for Non-Binary, got: %v", err)
		}

		// 3. Valid separate fields succeed
		req = validRegisterReq()
		req.Email = "valid_taxonomy@aura.dating"
		req.GenderIdentities = []string{"non-binary", "cisgender woman", "transgender woman"}
		req.SexualOrientations = []string{"lesbian", "queer"}
		resp, err := svc.Register(ctx, req, ClientInfo{})
		if err != nil {
			t.Fatalf("expected valid separate taxonomy to succeed, got: %v", err)
		}
		if resp.User.ID == "" {
			t.Fatalf("expected valid user id")
		}
	})

	t.Run("duplicate email is rejected", func(t *testing.T) {
		req := validRegisterReq()
		_, err := svc.Register(ctx, req, ClientInfo{})
		if err == nil {
			t.Fatalf("expected duplicate registration to be rejected")
		}
	})
}

func TestService_LoginAndTokenRotation(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()

	req := validRegisterReq()
	regResp, err := svc.Register(ctx, req, ClientInfo{DeviceFingerprint: "dev-1"})
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}

	t.Run("login with correct password succeeds", func(t *testing.T) {
		loginResp, err := svc.Login(ctx, LoginRequest{
			Email:    req.Email,
			Password: req.Password,
		}, ClientInfo{DeviceFingerprint: "dev-2"})
		if err != nil {
			t.Fatalf("login failed: %v", err)
		}
		if loginResp.User.ID != regResp.User.ID {
			t.Errorf("mismatched user ID on login")
		}
	})

	t.Run("login with wrong password fails", func(t *testing.T) {
		_, err := svc.Login(ctx, LoginRequest{
			Email:    req.Email,
			Password: "WrongPassword123!",
		}, ClientInfo{})
		if err != ErrInvalidCredentials {
			t.Fatalf("expected ErrInvalidCredentials, got: %v", err)
		}
	})

	t.Run("refresh token rotation succeeds", func(t *testing.T) {
		refResp, err := svc.RefreshToken(ctx, regResp.RefreshToken, ClientInfo{DeviceFingerprint: "dev-1"})
		if err != nil {
			t.Fatalf("token refresh failed: %v", err)
		}
		if refResp.RefreshToken == regResp.RefreshToken {
			t.Errorf("expected new refresh token to be different from old one")
		}

		// Replay detection: attempting to reuse old refresh token triggers family revocation
		_, err = svc.RefreshToken(ctx, regResp.RefreshToken, ClientInfo{})
		if err != ErrSessionRevoked {
			t.Fatalf("expected ErrSessionRevoked on token reuse, got: %v", err)
		}

		// Next refresh with the rotated token should also be revoked because the entire family was invalidated!
		_, err = svc.RefreshToken(ctx, refResp.RefreshToken, ClientInfo{})
		if err != ErrSessionRevoked {
			t.Fatalf("expected entire family to be revoked after reuse attempt, got: %v", err)
		}
	})
}

func TestService_VerificationAndRecovery(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()

	req := validRegisterReq()
	regResp, err := svc.Register(ctx, req, ClientInfo{})
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}
	userID := regResp.User.ID

	t.Run("email verification OTP flow", func(t *testing.T) {
		otp, err := svc.SendVerification(ctx, userID, "EMAIL")
		if err != nil {
			t.Fatalf("failed to send OTP: %v", err)
		}

		// Wrong OTP
		err = svc.ConfirmVerification(ctx, userID, "EMAIL", "000000")
		if err != ErrInvalidVerificationCode {
			t.Errorf("expected ErrInvalidVerificationCode, got: %v", err)
		}

		// Correct OTP
		err = svc.ConfirmVerification(ctx, userID, "EMAIL", otp)
		if err != nil {
			t.Fatalf("expected successful confirmation, got: %v", err)
		}

		fullProf, err := svc.GetMyProfile(ctx, userID)
		if err != nil || fullProf.User.EmailVerifiedAt == nil {
			t.Fatalf("expected user to be marked email verified")
		}
	})

	t.Run("password reset flow", func(t *testing.T) {
		token, err := svc.RequestPasswordReset(ctx, req.Email)
		if err != nil {
			t.Fatalf("failed to request password reset: %v", err)
		}

		newPassword := "NewAuraPassword2026!"
		err = svc.ConfirmPasswordReset(ctx, token, newPassword)
		if err != nil {
			t.Fatalf("failed to confirm password reset: %v", err)
		}

		// Login with old password must fail
		_, err = svc.Login(ctx, LoginRequest{Email: req.Email, Password: req.Password}, ClientInfo{})
		if err != ErrInvalidCredentials {
			t.Errorf("expected old password to fail")
		}

		// Login with new password must succeed
		loginResp, err := svc.Login(ctx, LoginRequest{Email: req.Email, Password: newPassword}, ClientInfo{})
		if err != nil {
			t.Fatalf("expected login with new password to succeed: %v", err)
		}
		if loginResp.User.ID != userID {
			t.Errorf("expected same user ID after password reset")
		}
	})
}

func TestService_ProfileAndPreferences(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()

	req := validRegisterReq()
	regResp, err := svc.Register(ctx, req, ClientInfo{})
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}
	userID := regResp.User.ID

	t.Run("update profile fields and visibility", func(t *testing.T) {
		newBio := "Community organizer and avid hiker."
		vis := VisibilitySettings{
			GenderIdentity:    VisibilityMatchesOnly,
			SexualOrientation: VisibilityPublicCommunity,
			Pronouns:          VisibilityPublicCommunity,
			Distance:          VisibilityHidden,
			OnlineStatus:      VisibilityHidden,
			TravelerSafety:    true,
		}
		discrete := true

		updated, err := svc.UpdateMyProfile(ctx, userID, UpdateProfileRequest{
			Bio:                 &newBio,
			VisibilitySettings:  &vis,
			DiscreteModeEnabled: &discrete,
		})
		if err != nil {
			t.Fatalf("update profile failed: %v", err)
		}
		if updated.Bio != newBio {
			t.Errorf("expected updated bio: %s", updated.Bio)
		}
		if updated.VisibilitySettings.Distance != VisibilityHidden {
			t.Errorf("expected distance hidden")
		}
		if !updated.DiscreteModeEnabled {
			t.Errorf("expected discrete mode enabled")
		}
	})

	t.Run("update location with coordinates", func(t *testing.T) {
		loc, err := svc.UpdateMyLocation(ctx, userID, UpdateLocationRequest{
			Latitude:    40.7128,
			Longitude:   -74.0060,
			CityName:    "New York",
			CountryCode: "US",
		})
		if err != nil {
			t.Fatalf("update location failed: %v", err)
		}
		if loc.CityName != "New York" || loc.CountryCode != "US" {
			t.Errorf("unexpected location data: %v", loc)
		}
	})

	t.Run("update dating preferences", func(t *testing.T) {
		minAge := 21
		maxAge := 35
		maxDist := 40
		pref, err := svc.UpdateMyPreferences(ctx, userID, UpdatePreferencesRequest{
			MinAge:           &minAge,
			MaxAge:           &maxAge,
			MaxDistanceKm:    &maxDist,
			PreferredGenders: []string{"non-binary", "transgender man"},
		})
		if err != nil {
			t.Fatalf("update preferences failed: %v", err)
		}
		if pref.MinAge != 21 || pref.MaxAge != 35 || pref.MaxDistanceKm != 40 {
			t.Errorf("unexpected preferences: %v", pref)
		}
	})
}

func TestService_PasswordPolicy(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()

	t.Run("password strength validation unit tests", func(t *testing.T) {
		tests := []struct {
			name        string
			password    string
			expectedErr error
		}{
			{"too short (under 8 chars)", "P@1ss", ErrPasswordTooShort},
			{"missing digit", "Password!NoDigit", ErrPasswordMissingDigit},
			{"missing special character", "Password12345", ErrPasswordMissingSpecial},
			{"valid exactly 8 chars", "Passw0r!", nil},
			{"valid with underscore", "Password_123", nil},
			{"valid 64 chars", strings.Repeat("A", 50) + "Secret123!Special", nil},
			{"valid 100 chars", strings.Repeat("B", 80) + "SuperLong99!SafeKey", nil},
			{"too long (over 128 chars)", strings.Repeat("C", 125) + "123!OverLimit", ErrPasswordTooLong},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				err := ValidatePasswordPolicy(tt.password)
				if err != tt.expectedErr {
					t.Errorf("ValidatePasswordPolicy(%q) = %v; want %v", tt.password, err, tt.expectedErr)
				}
			})
		}
	})

	t.Run("registration enforces password policy", func(t *testing.T) {
		req := validRegisterReq()
		req.Email = "weakpass@aura.dating"
		req.Password = "NoDigitSpecial!"
		_, err := svc.Register(ctx, req, ClientInfo{})
		if err != ErrPasswordMissingDigit {
			t.Errorf("expected ErrPasswordMissingDigit, got: %v", err)
		}

		req.Password = "NoSpecialDigit123"
		_, err = svc.Register(ctx, req, ClientInfo{})
		if err != ErrPasswordMissingSpecial {
			t.Errorf("expected ErrPasswordMissingSpecial, got: %v", err)
		}

		req.Password = "Valid123!Safe"
		regResp, err := svc.Register(ctx, req, ClientInfo{})
		if err != nil {
			t.Fatalf("expected registration to succeed with valid password: %v", err)
		}
		if regResp.User.ID == "" {
			t.Errorf("expected valid user ID")
		}
	})

	t.Run("confirm password reset enforces password policy", func(t *testing.T) {
		req := validRegisterReq()
		req.Email = "resetpass@aura.dating"
		req.Password = "Initial123!Pass"
		_, err := svc.Register(ctx, req, ClientInfo{})
		if err != nil {
			t.Fatalf("setup registration failed: %v", err)
		}

		token, err := svc.RequestPasswordReset(ctx, req.Email)
		if err != nil {
			t.Fatalf("failed to request password reset: %v", err)
		}

		// Weak reset password without special char
		err = svc.ConfirmPasswordReset(ctx, token, "WeakResetPass123")
		if err != ErrPasswordMissingSpecial {
			t.Errorf("expected ErrPasswordMissingSpecial, got: %v", err)
		}

		// Valid reset password
		err = svc.ConfirmPasswordReset(ctx, token, "StrongResetPass456!")
		if err != nil {
			t.Fatalf("expected valid password reset to succeed, got: %v", err)
		}
	})
}

func TestService_PasswordReset_DetailedSecuritySuite(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()

	// 1. User enumeration defense: unknown email returns generic success
	unknownToken, err := svc.RequestPasswordReset(ctx, "nonexistent_stranger@example.com", "192.168.1.50")
	if err != nil {
		t.Fatalf("expected nil error for unknown email, got: %v", err)
	}
	if unknownToken != "" {
		t.Errorf("expected empty token returned for unknown email, got: %s", unknownToken)
	}

	// 2. Setup real user
	userReq := validRegisterReq()
	userReq.Email = "security_target@aura.dating"
	userReq.Password = "OriginalPass123!"
	regResp, err := svc.Register(ctx, userReq, ClientInfo{})
	if err != nil {
		t.Fatalf("failed to register user: %v", err)
	}
	targetUserID := regResp.User.ID

	// Log in to establish an active session before reset
	loginResp, err := svc.Login(ctx, LoginRequest{Email: userReq.Email, Password: userReq.Password}, ClientInfo{})
	if err != nil {
		t.Fatalf("failed to log in: %v", err)
	}
	sessionHash := HashRefreshToken(loginResp.RefreshToken)
	activeSession, err := repo.GetSessionByTokenHash(ctx, sessionHash)
	if err != nil || activeSession.RevokedAt != nil {
		t.Fatalf("expected active unrevoked session before reset")
	}

	// 3. Rate limiting and resend throttling
	token1, err := svc.RequestPasswordReset(ctx, userReq.Email, "192.168.1.100")
	if err != nil {
		t.Fatalf("expected initial reset request to succeed: %v", err)
	}
	if token1 == "" {
		t.Fatalf("expected real token for registered user")
	}

	// Immediate second request for same email must trigger ErrResetRateLimited
	_, err = svc.RequestPasswordReset(ctx, userReq.Email, "192.168.1.100")
	if !errors.Is(err, ErrResetRateLimited) {
		t.Fatalf("expected ErrResetRateLimited on rapid consecutive request, got: %v", err)
	}

	// IP spamming test: exceeding IP limit triggers ErrResetRateLimited
	spamIP := "10.0.0.99"
	limiter := NewResetRateLimiter(0, 100, 3) // 3 per minute from same IP
	svc.SetResetRateLimiter(limiter)
	for i := 0; i < 3; i++ {
		_, _ = svc.RequestPasswordReset(ctx, fmt.Sprintf("test_%d@example.com", i), spamIP)
	}
	_, err = svc.RequestPasswordReset(ctx, "test_overflow@example.com", spamIP)
	if !errors.Is(err, ErrResetRateLimited) {
		t.Fatalf("expected ErrResetRateLimited on IP overflow, got: %v", err)
	}

	// Reset limiter with zero cooldown for remainder of test
	svc.SetResetRateLimiter(NewResetRateLimiter(0, 100, 100))

	// 4. Invalid token rejection
	err = svc.ConfirmPasswordReset(ctx, "completely_fake_invalid_token_hex_999", "NewPassword456!Secure")
	if !errors.Is(err, ErrPasswordResetNotFound) {
		t.Fatalf("expected ErrPasswordResetNotFound for fake token, got: %v", err)
	}

	// 5. Expired token rejection
	expiredReset := &PasswordReset{
		ID:        generateUUIDv4(),
		UserID:    targetUserID,
		TokenHash: HashTokenHex("expired_token_123"),
		ExpiresAt: time.Now().UTC().Add(-10 * time.Minute), // in past
		CreatedAt: time.Now().UTC().Add(-70 * time.Minute),
	}
	_ = repo.CreatePasswordReset(ctx, expiredReset)
	err = svc.ConfirmPasswordReset(ctx, "expired_token_123", "NewPassword456!Secure")
	if !errors.Is(err, ErrPasswordResetExpired) {
		t.Fatalf("expected ErrPasswordResetExpired for expired token, got: %v", err)
	}

	// 6. Valid password reset succeeds and revokes existing sessions
	validToken, err := svc.RequestPasswordReset(ctx, userReq.Email, "192.168.1.100")
	if err != nil {
		t.Fatalf("failed to request valid token: %v", err)
	}

	newPassword := "NewPassword456!Secure"
	err = svc.ConfirmPasswordReset(ctx, validToken, newPassword)
	if err != nil {
		t.Fatalf("expected valid reset to succeed, got: %v", err)
	}

	// 7. Single-use: Reusing the same token must fail with ErrPasswordResetExpired
	err = svc.ConfirmPasswordReset(ctx, validToken, "AnotherPassword789!Safe")
	if !errors.Is(err, ErrPasswordResetExpired) {
		t.Fatalf("expected ErrPasswordResetExpired on token reuse, got: %v", err)
	}

	// 8. Confirm old active session was revoked
	activeSessionAfter, err := repo.GetSessionByTokenHash(ctx, sessionHash)
	if err != nil {
		t.Fatalf("failed to fetch session after reset: %v", err)
	}
	if activeSessionAfter.RevokedAt == nil {
		t.Fatalf("expected session to be revoked after password reset!")
	}

	// Refreshing revoked session must fail
	_, err = svc.RefreshToken(ctx, loginResp.RefreshToken, ClientInfo{})
	if err == nil {
		t.Fatalf("expected refresh token to fail on revoked session")
	}

	// 9. Login with new password works
	newLogin, err := svc.Login(ctx, LoginRequest{Email: userReq.Email, Password: newPassword}, ClientInfo{})
	if err != nil {
		t.Fatalf("expected login with new password to succeed, got: %v", err)
	}
	if newLogin.User.ID != targetUserID {
		t.Errorf("expected target user ID to match")
	}
}

