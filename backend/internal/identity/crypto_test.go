package identity

import (
	"testing"
	"time"
)

func TestHashAndVerifyPassword(t *testing.T) {
	password := "AuraSecret123!SecurePassphrase"

	hash, err := HashPasswordWithParams(password, FastTestArgonParams)
	if err != nil {
		t.Fatalf("unexpected error hashing password: %v", err)
	}

	if len(hash) == 0 {
		t.Fatalf("expected non-empty hash")
	}

	// Verify with correct password
	valid, err := VerifyPassword(password, hash)
	if err != nil {
		t.Fatalf("unexpected error verifying password: %v", err)
	}
	if !valid {
		t.Fatalf("expected password verification to succeed")
	}

	// Verify with wrong password
	valid, err = VerifyPassword("WrongPassword!", hash)
	if err != nil {
		t.Fatalf("unexpected error on wrong password: %v", err)
	}
	if valid {
		t.Fatalf("expected verification to fail on wrong password")
	}

	// Verify with corrupted hash
	_, err = VerifyPassword(password, "invalid$argon$hash")
	if err == nil {
		t.Fatalf("expected error on malformed hash")
	}
}

func TestGenerateAndVerifyAccessToken(t *testing.T) {
	secret := "super-secure-production-ready-jwt-secret-key-32b"
	user := &User{
		ID:    "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
		Email: "alex@aura.dating",
		Role:  RoleMember,
	}

	token, err := GenerateAccessToken(secret, user, 15*time.Minute)
	if err != nil {
		t.Fatalf("unexpected error generating access token: %v", err)
	}

	claims, err := ParseAndVerifyAccessToken(secret, token)
	if err != nil {
		t.Fatalf("unexpected error parsing token: %v", err)
	}
	if claims.Subject != user.ID {
		t.Errorf("expected subject %s, got %s", user.ID, claims.Subject)
	}
	if claims.Email != user.Email {
		t.Errorf("expected email %s, got %s", user.Email, claims.Email)
	}
	if claims.Role != RoleMember {
		t.Errorf("expected role MEMBER, got %s", claims.Role)
	}

	// Tampered token signature
	tampered := token[:len(token)-4] + "ABCD"
	if _, err := ParseAndVerifyAccessToken(secret, tampered); err == nil {
		t.Fatalf("expected error on tampered token signature")
	}

	// Expired token
	expiredToken, err := GenerateAccessToken(secret, user, -1*time.Second)
	if err != nil {
		t.Fatalf("unexpected error generating expired token: %v", err)
	}
	if _, err := ParseAndVerifyAccessToken(secret, expiredToken); err != ErrTokenExpired {
		t.Fatalf("expected ErrTokenExpired, got %v", err)
	}
}

func TestGenerateTokensAndOTP(t *testing.T) {
	plain, hash, err := GenerateRefreshToken()
	if err != nil {
		t.Fatalf("failed to generate refresh token: %v", err)
	}
	if len(plain) != 64 { // 32 bytes hex encoded
		t.Errorf("expected 64 hex chars, got %d", len(plain))
	}
	if len(hash) != 32 {
		t.Errorf("expected 32 bytes hash, got %d", len(hash))
	}

	otp, otpHash, err := GenerateNumericOTP(6)
	if err != nil {
		t.Fatalf("failed to generate numeric OTP: %v", err)
	}
	if len(otp) != 6 {
		t.Errorf("expected 6-digit OTP, got %s", otp)
	}
	if len(otpHash) != 64 {
		t.Errorf("expected 64 hex chars hash, got %d", len(otpHash))
	}
}
