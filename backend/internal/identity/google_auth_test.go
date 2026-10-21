package identity

import (
	"context"
	"errors"
	"testing"
	"time"

	"google.golang.org/api/idtoken"
)

// stubGoogleVerifier is a test double for the GoogleTokenVerifier seam. It lives
// only in test code and is never reachable from production paths. The real
// GoogleIDTokenVerifier (which performs cryptographic verification against
// Google's published certificates) is exercised separately below.
type stubGoogleVerifier struct {
	claims map[string]*GoogleClaims
	err    error
}

func newStubGoogleVerifier() *stubGoogleVerifier {
	return &stubGoogleVerifier{claims: make(map[string]*GoogleClaims)}
}

func (s *stubGoogleVerifier) SetToken(token string, claims *GoogleClaims) {
	s.claims[token] = claims
}

func (s *stubGoogleVerifier) VerifyToken(_ context.Context, idToken string) (*GoogleClaims, error) {
	if s.err != nil {
		return nil, s.err
	}
	claims, ok := s.claims[idToken]
	if !ok {
		return nil, ErrInvalidOAuthToken
	}
	return claims, nil
}

func setupTestServiceWithGoogle() (*Service, *MemoryRepository, *stubGoogleVerifier) {
	repo := NewMemoryRepository()
	verifier := newStubGoogleVerifier()
	svc := NewService(repo, "test-super-secret-jwt-key-minimum-32-chars", WithGoogleTokenVerifier(verifier), WithFastCrypto())
	return svc, repo, verifier
}

// ---------------------------------------------------------------------------
// GoogleIDTokenVerifier: real (unmocked) verification logic
// ---------------------------------------------------------------------------

func googlePayload(overrides map[string]interface{}) *idtoken.Payload {
	claims := map[string]interface{}{
		"email":          "member@aura.dating",
		"email_verified": true,
		"name":           "Aura Member",
	}
	for k, v := range overrides {
		claims[k] = v
	}
	return &idtoken.Payload{
		Issuer:   googleIssuer,
		Audience: "aura-android-client-id.apps.googleusercontent.com",
		Expires:  time.Now().Add(time.Hour).Unix(),
		IssuedAt: time.Now().Add(-time.Minute).Unix(),
		Subject:  "google-subject-1234567890",
		Claims:   claims,
	}
}

func verifierWithPayload(t *testing.T, payload *idtoken.Payload, expectedAud string) *GoogleIDTokenVerifier {
	t.Helper()
	v := NewGoogleIDTokenVerifier([]string{expectedAud})
	v.validateFn = func(_ context.Context, rawToken, audience string) (*idtoken.Payload, error) {
		// Mimic the real validator: a token is only accepted for its audience.
		if rawToken == "" {
			return nil, errors.New("empty token")
		}
		if audience != expectedAud {
			return nil, errors.New("audience mismatch")
		}
		if payload == nil {
			return nil, errors.New("invalid token")
		}
		return payload, nil
	}
	return v
}

func TestGoogleIDTokenVerifier_RequiresConfiguredAudience(t *testing.T) {
	v := NewGoogleIDTokenVerifier(nil)
	if v.OAuthAudiencesConfigured() {
		t.Fatalf("expected verifier to report no configured audiences")
	}
	_, err := v.VerifyToken(context.Background(), "any-token")
	if !errors.Is(err, ErrGoogleAuthNotConfigured) {
		t.Fatalf("expected ErrGoogleAuthNotConfigured, got %v", err)
	}
}

func TestGoogleIDTokenVerifier_WildcardAudienceRejected(t *testing.T) {
	v := NewGoogleIDTokenVerifier([]string{"*", "   "})
	if v.OAuthAudiencesConfigured() {
		t.Fatalf("wildcard/blank audiences must not count as configuration")
	}
	if _, err := v.VerifyToken(context.Background(), "token"); !errors.Is(err, ErrGoogleAuthNotConfigured) {
		t.Fatalf("expected fail-closed ErrGoogleAuthNotConfigured, got %v", err)
	}
}

