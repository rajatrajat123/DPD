package identity

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"google.golang.org/api/idtoken"
	"google.golang.org/api/option"
)

var (
	ErrOAuthEmailNotVerified     = errors.New("google email must be verified to link or create account")
	ErrInvalidOAuthToken         = errors.New("invalid or expired google token")
	ErrGoogleAuthNotConfigured   = errors.New("google sign-in is not configured on this server")
	ErrGoogleAccountLinkRequired = errors.New("an account already exists for this email; sign in with your password to link Google")
	ErrGoogleIdentityConflict    = errors.New("this google account or email is already linked to a different Aura account")
	ErrGoogleEmailMismatch       = errors.New("google account email does not match your Aura account email")
)

const (
	// googleIssuer and googleIssuerAlt are the only accepted ID token issuers.
	googleIssuer    = "https://accounts.google.com"
	googleIssuerAlt = "accounts.google.com"
	// googleClockSkew tolerates small clock drift when validating time claims.
	googleClockSkew = 2 * time.Minute
)

// GoogleClaims is the trusted subset of a verified Google ID token.
// Every field is derived from a cryptographically verified token, never from client input.
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

// GoogleTokenVerifier verifies a raw Google ID token and returns trusted claims.
type GoogleTokenVerifier interface {
	VerifyToken(ctx context.Context, idToken string) (*GoogleClaims, error)
}

// googleTokenValidator is the low level validation seam (Google certificate
// lookup, signature check, audience and expiry check). It exists so tests can
// exercise claim handling without contacting Google's certificate endpoints.
type googleTokenValidator func(ctx context.Context, idToken, audience string) (*idtoken.Payload, error)

// GoogleIDTokenVerifier validates Google ID tokens using Google's official
// OpenID Connect verification library (google.golang.org/api/idtoken), which
// verifies the RS256/ES256 signature against Google's published certificates.
type GoogleIDTokenVerifier struct {
	allowedAudiences []string
	now              func() time.Time

	mu         sync.Mutex
	validator  *idtoken.Validator
	validateFn googleTokenValidator
}

// NewGoogleIDTokenVerifier builds a verifier restricted to the configured
// OAuth client IDs. When no audience is configured the verifier fails closed
// and rejects every token instead of skipping audience validation.
func NewGoogleIDTokenVerifier(allowedAudiences []string) *GoogleIDTokenVerifier {
	return &GoogleIDTokenVerifier{
		allowedAudiences: normalizeGoogleAudiences(allowedAudiences),
		now:              func() time.Time { return time.Now().UTC() },
	}
}

// OAuthAudiencesConfigured reports whether at least one OAuth client ID is configured.
func (v *GoogleIDTokenVerifier) OAuthAudiencesConfigured() bool {
	if v == nil {
		return false
	}
	return len(v.allowedAudiences) > 0
}

func normalizeGoogleAudiences(in []string) []string {
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, raw := range in {
		aud := strings.TrimSpace(raw)
		if aud == "" || aud == "*" || seen[aud] {
			continue
		}
		seen[aud] = true
		out = append(out, aud)
	}
	return out
}

func (v *GoogleIDTokenVerifier) VerifyToken(ctx context.Context, rawIDToken string) (*GoogleClaims, error) {
	token := strings.TrimSpace(rawIDToken)
	if token == "" {
		return nil, ErrInvalidOAuthToken
	}
	if len(v.allowedAudiences) == 0 {
		// Fail closed: without configured OAuth audiences no token can be trusted.
		return nil, ErrGoogleAuthNotConfigured
	}

	var (
		payload *idtoken.Payload
		lastErr error
	)
	for _, audience := range v.allowedAudiences {
		validated, err := v.validate(ctx, token, audience)
		if err == nil {
			payload = validated
			break
		}
		lastErr = err
	}
	if payload == nil {
		if lastErr == nil {
			lastErr = errors.New("token rejected")
		}
		return nil, fmt.Errorf("%w: %v", ErrInvalidOAuthToken, lastErr)
	}

	return v.claimsFromPayload(payload)
}

