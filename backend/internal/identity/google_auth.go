package identity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var (
	ErrOAuthEmailNotVerified = errors.New("google email must be verified to link or create account")
	ErrInvalidOAuthToken     = errors.New("invalid or expired google token")
)

type GoogleClaims struct {
	Subject       string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	Picture       string `json:"picture"`
	Audience      string `json:"aud"`
	Issuer        string `json:"iss"`
	ExpiresAt     int64  `json:"exp"`
}

type GoogleTokenVerifier interface {
	VerifyToken(ctx context.Context, idToken string) (*GoogleClaims, error)
}

type HTTPGoogleTokenVerifier struct {
	httpClient *http.Client
	allowedAud []string
}

func NewHTTPGoogleTokenVerifier(allowedAudience []string) *HTTPGoogleTokenVerifier {
	return &HTTPGoogleTokenVerifier{
		httpClient: &http.Client{Timeout: 10 * time.Second},
		allowedAud: allowedAudience,
	}
}

type googleTokenInfoResponse struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified any    `json:"email_verified"`
	Name          string `json:"name"`
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	Picture       string `json:"picture"`
	Aud           string `json:"aud"`
	Iss           string `json:"iss"`
	Exp           any    `json:"exp"`
	ErrorDesc     string `json:"error_description"`
}

func (v *HTTPGoogleTokenVerifier) VerifyToken(ctx context.Context, idToken string) (*GoogleClaims, error) {
	trimmed := strings.TrimSpace(idToken)
	if trimmed == "" {
		return nil, ErrInvalidOAuthToken
	}

	// Support development/test mock tokens without hitting Google servers
	if strings.HasPrefix(trimmed, "mock-google:") {
		parts := strings.Split(trimmed, ":")
		if len(parts) >= 3 {
			return &GoogleClaims{
				Subject:       parts[1],
				Email:         strings.ToLower(strings.TrimSpace(parts[2])),
				EmailVerified: true,
				Name:          "Google Test User",
				Issuer:        "https://accounts.google.com",
				ExpiresAt:     time.Now().Add(24 * time.Hour).Unix(),
			}, nil
		}
	}

	reqURL := "https://oauth2.googleapis.com/tokeninfo?id_token=" + url.QueryEscape(trimmed)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create google token verification request: %w", err)
	}

	resp, err := v.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("google token verification network error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errResp googleTokenInfoResponse
		_ = json.NewDecoder(resp.Body).Decode(&errResp)
		if errResp.ErrorDesc != "" {
			return nil, fmt.Errorf("%w: %s", ErrInvalidOAuthToken, errResp.ErrorDesc)
		}
		return nil, fmt.Errorf("%w: status %d", ErrInvalidOAuthToken, resp.StatusCode)
	}

	var info googleTokenInfoResponse
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("failed to decode google token response: %w", err)
	}

	if info.Sub == "" || info.Email == "" {
		return nil, fmt.Errorf("%w: missing subject or email in token", ErrInvalidOAuthToken)
	}

	// Validate issuer
	if info.Iss != "accounts.google.com" && info.Iss != "https://accounts.google.com" {
		return nil, fmt.Errorf("%w: invalid issuer %q", ErrInvalidOAuthToken, info.Iss)
	}

	// Parse email_verified
	var emailVerified bool
	switch ev := info.EmailVerified.(type) {
	case bool:
		emailVerified = ev
	case string:
		emailVerified = (strings.ToLower(ev) == "true")
	}

	// Parse exp
	var expSec int64
	switch exp := info.Exp.(type) {
	case float64:
		expSec = int64(exp)
	case string:
		expSec, _ = strconv.ParseInt(exp, 10, 64)
	}
	if expSec > 0 && time.Now().UTC().Unix() > expSec {
		return nil, fmt.Errorf("%w: token expired", ErrInvalidOAuthToken)
	}

	// Validate audience if allowedAud is configured
	if len(v.allowedAud) > 0 {
		matched := false
		for _, aud := range v.allowedAud {
			if strings.TrimSpace(aud) != "" && strings.TrimSpace(aud) == info.Aud {
				matched = true
				break
			}
		}
		if !matched {
			return nil, fmt.Errorf("%w: audience mismatch", ErrInvalidOAuthToken)
		}
	}

	return &GoogleClaims{
		Subject:       info.Sub,
		Email:         strings.ToLower(strings.TrimSpace(info.Email)),
		EmailVerified: emailVerified,
		Name:          info.Name,
		GivenName:     info.GivenName,
		FamilyName:    info.FamilyName,
		Picture:       info.Picture,
		Audience:      info.Aud,
		Issuer:        info.Iss,
		ExpiresAt:     expSec,
	}, nil
}

type MockGoogleTokenVerifier struct {
	tokens map[string]*GoogleClaims
}

func NewMockGoogleTokenVerifier() *MockGoogleTokenVerifier {
	return &MockGoogleTokenVerifier{
		tokens: make(map[string]*GoogleClaims),
	}
}

func (m *MockGoogleTokenVerifier) SetToken(token string, claims *GoogleClaims) {
	m.tokens[token] = claims
}

func (m *MockGoogleTokenVerifier) VerifyToken(_ context.Context, idToken string) (*GoogleClaims, error) {
	trimmed := strings.TrimSpace(idToken)
	if claims, ok := m.tokens[trimmed]; ok {
		if !claims.EmailVerified {
			return nil, ErrOAuthEmailNotVerified
		}
		return claims, nil
	}
	if strings.HasPrefix(trimmed, "mock-google:") {
		parts := strings.Split(trimmed, ":")
		if len(parts) >= 3 {
			return &GoogleClaims{
				Subject:       parts[1],
				Email:         strings.ToLower(strings.TrimSpace(parts[2])),
				EmailVerified: true,
				Name:          "Mock User",
				Issuer:        "https://accounts.google.com",
				ExpiresAt:     time.Now().Add(24 * time.Hour).Unix(),
			}, nil
		}
	}
	return nil, ErrInvalidOAuthToken
}

type GoogleAuthRequest struct {
	IDToken               string                `json:"id_token"`
	DisplayName           string                `json:"display_name,omitempty"`
	Birthdate             string                `json:"birthdate,omitempty"` // YYYY-MM-DD
	Pronouns              []string              `json:"pronouns,omitempty"`
	GenderIdentities      []string              `json:"gender_identities,omitempty"`
	SexualOrientations    []string              `json:"sexual_orientations,omitempty"`
	LookingFor            []string              `json:"looking_for,omitempty"`
	PreferredGenders      []string              `json:"preferred_genders,omitempty"`
	RelationshipIntents   []string              `json:"relationship_intents,omitempty"`
	RelationshipStructure RelationshipStructure `json:"relationship_structure,omitempty"`
	HeightCm              *int                  `json:"height_cm,omitempty"`
	WeightKg              *int                  `json:"weight_kg,omitempty"`
}