func TestGoogleIDTokenVerifier_ValidToken(t *testing.T) {
	const aud = "aura-android-client-id.apps.googleusercontent.com"
	v := verifierWithPayload(t, googlePayload(nil), aud)

	claims, err := v.VerifyToken(context.Background(), "valid-google-id-token")
	if err != nil {
		t.Fatalf("expected valid token to be accepted, got %v", err)
	}
	if claims.Email != "member@aura.dating" {
		t.Errorf("expected email member@aura.dating, got %s", claims.Email)
	}
	if !claims.EmailVerified {
		t.Errorf("expected email_verified to be true")
	}
	if claims.Subject != "google-subject-1234567890" {
		t.Errorf("unexpected subject %s", claims.Subject)
	}
}

func TestGoogleIDTokenVerifier_SecondAudienceAccepted(t *testing.T) {
	payload := googlePayload(map[string]interface{}{"aud": "ios-client"})
	v := NewGoogleIDTokenVerifier([]string{"android-client", "ios-client"})
	v.validateFn = func(_ context.Context, _ string, audience string) (*idtoken.Payload, error) {
		if audience == "ios-client" {
			return payload, nil
		}
		return nil, errors.New("audience mismatch")
	}
	if _, err := v.VerifyToken(context.Background(), "token"); err != nil {
		t.Fatalf("expected the matching audience to be accepted, got %v", err)
	}
}

func TestGoogleIDTokenVerifier_WrongAudience(t *testing.T) {
	v := verifierWithPayload(t, googlePayload(nil), "expected-audience")
	v.validateFn = func(_ context.Context, _ string, audience string) (*idtoken.Payload, error) {
		if audience != "expected-audience" {
			return nil, errors.New("audience mismatch")
		}
		return nil, errors.New("audience mismatch")
	}
	_, err := v.VerifyToken(context.Background(), "token")
	if !errors.Is(err, ErrInvalidOAuthToken) {
		t.Fatalf("expected ErrInvalidOAuthToken for wrong audience, got %v", err)
	}
}

func TestGoogleIDTokenVerifier_FabricatedTokenRejected(t *testing.T) {
	v := verifierWithPayload(t, nil, "expected-audience")
	_, err := v.VerifyToken(context.Background(), "mock-google:google-uid-1:fake@aura.dating")
	if !errors.Is(err, ErrInvalidOAuthToken) {
		t.Fatalf("expected fabricated token to be rejected, got %v", err)
	}
}

func TestGoogleIDTokenVerifier_EmptyTokenRejected(t *testing.T) {
	v := verifierWithPayload(t, googlePayload(nil), "expected-audience")
	if _, err := v.VerifyToken(context.Background(), "   "); !errors.Is(err, ErrInvalidOAuthToken) {
		t.Fatalf("expected ErrInvalidOAuthToken for empty token, got %v", err)
	}
}

// TestGoogleIDTokenVerifier_RealValidatorRejectsForgedSignature asserts that the
// default (non-stubbed) verification path is wired to Google's official
// google.golang.org/api/idtoken library and rejects unsigned / unverifiable
// tokens. Cryptographic RS256 signature verification against Google's published
// certificates is performed by that library, not by hand-rolled parsing here.
func TestGoogleIDTokenVerifier_RealValidatorRejectsForgedSignature(t *testing.T) {
	v := NewGoogleIDTokenVerifier([]string{"aura-android-client-id.apps.googleusercontent.com"})
	if v.validateFn != nil {
		t.Fatal("the production verifier must never ship with a stubbed validation function")
	}

	forged := []string{
		// Not a JWT at all.
		"not-a-jwt",
		// "alg: none" unsigned token: header {"alg":"none","typ":"JWT"} payload {}
		"eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.e30.",
	}
	for _, token := range forged {
		_, err := v.VerifyToken(context.Background(), token)
		if err == nil {
			t.Fatalf("forged token %q must be rejected", token)
		}
		if !errors.Is(err, ErrInvalidOAuthToken) {
			t.Fatalf("expected ErrInvalidOAuthToken for forged token %q, got %v", token, err)
		}
	}
}