func (v *GoogleIDTokenVerifier) validate(ctx context.Context, token, audience string) (*idtoken.Payload, error) {
	if v.validateFn != nil {
		return v.validateFn(ctx, token, audience)
	}

	v.mu.Lock()
	validator := v.validator
	v.mu.Unlock()

	if validator == nil {
		created, err := idtoken.NewValidator(ctx, option.WithoutAuthentication())
		if err != nil {
			return nil, fmt.Errorf("failed to initialize google id token validator: %w", err)
		}
		v.mu.Lock()
		if v.validator == nil {
			v.validator = created
		}
		validator = v.validator
		v.mu.Unlock()
	}

	return validator.Validate(ctx, token, audience)
}

// claimsFromPayload enforces the remaining OpenID Connect requirements that the
// verification library does not check on its own: trusted issuer, required
// subject, sane time claims and a verified email address.
func (v *GoogleIDTokenVerifier) claimsFromPayload(payload *idtoken.Payload) (*GoogleClaims, error) {
	if payload == nil {
		return nil, ErrInvalidOAuthToken
	}

	now := v.now()

	if payload.Issuer != googleIssuer && payload.Issuer != googleIssuerAlt {
		return nil, fmt.Errorf("%w: untrusted issuer", ErrInvalidOAuthToken)
	}
	if strings.TrimSpace(payload.Subject) == "" {
		return nil, fmt.Errorf("%w: missing subject claim", ErrInvalidOAuthToken)
	}
	if payload.Expires == 0 || now.Unix() > payload.Expires {
		return nil, fmt.Errorf("%w: token expired", ErrInvalidOAuthToken)
	}
	if payload.IssuedAt == 0 || time.Unix(payload.IssuedAt, 0).UTC().After(now.Add(googleClockSkew)) {
		return nil, fmt.Errorf("%w: invalid issued-at claim", ErrInvalidOAuthToken)
	}

	email := strings.ToLower(strings.TrimSpace(googleStringClaim(payload.Claims, "email")))
	if email == "" {
		return nil, fmt.Errorf("%w: missing email claim", ErrInvalidOAuthToken)
	}
	if !googleBoolClaim(payload.Claims, "email_verified") {
		return nil, ErrOAuthEmailNotVerified
	}

	return &GoogleClaims{
		Subject:       payload.Subject,
		Email:         email,
		EmailVerified: true,
		Name:          googleStringClaim(payload.Claims, "name"),
		GivenName:     googleStringClaim(payload.Claims, "given_name"),
		FamilyName:    googleStringClaim(payload.Claims, "family_name"),
		Picture:       googleStringClaim(payload.Claims, "picture"),
		Audience:      payload.Audience,
		Issuer:        payload.Issuer,
		ExpiresAt:     payload.Expires,
	}, nil
}

func googleStringClaim(claims map[string]interface{}, key string) string {
	if claims == nil {
		return ""
	}
	switch value := claims[key].(type) {
	case string:
		return value
	case fmt.Stringer:
		return value.String()
	default:
		return ""
	}
}

func googleBoolClaim(claims map[string]interface{}, key string) bool {
	if claims == nil {
		return false
	}
	switch value := claims[key].(type) {
	case bool:
		return value
	case string:
		return strings.EqualFold(strings.TrimSpace(value), "true")
	default:
		return false
	}
}

// GoogleAuthRequest carries the Google ID token issued by the native Google
// Sign-In SDK. Profile attributes are intentionally NOT accepted here: they are
// collected through the authenticated onboarding flow so that no server-trusted
// account data can be fabricated by the client.
type GoogleAuthRequest struct {
	IDToken string `json:"id_token"`
}

// LinkGoogleRequest links a verified Google identity to the authenticated Aura account.
type LinkGoogleRequest struct {
	IDToken string `json:"id_token"`
}
