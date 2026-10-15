package safety

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrInvalidStepUpToken = errors.New("invalid or expired step-up authentication token")
	ErrStepUpUserMismatch = errors.New("step-up token was issued for a different user")
)

const StepUpTokenDefaultDuration = 15 * time.Minute

// StepUpClaims represents the server-verified claims inside a cryptographic step-up token.
type StepUpClaims struct {
	Subject   string `json:"sub"` // User ID of privileged actor
	Purpose   string `json:"pur"` // Must be "step_up"
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
	Nonce     string `json:"jti"`
}

// StepUpVerifier specifies cryptographic validation for step-up authentication tokens.
type StepUpVerifier interface {
	VerifyStepUpToken(tokenStr string, expectedUserID string) error
	GenerateStepUpToken(userID string, ttl time.Duration) (string, error)
}

// TokenStepUpVerifier implements StepUpVerifier using HMAC-SHA256 tokens.
type TokenStepUpVerifier struct {
	signingKey []byte
}

func NewTokenStepUpVerifier(secret string) *TokenStepUpVerifier {
	if len(secret) < 16 {
		// Enforce non-empty key; pad if short for dev safety
		secret = secret + "_aura_step_up_default_salt_32b!"
	}
	return &TokenStepUpVerifier{
		signingKey: []byte(secret),
	}
}

// GenerateStepUpToken creates an HMAC-SHA256 signed, time-limited step-up token bound to a specific user.
func (v *TokenStepUpVerifier) GenerateStepUpToken(userID string, ttl time.Duration) (string, error) {
	if strings.TrimSpace(userID) == "" {
		return "", errors.New("user ID cannot be empty")
	}
	if ttl == 0 {
		ttl = StepUpTokenDefaultDuration
	}

	headerJSON := `{"alg":"HS256","typ":"AURA-STEP-UP"}`
	headerB64 := base64.RawURLEncoding.EncodeToString([]byte(headerJSON))

	nonceBytes := make([]byte, 16)
	_, _ = rand.Read(nonceBytes)

	now := time.Now().UTC()
	claims := StepUpClaims{
		Subject:   strings.TrimSpace(userID),
		Purpose:   "step_up",
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(ttl).Unix(),
		Nonce:     hex.EncodeToString(nonceBytes),
	}

	claimsJSON, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("failed to marshal step-up claims: %w", err)
	}
	claimsB64 := base64.RawURLEncoding.EncodeToString(claimsJSON)

	payload := headerB64 + "." + claimsB64
	mac := hmac.New(sha256.New, v.signingKey)
	mac.Write([]byte(payload))
	sigB64 := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return payload + "." + sigB64, nil
}

// VerifyStepUpToken verifies signature, expiry, and user binding.
func (v *TokenStepUpVerifier) VerifyStepUpToken(tokenStr string, expectedUserID string) error {
	tokenStr = strings.TrimSpace(tokenStr)
	if tokenStr == "" {
		return ErrInvalidStepUpToken
	}

	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return ErrInvalidStepUpToken
	}

	headerB64, claimsB64, sigB64 := parts[0], parts[1], parts[2]
	payload := headerB64 + "." + claimsB64

	mac := hmac.New(sha256.New, v.signingKey)
	mac.Write([]byte(payload))
	expectedSig := mac.Sum(nil)

	actualSig, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return ErrInvalidStepUpToken
	}

	if subtle.ConstantTimeCompare(expectedSig, actualSig) != 1 {
		return ErrInvalidStepUpToken
	}

	claimsBytes, err := base64.RawURLEncoding.DecodeString(claimsB64)
	if err != nil {
		return ErrInvalidStepUpToken
	}

	var claims StepUpClaims
	if err := json.Unmarshal(claimsBytes, &claims); err != nil {
		return ErrInvalidStepUpToken
	}

	if claims.Purpose != "step_up" {
		return ErrInvalidStepUpToken
	}

	now := time.Now().UTC().Unix()
	if now > claims.ExpiresAt {
		return ErrInvalidStepUpToken
	}

	if strings.TrimSpace(expectedUserID) != "" && !strings.EqualFold(claims.Subject, strings.TrimSpace(expectedUserID)) {
		return ErrStepUpUserMismatch
	}

	return nil
}