func TestGoogleIDTokenVerifier_UntrustedIssuerRejected(t *testing.T) {
	payload := googlePayload(nil)
	payload.Issuer = "https://accounts.evil.example"
	v := verifierWithPayload(t, payload, "aura-client")
	if _, err := v.VerifyToken(context.Background(), "token"); !errors.Is(err, ErrInvalidOAuthToken) {
		t.Fatalf("expected untrusted issuer to be rejected, got %v", err)
	}
}

func TestGoogleIDTokenVerifier_ExpiredTokenRejected(t *testing.T) {
	payload := googlePayload(nil)
	payload.Expires = time.Now().Add(-time.Hour).Unix()
	v := verifierWithPayload(t, payload, "aura-client")
	if _, err := v.VerifyToken(context.Background(), "token"); !errors.Is(err, ErrInvalidOAuthToken) {
		t.Fatalf("expected expired token to be rejected, got %v", err)
	}
}

func TestGoogleIDTokenVerifier_MissingSubjectRejected(t *testing.T) {
	payload := googlePayload(nil)
	payload.Subject = ""
	v := verifierWithPayload(t, payload, "aura-client")
	if _, err := v.VerifyToken(context.Background(), "token"); !errors.Is(err, ErrInvalidOAuthToken) {
		t.Fatalf("expected missing subject to be rejected, got %v", err)
	}
}

func TestGoogleIDTokenVerifier_UnverifiedEmailRejected(t *testing.T) {
	payload := googlePayload(map[string]interface{}{"email_verified": false})
	v := verifierWithPayload(t, payload, "aura-client")
	if _, err := v.VerifyToken(context.Background(), "token"); !errors.Is(err, ErrOAuthEmailNotVerified) {
		t.Fatalf("expected ErrOAuthEmailNotVerified, got %v", err)
	}
}

