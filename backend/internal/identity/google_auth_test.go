package identity

import (
	"context"
	"testing"
	"time"
)

func setupTestServiceWithGoogle() (*Service, *MemoryRepository, *MockGoogleTokenVerifier) {
	repo := NewMemoryRepository()
	verifier := NewMockGoogleTokenVerifier()
	svc := NewService(repo, "test-super-secret-jwt-key-minimum-32-chars", WithGoogleTokenVerifier(verifier), WithFastCrypto())
	return svc, repo, verifier
}

func TestGoogleAuth_NewUserSignup(t *testing.T) {
	svc, repo, verifier := setupTestServiceWithGoogle()
	ctx := context.Background()

	verifier.SetToken("valid-token-alice", &GoogleClaims{
		Subject:       "google-sub-alice-123",
		Email:         "alice@aura.dating",
		EmailVerified: true,
		Name:          "Alice Wonderland",
	})

	height := 172
	req := GoogleAuthRequest{
		IDToken:            "valid-token-alice",
		Birthdate:          "1998-05-15",
		GenderIdentities:   []string{"cisgender woman"},
		SexualOrientations: []string{"queer"},
		HeightCm:           &height,
	}

	resp, err := svc.AuthenticateWithGoogle(ctx, req, ClientInfo{IPAddress: "127.0.0.1"})
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

	// Verify OAuth identity persisted
	ident, err := repo.GetOAuthIdentity(ctx, "google", "google-sub-alice-123")
	if err != nil {
		t.Fatalf("expected oauth identity in repo: %v", err)
	}
	if ident.UserID != resp.User.ID {
		t.Errorf("expected ident user_id %s, got %s", resp.User.ID, ident.UserID)
	}
}

func TestGoogleAuth_ExistingAccountLinking(t *testing.T) {
	svc, repo, verifier := setupTestServiceWithGoogle()
	ctx := context.Background()

	// 1. Existing user registered via email/password
	now := time.Now().UTC()
	existingUser := &User{
		ID:           "user-bob-uuid",
		Email:        "bob@aura.dating",
		PasswordHash: "mock-hash",
		Status:       StatusActive,
		Role:         RoleMember,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := repo.CreateUser(ctx, existingUser); err != nil {
		t.Fatalf("failed to create existing user: %v", err)
	}

	// 2. Bob logs in via Google with the same email
	verifier.SetToken("bob-google-token", &GoogleClaims{
		Subject:       "google-sub-bob-456",
		Email:         "bob@aura.dating",
		EmailVerified: true,
		Name:          "Bob Explorer",
	})

	resp, err := svc.AuthenticateWithGoogle(ctx, GoogleAuthRequest{IDToken: "bob-google-token"}, ClientInfo{IPAddress: "127.0.0.1"})
	if err != nil {
		t.Fatalf("unexpected error linking Google account: %v", err)
	}

	if resp.User.ID != "user-bob-uuid" {
		t.Errorf("expected linked user ID user-bob-uuid, got %s", resp.User.ID)
	}

	// Verify OAuth identity linked to Bob's ID
	ident, err := repo.GetOAuthIdentity(ctx, "google", "google-sub-bob-456")
	if err != nil {
		t.Fatalf("expected oauth identity to be linked: %v", err)
	}
	if ident.UserID != "user-bob-uuid" {
		t.Errorf("expected ident user_id user-bob-uuid, got %s", ident.UserID)
	}

	// 3. Subsequent login with the same Google account
	resp2, err := svc.AuthenticateWithGoogle(ctx, GoogleAuthRequest{IDToken: "bob-google-token"}, ClientInfo{IPAddress: "127.0.0.1"})
	if err != nil {
		t.Fatalf("unexpected error on subsequent Google login: %v", err)
	}
	if resp2.User.ID != "user-bob-uuid" {
		t.Errorf("expected user ID user-bob-uuid on subsequent login, got %s", resp2.User.ID)
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
	if err == nil {
		t.Fatalf("expected error for unverified Google email, got nil")
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
	_ = repo.CreateUser(ctx, bannedUser)

	verifier.SetToken("banned-token", &GoogleClaims{
		Subject:       "banned-sub-999",
		Email:         "banned@aura.dating",
		EmailVerified: true,
	})

	_, err := svc.AuthenticateWithGoogle(ctx, GoogleAuthRequest{IDToken: "banned-token"}, ClientInfo{})
	if err == nil {
		t.Fatalf("expected error for suspended user, got nil")
	}
}
