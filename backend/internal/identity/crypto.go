package identity

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
	"math/big"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
)

var (
	ErrInvalidHashFormat  = errors.New("invalid argon2id hash format")
	ErrIncompatibleArgon2 = errors.New("incompatible argon2 version or algorithm")
	ErrTokenExpired       = errors.New("token has expired")
	ErrInvalidSignature   = errors.New("invalid token signature")
	ErrInvalidTokenFormat = errors.New("invalid token format")
)

type ArgonParams struct {
	Memory      uint32
	Iterations  uint32
	Parallelism uint8
	SaltLength  uint32
	KeyLength   uint32
}

var DefaultArgonParams = ArgonParams{
	Memory:      64 * 1024, // 64 MB
	Iterations:  3,
	Parallelism: 2,
	SaltLength:  16,
	KeyLength:   32,
}

var FastTestArgonParams = ArgonParams{
	Memory:      8 * 1024, // 8 MB for quick test suites
	Iterations:  1,
	Parallelism: 1,
	SaltLength:  16,
	KeyLength:   32,
}

func HashPasswordWithParams(password string, params ArgonParams) (string, error) {
	salt := make([]byte, params.SaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("failed to generate cryptographic salt: %w", err)
	}

	hash := argon2.IDKey([]byte(password), salt, params.Iterations, params.Memory, params.Parallelism, params.KeyLength)

	b64Salt := base64.RawStdEncoding.EncodeToString(salt)
	b64Hash := base64.RawStdEncoding.EncodeToString(hash)

	encoded := fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, params.Memory, params.Iterations, params.Parallelism, b64Salt, b64Hash)

	return encoded, nil
}

func HashPassword(password string) (string, error) {
	return HashPasswordWithParams(password, DefaultArgonParams)
}

func VerifyPassword(password, encodedHash string) (bool, error) {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 {
		return false, ErrInvalidHashFormat
	}
	if parts[1] != "argon2id" {
		return false, ErrIncompatibleArgon2
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, ErrIncompatibleArgon2
	}

	params := ArgonParams{}
	var memory, iterations, parallelism uint32
	for _, param := range strings.Split(parts[3], ",") {
		kv := strings.Split(param, "=")
		if len(kv) != 2 {
			return false, ErrInvalidHashFormat
		}
		val, err := strconv.ParseUint(kv[1], 10, 32)
		if err != nil {
			return false, ErrInvalidHashFormat
		}
		switch kv[0] {
		case "m":
			memory = uint32(val)
		case "t":
			iterations = uint32(val)
		case "p":
			parallelism = uint32(val)
		}
	}
	params.Memory = memory
	params.Iterations = iterations
	params.Parallelism = uint8(parallelism)

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, ErrInvalidHashFormat
	}

	expectedHash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, ErrInvalidHashFormat
	}
	params.KeyLength = uint32(len(expectedHash))

	computedHash := argon2.IDKey([]byte(password), salt, params.Iterations, params.Memory, params.Parallelism, params.KeyLength)

	if subtle.ConstantTimeCompare(expectedHash, computedHash) == 1 {
		return true, nil
	}
	return false, nil
}

type TokenClaims struct {
	Subject   string   `json:"sub"`
	Email     string   `json:"email"`
	Role      UserRole `json:"role"`
	IssuedAt  int64    `json:"iat"`
	ExpiresAt int64    `json:"exp"`
}

func GenerateAccessToken(secret string, user *User, ttl time.Duration) (string, error) {
	if len(secret) < 32 {
		return "", errors.New("JWT secret must be at least 32 characters")
	}

	headerJSON := `{"alg":"HS256","typ":"JWT"}`
	headerB64 := base64.RawURLEncoding.EncodeToString([]byte(headerJSON))

	now := time.Now().UTC()
	claims := TokenClaims{
		Subject:   user.ID,
		Email:     user.Email,
		Role:      user.Role,
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(ttl).Unix(),
	}

	claimsJSON, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("failed to marshal token claims: %w", err)
	}
	claimsB64 := base64.RawURLEncoding.EncodeToString(claimsJSON)

	payloadToSign := headerB64 + "." + claimsB64
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payloadToSign))
	sigB64 := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return payloadToSign + "." + sigB64, nil
}

func ParseAndVerifyAccessToken(secret, tokenStr string) (*TokenClaims, error) {
	if len(secret) < 32 {
		return nil, errors.New("JWT secret must be at least 32 characters")
	}

	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return nil, ErrInvalidTokenFormat
	}

	payloadToVerify := parts[0] + "." + parts[1]
	providedSig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, ErrInvalidTokenFormat
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payloadToVerify))
	expectedSig := mac.Sum(nil)

	if subtle.ConstantTimeCompare(providedSig, expectedSig) != 1 {
		return nil, ErrInvalidSignature
	}

	claimsJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, ErrInvalidTokenFormat
	}

	var claims TokenClaims
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		return nil, ErrInvalidTokenFormat
	}

	if time.Now().UTC().Unix() > claims.ExpiresAt {
		return nil, ErrTokenExpired
	}

	return &claims, nil
}

func GenerateRefreshToken() (plain string, hash []byte, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, fmt.Errorf("failed to generate random token: %w", err)
	}
	plain = hex.EncodeToString(b)
	sum := sha256.Sum256([]byte(plain))
	return plain, sum[:], nil
}

func HashRefreshToken(plain string) []byte {
	sum := sha256.Sum256([]byte(plain))
	return sum[:]
}

func GenerateNumericOTP(digits int) (plain string, hash string, err error) {
	if digits < 4 || digits > 8 {
		digits = 6
	}
	max := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(digits)), nil)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate random OTP: %w", err)
	}
	format := fmt.Sprintf("%%0%dd", digits)
	plain = fmt.Sprintf(format, n.Int64())
	sum := sha256.Sum256([]byte(plain))
	hash = hex.EncodeToString(sum[:])
	return plain, hash, nil
}

func GenerateResetToken() (plain string, hash string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", fmt.Errorf("failed to generate reset token: %w", err)
	}
	plain = hex.EncodeToString(b)
	sum := sha256.Sum256([]byte(plain))
	hash = hex.EncodeToString(sum[:])
	return plain, hash, nil
}

func HashTokenHex(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}