func TestGoogleIDTokenVerifier_MissingEmailRejected(t *testing.T) {
	payload := googlePayload(map[string]interface{}{"email": ""})
	v := verifierWithPayload(t, payload, "aura-client")
	if _, err := v.VerifyToken(context.Background(), "token"); !errors.Is(err, ErrInvalidOAuthToken) {
		t.Fatalf("expected missing email to be rejected, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// AuthenticateWithGoogle: service behaviour
// ---------------------------------------------------------------------------

func TestGoogleAuth_NewUserSignup(t *testing.T) {
	svc, repo, verifier := setupTestServiceWithGoogle()
	ctx := context.Background()

	verifier.SetToken("valid-token-alice", &GoogleClaims{
		Subject:       "google-sub-alice-123",
		Email:         "alice@aura.dating",
		EmailVerified: true,
		Name:          "Alice Wonderland",
	})

	resp, err := svc.AuthenticateWithGoogle(ctx, GoogleAuthRequest{IDToken: "valid-token-alice"}, ClientInfo{IPAddress: "127.0.0.1"})
	if err != nil {
		t.Fatalf("unexpected error during Google signup: %v", err)
	}

	if resp.AccessToken == "" || resp.RefreshToken == "" {
		t.Errorf("expected access and refresh tokens, got empty")
	}
	if resp.User.Email != "alice@aura.dating" {
		t.Errorf("expected email alice@aura.dating, got %s", resp.User.Email)
	}
	if resp.User.EmailVerifiedAt == nil {
		t.Errorf("expected email to be verified by Google OAuth")
	}
	if !resp.OnboardingRequired {
		t.Errorf("expected onboarding to be required for a brand new Google account")
	}
	if resp.Profile != nil {
		t.Errorf("expected no profile to be invented for a new account, got %+v", resp.Profile)
	}

	// No profile must be created behind the scenes.
	if _, err := repo.GetProfile(ctx, resp.User.ID); !errors.Is(err, ErrProfileNotFound) {
		t.Errorf("expected no profile to be created, got err=%v", err)
	}

	ident, err := repo.GetOAuthIdentity(ctx, "google", "google-sub-alice-123")
	if err != nil {
		t.Fatalf("expected oauth identity in repo: %v", err)
	}
	if ident.UserID != resp.User.ID {
		t.Errorf("expected ident user_id %s, got %s", resp.User.ID, ident.UserID)
	}
}

func TestGoogleAuth_ExistingEmailAccountRequiresLinking(t *testing.T) {
	svc, repo, verifier := setupTestServiceWithGoogle()
	ctx := context.Background()

	now := time.Now().UTC()
	existingUser := &User{
		ID:           "user-bob-uuid",
		Email:        "bob@aura.dating",
		PasswordHash: "argon2id-hash",
		Status:       StatusActive,
		Role:         RoleMember,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := repo.CreateUser(ctx, existingUser); err != nil {
		t.Fatalf("failed to create existing user: %v", err)
	}

	verifier.SetToken("bob-google-token", &GoogleClaims{
		Subject:       "google-sub-bob-456",
		Email:         "bob@aura.dating",
		EmailVerified: true,
		Name:          "Bob Explorer",
	})

	// Implicit linking must NOT happen.
	_, err := svc.AuthenticateWithGoogle(ctx, GoogleAuthRequest{IDToken: "bob-google-token"}, ClientInfo{IPAddress: "127.0.0.1"})
	if !errors.Is(err, ErrGoogleAccountLinkRequired) {
		t.Fatalf("expected ErrGoogleAccountLinkRequired, got %v", err)
	}
	if _, err := repo.GetOAuthIdentity(ctx, "google", "google-sub-bob-456"); !errors.Is(err, ErrOAuthIdentityNotFound) {
		t.Fatalf("expected no identity to be created without proof of ownership, got %v", err)
	}
}

func TestGoogleAuth_LinkExistingAccountAndSubsequentLogin(t *testing.T) {
	svc, repo, verifier := setupTestServiceWithGoogle()
	ctx := context.Background()

	now := time.Now().UTC()
	if err := repo.CreateUser(ctx, &User{
		ID:           "user-bob-uuid",
		Email:        "bob@aura.dating",
		PasswordHash: "argon2id-hash",
		Status:       StatusActive,
		Role:         RoleMember,
		CreatedAt:    now,
		UpdatedAt:    now,
	}); err != nil {
		t.Fatalf("failed to create existing user: %v", err)
	}

	verifier.SetToken("bob-google-token", &GoogleClaims{
		Subject:       "google-sub-bob-456",
		Email:         "bob@aura.dating",
		EmailVerified: true,
	})

	// Explicit link with the authenticated session as proof of ownership.
	if err := svc.LinkGoogleIdentity(ctx, "user-bob-uuid", LinkGoogleRequest{IDToken: "bob-google-token"}); err != nil {
		t.Fatalf("expected link to succeed: %v", err)
	}

	// Idempotent: linking the same identity again is a no-op.
	if err := svc.LinkGoogleIdentity(ctx, "user-bob-uuid", LinkGoogleRequest{IDToken: "bob-google-token"}); err != nil {
		t.Fatalf("expected repeated link to be idempotent: %v", err)
	}

	resp, err := svc.AuthenticateWithGoogle(ctx, GoogleAuthRequest{IDToken: "bob-google-token"}, ClientInfo{IPAddress: "127.0.0.1"})
	if err != nil {
		t.Fatalf("unexpected error on Google login after linking: %v", err)
	}
	if resp.User.ID != "user-bob-uuid" {
		t.Errorf("expected user ID user-bob-uuid, got %s", resp.User.ID)
	}
}

func TestGoogleAuth_LinkRejectsEmailMismatch(t *testing.T) {
	svc, repo, verifier := setupTestServiceWithGoogle()
	ctx := context.Background()

	now := time.Now().UTC()
	if err := repo.CreateUser(ctx, &User{
		ID:           "user-bob-uuid",
		Email:        "bob@aura.dating",
		PasswordHash: "argon2id-hash",
		Status:       StatusActive,
		Role:         RoleMember,
		CreatedAt:    now,
		UpdatedAt:    now,
	}); err != nil {
		t.Fatalf("failed to create existing user: %v", err)
	}

	verifier.SetToken("other-google-token", &GoogleClaims{
		Subject:       "google-sub-other",
		Email:         "other@aura.dating",
		EmailVerified: true,
	})

	if err := svc.LinkGoogleIdentity(ctx, "user-bob-uuid", LinkGoogleRequest{IDToken: "other-google-token"}); !errors.Is(err, ErrGoogleEmailMismatch) {
		t.Fatalf("expected ErrGoogleEmailMismatch, got %v", err)
	}
}

func TestGoogleAuth_LinkRejectsIdentityConflict(t *testing.T) {
	svc, repo, verifier := setupTestServiceWithGoogle()
	ctx := context.Background()

	now := time.Now().UTC()
	for _, u := range []*User{
		{ID: "user-a", Email: "a@aura.dating", Status: StatusActive, Role: RoleMember, CreatedAt: now, UpdatedAt: now},
		{ID: "user-b", Email: "b@aura.dating", Status: StatusActive, Role: RoleMember, CreatedAt: now, UpdatedAt: now},
	} {
		if err := repo.CreateUser(ctx, u); err != nil {
			t.Fatalf("failed to seed user: %v", err)
		}
	}

	// identity already linked to user A
	if err := repo.CreateOAuthIdentity(ctx, &OAuthIdentity{
		ID:              "ident-1",
		UserID:          "user-a",
		Provider:        "google",
		ProviderSubject: "shared-google-sub",
		Email:           "b@aura.dating",
		EmailVerified:   true,
		LinkedAt:        now,
	}); err != nil {
		t.Fatalf("failed to seed identity: %v", err)
	}

	verifier.SetToken("shared-token", &GoogleClaims{
		Subject:       "shared-google-sub",
		Email:         "b@aura.dating",
		EmailVerified: true,
	})

	if err := svc.LinkGoogleIdentity(ctx, "user-b", LinkGoogleRequest{IDToken: "shared-token"}); !errors.Is(err, ErrGoogleIdentityConflict) {
		t.Fatalf("expected ErrGoogleIdentityConflict, got %v", err)
	}
}

func TestGoogleAuth_DuplicateEmailIdentityConflict(t *testing.T) {
	svc, repo, verifier := setupTestServiceWithGoogle()
	ctx := context.Background()

	now := time.Now().UTC()
	if err := repo.CreateUser(ctx, &User{
		ID: "user-a", Email: "shared@aura.dating", Status: StatusActive, Role: RoleMember, CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("failed to seed user: %v", err)
	}
	if err := repo.CreateOAuthIdentity(ctx, &OAuthIdentity{
		ID:              "ident-1",
		UserID:          "user-a",
		Provider:        "google",
		ProviderSubject: "original-sub",
		Email:           "shared@aura.dating",
		EmailVerified:   true,
		LinkedAt:        now,
	}); err != nil {
		t.Fatalf("failed to seed identity: %v", err)
	}

	// A different Google subject claiming the same email must not be able to log in.
	verifier.SetToken("attacker-token", &GoogleClaims{
		Subject:       "different-sub",
		Email:         "shared@aura.dating",
		EmailVerified: true,
	})

	_, err := svc.AuthenticateWithGoogle(ctx, GoogleAuthRequest{IDToken: "attacker-token"}, ClientInfo{})
	if !errors.Is(err, ErrGoogleIdentityConflict) {
		t.Fatalf("expected ErrGoogleIdentityConflict, got %v", err)
	}
}

func TestGoogleAuth_UnverifiedEmailRejected(t *testing.T) {
	svc, _, verifier := setupTestServiceWithGoogle()
	ctx := context.Background()

	verifier.SetToken("unverified-token", &GoogleClaims{
		Subject:       "google-sub-eve-789",
		Email:         "eve@attacker.com",
		EmailVerified: false,
	})

	_, err := svc.AuthenticateWithGoogle(ctx, GoogleAuthRequest{IDToken: "unverified-token"}, ClientInfo{})
	if !errors.Is(err, ErrOAuthEmailNotVerified) {
		t.Fatalf("expected error for unverified Google email, got %v", err)
	}
}

func TestGoogleAuth_FabricatedTokenRejected(t *testing.T) {
	svc, repo, _ := setupTestServiceWithGoogle()
	ctx := context.Background()

	_, err := svc.AuthenticateWithGoogle(ctx, GoogleAuthRequest{IDToken: "mock-google:google-uid-xyz:fake@aura.dating"}, ClientInfo{})
	if !errors.Is(err, ErrInvalidOAuthToken) {
		t.Fatalf("expected fabricated token to be rejected, got %v", err)
	}
	if _, err := repo.GetUserByEmail(ctx, "fake@aura.dating"); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("no account may be created for a fabricated token, got %v", err)
	}
}

func TestGoogleAuth_SuspendedUserBlocked(t *testing.T) {
	svc, repo, verifier := setupTestServiceWithGoogle()
	ctx := context.Background()

	now := time.Now().UTC()
	bannedUser := &User{
		ID:        "banned-user-id",
		Email:     "banned@aura.dating",
		Status:    StatusBanned,
		Role:      RoleMember,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := repo.CreateUser(ctx, bannedUser); err != nil {
		t.Fatalf("failed to seed banned user: %v", err)
	}
	if err := repo.CreateOAuthIdentity(ctx, &OAuthIdentity{
		ID:              "ident-banned",
		UserID:          bannedUser.ID,
		Provider:        "google",
		ProviderSubject: "banned-sub-999",
		Email:           "banned@aura.dating",
		EmailVerified:   true,
		LinkedAt:        now,
	}); err != nil {
		t.Fatalf("failed to seed identity: %v", err)
	}

	verifier.SetToken("banned-token", &GoogleClaims{
		Subject:       "banned-sub-999",
		Email:         "banned@aura.dating",
		EmailVerified: true,
	})

	_, err := svc.AuthenticateWithGoogle(ctx, GoogleAuthRequest{IDToken: "banned-token"}, ClientInfo{})
	if !errors.Is(err, ErrAccountNotActive) {
		t.Fatalf("expected ErrAccountNotActive for banned user, got %v", err)
	}
}

func TestGoogleAuth_MissingConfigurationFailsClosed(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewService(repo, "test-super-secret-jwt-key-minimum-32-chars", WithFastCrypto())

	_, err := svc.AuthenticateWithGoogle(context.Background(), GoogleAuthRequest{IDToken: "any"}, ClientInfo{})
	if !errors.Is(err, ErrGoogleAuthNotConfigured) {
		t.Fatalf("expected fail-closed ErrGoogleAuthNotConfigured with no audiences, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// Profile onboarding: no fabricated data
// ---------------------------------------------------------------------------

func TestGetMyProfile_NoProfileIsInvented(t *testing.T) {
	svc, repo, verifier := setupTestServiceWithGoogle()
	ctx := context.Background()

	verifier.SetToken("token", &GoogleClaims{
		Subject:       "sub-new",
		Email:         "new@aura.dating",
		EmailVerified: true,
	})
	resp, err := svc.AuthenticateWithGoogle(ctx, GoogleAuthRequest{IDToken: "token"}, ClientInfo{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	full, err := svc.GetMyProfile(ctx, resp.User.ID)
	if err != nil {
		t.Fatalf("unexpected error fetching profile: %v", err)
	}
	if full.Profile != nil {
		t.Errorf("expected nil profile, got %+v", full.Profile)
	}
	if !full.OnboardingRequired {
		t.Errorf("expected OnboardingRequired to be true")
	}
	if full.IsComplete {
		t.Errorf("expected IsComplete to be false")
	}
	if _, err := repo.GetProfile(ctx, resp.User.ID); !errors.Is(err, ErrProfileNotFound) {
		t.Errorf("expected no profile persisted, got %v", err)
	}
}

func TestUpdateMyProfile_OnboardingValidation(t *testing.T) {
	svc, repo, verifier := setupTestServiceWithGoogle()
	ctx := context.Background()

	verifier.SetToken("token", &GoogleClaims{
		Subject:       "sub-onboard",
		Email:         "onboard@aura.dating",
		EmailVerified: true,
	})
	resp, err := svc.AuthenticateWithGoogle(ctx, GoogleAuthRequest{IDToken: "token"}, ClientInfo{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	userID := resp.User.ID

	// Missing birthdate must fail.
	name := "Ada"
	if _, err := svc.UpdateMyProfile(ctx, userID, UpdateProfileRequest{
		DisplayName:        &name,
		GenderIdentities:   []string{"cisgender woman"},
		SexualOrientations: []string{"queer"},
	}); err == nil {
		t.Fatalf("expected onboarding without birthdate to fail")
	}

	// Underage birthdate must fail.
	underage := "2015-01-01"
	if _, err := svc.UpdateMyProfile(ctx, userID, UpdateProfileRequest{
		DisplayName:        &name,
		Birthdate:          &underage,
		GenderIdentities:   []string{"cisgender woman"},
		SexualOrientations: []string{"queer"},
	}); err == nil {
		t.Fatalf("expected underage birthdate to be rejected")
	}

	// Complete onboarding succeeds.
	birthdate := "1995-05-15"
	profile, err := svc.UpdateMyProfile(ctx, userID, UpdateProfileRequest{
		DisplayName:        &name,
		Birthdate:          &birthdate,
		GenderIdentities:   []string{"cisgender woman"},
		SexualOrientations: []string{"queer"},
	})
	if err != nil {
		t.Fatalf("expected onboarding to succeed: %v", err)
	}
	if profile.DisplayName != "Ada" {
		t.Errorf("expected display name Ada, got %s", profile.DisplayName)
	}

	stored, err := repo.GetProfile(ctx, userID)
	if err != nil {
		t.Fatalf("expected profile to be persisted: %v", err)
	}
	if stored.Birthdate.Format("2006-01-02") != birthdate {
		t.Errorf("expected stored birthdate %s, got %s", birthdate, stored.Birthdate.Format("2006-01-02"))
	}
}

func TestUpdateMyProfile_BirthdateIsImmutable(t *testing.T) {
	svc, _, _ := setupTestServiceWithGoogle()
	ctx := context.Background()

	now := time.Now().UTC()
	if err := svc.repo.CreateUser(ctx, &User{
		ID: "user-immutable", Email: "immutable@aura.dating", Status: StatusActive, Role: RoleMember, CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("failed to seed user: %v", err)
	}

	birthdate := "1990-02-02"
	if _, err := svc.UpdateMyProfile(ctx, "user-immutable", UpdateProfileRequest{
		DisplayName:        strPtr("Rae"),
		Birthdate:          &birthdate,
		GenderIdentities:   []string{"non_binary"},
		SexualOrientations: []string{"queer"},
	}); err != nil {
		t.Fatalf("expected initial profile creation to succeed: %v", err)
	}

	// Re-sending the same birthdate is allowed (idempotent onboarding retries).
	if _, err := svc.UpdateMyProfile(ctx, "user-immutable", UpdateProfileRequest{Birthdate: &birthdate}); err != nil {
		t.Fatalf("expected identical birthdate to be accepted: %v", err)
	}

	// Changing it must be rejected.
	changed := "1991-02-02"
	if _, err := svc.UpdateMyProfile(ctx, "user-immutable", UpdateProfileRequest{Birthdate: &changed}); !errors.Is(err, ErrBirthdateImmutable) {
		t.Fatalf("expected ErrBirthdateImmutable, got %v", err)
	}
}

func strPtr(s string) *string { return &s }
