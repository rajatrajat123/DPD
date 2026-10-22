package identity

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/auradating/platform/backend/internal/events"
)

var (
	ErrInvalidCredentials             = errors.New("invalid email/phone or password")
	ErrAccountNotActive               = errors.New("account is suspended, banned, or deactivated")
	ErrSessionExpired                 = errors.New("session has expired")
	ErrSessionRevoked                 = errors.New("session has been revoked")
	ErrVerificationExpired            = errors.New("verification code has expired")
	ErrVerificationMaxAttempts        = errors.New("maximum verification attempts exceeded")
	ErrInvalidVerificationCode        = errors.New("invalid verification code")
	ErrPasswordResetExpired           = errors.New("password reset link has expired or was already used")
	ErrResetRateLimited               = errors.New("rate limit exceeded: please wait before requesting another reset email")
	ErrPasswordTooShort               = errors.New("password must be at least 8 characters long")
	ErrPasswordTooLong                = errors.New("password cannot exceed 128 characters")
	ErrPasswordMissingDigit           = errors.New("password must contain at least one numeric digit (0-9)")
	ErrPasswordMissingSpecial         = errors.New("password must contain at least one special character (such as !, @, #, $, or _)")
	ErrTransactionalEmailUnconfigured = errors.New("transactional email provider unconfigured: delivery blocked in production/staging")
	ErrOnboardingRequired             = errors.New("profile onboarding is required before this account can be used")
	ErrBirthdateImmutable             = errors.New("birthdate cannot be changed once the profile exists")
	ErrDeleteConfirmationRequired     = errors.New("explicit confirmation is required to delete account")
	ErrAccountAlreadyDeleted          = errors.New("account is already deleted")
)

// ValidatePasswordPolicy verifies that a password satisfies Aura's security policy:
// - Minimum 8 characters, maximum 128 characters
// - At least one numeric digit (0–9)
// - At least one special character (such as !, @, #, $, or _)
func ValidatePasswordPolicy(password string) error {
	if len(password) < 8 {
		return ErrPasswordTooShort
	}
	if len(password) > 128 {
		return ErrPasswordTooLong
	}
	hasDigit := false
	hasSpecial := false
	for _, r := range password {
		if unicode.IsDigit(r) {
			hasDigit = true
		} else if unicode.IsPunct(r) || unicode.IsSymbol(r) || r == '_' {
			hasSpecial = true
		}
	}
	if !hasDigit {
		return ErrPasswordMissingDigit
	}
	if !hasSpecial {
		return ErrPasswordMissingSpecial
	}
	return nil
}

type ClientInfo struct {
	DeviceFingerprint string
	UserAgent         string
	IPAddress         string
}

type RegisterRequest struct {
	Email                 string                `json:"email"`
	PhoneE164             *string               `json:"phone_e164,omitempty"`
	Password              string                `json:"password"`
	DisplayName           string                `json:"display_name"`
	Birthdate             string                `json:"birthdate"` // YYYY-MM-DD
	GenderIdentities      []string              `json:"gender_identities"`
	SexualOrientations    []string              `json:"sexual_orientations"`
	LookingFor            []string              `json:"looking_for,omitempty"`
	PreferredGenders      []string              `json:"preferred_genders,omitempty"`
	Pronouns              []string              `json:"pronouns,omitempty"`
	RelationshipIntents   []string              `json:"relationship_intents,omitempty"`
	RelationshipStructure RelationshipStructure `json:"relationship_structure,omitempty"`
	HeightCm              *int                  `json:"height_cm,omitempty"`
	WeightKg              *int                  `json:"weight_kg,omitempty"`
	ReferralCode          string                `json:"referral_code,omitempty"`
	ClickToken            string                `json:"click_token,omitempty"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type AuthResponse struct {
	AccessToken  string   `json:"access_token"`
	RefreshToken string   `json:"refresh_token"`
	TokenType    string   `json:"token_type"`
	ExpiresIn    int64    `json:"expires_in"` // seconds
	User         User     `json:"user"`
	Profile      *Profile `json:"profile,omitempty"`
	// OnboardingRequired signals that the account exists but has no profile yet
	// (for example an account created through Google Sign-In). Clients must send
	// the user through the profile onboarding flow before using the app.
	OnboardingRequired bool `json:"onboarding_required,omitempty"`
}

type UpdateProfileRequest struct {
	// Birthdate is only accepted when creating the profile for the first time
	// (onboarding). Once a profile exists the birthdate is immutable.
	Birthdate             *string                `json:"birthdate,omitempty"`
	DisplayName           *string                `json:"display_name,omitempty"`
	Bio                   *string                `json:"bio,omitempty"`
	Pronouns              []string               `json:"pronouns,omitempty"`
	GenderIdentities      []string               `json:"gender_identities,omitempty"`
	SexualOrientations    []string               `json:"sexual_orientations,omitempty"`
	LookingFor            []string               `json:"looking_for,omitempty"`
	PreferredGenders      []string               `json:"preferred_genders,omitempty"`
	RelationshipIntents   []string               `json:"relationship_intents,omitempty"`
	RelationshipStructure *RelationshipStructure `json:"relationship_structure,omitempty"`
	VisibilitySettings    *VisibilitySettings    `json:"visibility_settings,omitempty"`
	DiscreteModeEnabled   *bool                  `json:"discrete_mode_enabled,omitempty"`
	IncognitoEnabled      *bool                  `json:"incognito_enabled,omitempty"`
	SmokingHabit          *SmokingHabit          `json:"smoking_habit,omitempty"`
	SmokingPreference     *SmokingHabit          `json:"smoking_preference,omitempty"`
	NonSmokerDealbreaker  *bool                  `json:"non_smoker_dealbreaker,omitempty"`
	DrinkingHabit         *DrinkingHabit         `json:"drinking_habit,omitempty"`
	HeightCm              *int                   `json:"height_cm,omitempty"`
	WeightKg              *int                   `json:"weight_kg,omitempty"`
	Languages             []string               `json:"languages,omitempty"`
	Interests             []string               `json:"interests,omitempty"`
}

type UpdateLocationRequest struct {
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	CityName    string  `json:"city_name"`
	CountryCode string  `json:"country_code"`
}

type UpdatePreferencesRequest struct {
	MinAge                  *int                     `json:"min_age,omitempty"`
	MaxAge                  *int                     `json:"max_age,omitempty"`
	MaxDistanceKm           *int                     `json:"max_distance_km,omitempty"`
	PreferredGenders        []string                 `json:"preferred_genders,omitempty"`
	PreferredIntents        []string                 `json:"preferred_intents,omitempty"`
	PreferredOrientations   []string                 `json:"preferred_orientations,omitempty"`
	PreferredLanguages      []string                 `json:"preferred_languages,omitempty"`
	PreferredInterests      []string                 `json:"preferred_interests,omitempty"`
	VerifiedProfilesOnly    *bool                    `json:"verified_profiles_only,omitempty"`
	VerifiedOnly            *bool                    `json:"verified_only,omitempty"`
	DealbreakerNonSmoker    *bool                    `json:"dealbreaker_non_smoker,omitempty"`
	MinHeightCm             *int                     `json:"min_height_cm,omitempty"`
	MaxHeightCm             *int                     `json:"max_height_cm,omitempty"`
	MinWeightKg             *int                     `json:"min_weight_kg,omitempty"`
	MaxWeightKg             *int                     `json:"max_weight_kg,omitempty"`
	Dealbreakers            *LifestyleDealbreakers   `json:"dealbreakers,omitempty"`
	NotificationPreferences *NotificationPreferences `json:"notification_preferences,omitempty"`
}

type FullProfileResponse struct {
	User    User     `json:"user"`
	Profile *Profile `json:"profile"`
	// OnboardingRequired is true when this account has no profile yet.
	OnboardingRequired bool               `json:"onboarding_required,omitempty"`
	Location           *ProfileLocation   `json:"location,omitempty"`
	Preferences        *DatingPreferences `json:"preferences,omitempty"`
	IsComplete         bool               `json:"is_complete"`
}

type Service struct {
	repo             Repository
	jwtSecret        string
	accessTTL        time.Duration
	refreshTTL       time.Duration
	argonParams      ArgonParams
	outboxPub        events.Publisher
	loginTracker     LoginAttemptTracker
	notificationSink NotificationDeliverySink
	resetLimiter     *ResetRateLimiter
	logger           *slog.Logger
	googleVerifier   GoogleTokenVerifier
	attributor       RegistrationAttributor
}

// RegistrationAttributor validates partner referral codes and records post-registration attribution.
type RegistrationAttributor interface {
	ValidatePartnerCode(ctx context.Context, partnerCode string) error
	AttributeRegistration(ctx context.Context, referredUserID, partnerCode, clickToken string) error
}

// ResetRateLimiter enforces resend throttling per email and rate limits per IP
// to defend against brute force, email flooding, and user enumeration.
type ResetRateLimiter struct {
	mu           sync.Mutex
	emailHistory map[string][]time.Time
	ipHistory    map[string][]time.Time
	cooldown     time.Duration
	maxPerHour   int
	ipMaxPerMin  int
}

func NewResetRateLimiter(cooldown time.Duration, maxPerHour, ipMaxPerMin int) *ResetRateLimiter {
	return &ResetRateLimiter{
		emailHistory: make(map[string][]time.Time),
		ipHistory:    make(map[string][]time.Time),
		cooldown:     cooldown,
		maxPerHour:   maxPerHour,
		ipMaxPerMin:  ipMaxPerMin,
	}
}

func (r *ResetRateLimiter) Allow(email, ip string) bool {
	if r == nil {
		return true
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()

	// 1. IP rate limit check (if IP is provided)
	if ip != "" {
		ipTimes := r.ipHistory[ip]
		cutoff := now.Add(-1 * time.Minute)
		validIP := make([]time.Time, 0, len(ipTimes))
		for _, t := range ipTimes {
			if t.After(cutoff) {
				validIP = append(validIP, t)
			}
		}
		if len(validIP) >= r.ipMaxPerMin {
			r.ipHistory[ip] = validIP
			return false
		}
		r.ipHistory[ip] = append(validIP, now)
	}

	// 2. Email resend throttling & hourly rate limit check
	if email != "" {
		times := r.emailHistory[email]
		cutoffHour := now.Add(-1 * time.Hour)
		validEmail := make([]time.Time, 0, len(times))
		for _, t := range times {
			if t.After(cutoffHour) {
				validEmail = append(validEmail, t)
			}
		}

		// Cooldown check (most recent request must be at least cooldown ago)
		if len(validEmail) > 0 {
			last := validEmail[len(validEmail)-1]
			if now.Sub(last) < r.cooldown {
				r.emailHistory[email] = validEmail
				return false
			}
		}

		if len(validEmail) >= r.maxPerHour {
			r.emailHistory[email] = validEmail
			return false
		}

		r.emailHistory[email] = append(validEmail, now)
	}

	return true
}

// NotificationDeliverySink delivers out-of-band secrets such as verification OTPs and reset tokens.
type NotificationDeliverySink interface {
	DeliverVerificationOTP(ctx context.Context, target, channel, otp string) error
	DeliverPasswordReset(ctx context.Context, email, resetToken string) error
}

// EnvironmentNotificationSink delivers notifications, failing closed in staging/production
// when no transactional provider is configured, and logging sanitized metadata in development.
type EnvironmentNotificationSink struct {
	env    string
	logger *slog.Logger
}

func NewEnvironmentNotificationSink(env string, logger *slog.Logger) *EnvironmentNotificationSink {
	return &EnvironmentNotificationSink{
		env:    strings.ToLower(strings.TrimSpace(env)),
		logger: logger,
	}
}

func (s *EnvironmentNotificationSink) DeliverVerificationOTP(ctx context.Context, target, channel, otp string) error {
	if s.env == "production" || s.env == "staging" {
		if s.logger != nil {
			s.logger.Error("out_of_band_notification_blocked_unconfigured",
				slog.String("env", s.env),
				slog.String("channel", channel),
				slog.String("target_masked", maskRecipient(target)),
			)
		}
		return ErrTransactionalEmailUnconfigured
	}

	if s.logger != nil {
		s.logger.Info("dev_notification_sink_delivered_verification_otp",
			slog.String("env", s.env),
			slog.String("channel", channel),
			slog.String("target_masked", maskRecipient(target)),
			slog.Int("otp_length", len(otp)),
		)
	}
	return nil
}

func (s *EnvironmentNotificationSink) DeliverPasswordReset(ctx context.Context, email, resetToken string) error {
	if s.env == "production" || s.env == "staging" {
		if s.logger != nil {
			s.logger.Error("out_of_band_notification_blocked_unconfigured",
				slog.String("env", s.env),
				slog.String("channel", "EMAIL"),
				slog.String("target_masked", maskRecipient(email)),
			)
		}
		return ErrTransactionalEmailUnconfigured
	}

	if s.logger != nil {
		s.logger.Info("dev_notification_sink_delivered_password_reset",
			slog.String("env", s.env),
			slog.String("target_masked", maskRecipient(email)),
			slog.Int("token_length", len(resetToken)),
		)
	}
	return nil
}

func maskRecipient(s string) string {
	if strings.Contains(s, "@") {
		parts := strings.SplitN(s, "@", 2)
		name := parts[0]
		domain := parts[1]
		if len(name) <= 2 {
			return "*@" + domain
		}
		return string(name[0]) + "***" + string(name[len(name)-1]) + "@" + domain
	}
	if len(s) > 4 {
		return s[:2] + "****" + s[len(s)-2:]
	}
	return "****"
}

type LoginAttemptTracker interface {
	CheckLoginAllowed(ctx context.Context, email, ipAddress string) error
	RecordFailedLogin(ctx context.Context, email, ipAddress string) (int, *time.Time, error)
	RecordSuccessfulLogin(ctx context.Context, email, ipAddress string) error
}

type ServiceOption func(*Service)

func WithFastCrypto() ServiceOption {
	return func(s *Service) {
		s.argonParams = FastTestArgonParams
	}
}

func WithPublisher(pub events.Publisher) ServiceOption {
	return func(s *Service) {
		s.outboxPub = pub
	}
}

func WithLoginTracker(tracker LoginAttemptTracker) ServiceOption {
	return func(s *Service) {
		s.loginTracker = tracker
	}
}

func WithNotificationSink(sink NotificationDeliverySink) ServiceOption {
	return func(s *Service) {
		s.notificationSink = sink
	}
}

func WithResetRateLimiter(limiter *ResetRateLimiter) ServiceOption {
	return func(s *Service) {
		s.resetLimiter = limiter
	}
}

func WithLogger(logger *slog.Logger) ServiceOption {
	return func(s *Service) {
		s.logger = logger
	}
}

func (s *Service) SetResetRateLimiter(limiter *ResetRateLimiter) {
	s.resetLimiter = limiter
}

func (s *Service) SetNotificationSink(sink NotificationDeliverySink) {
	s.notificationSink = sink
}

func WithGoogleTokenVerifier(verifier GoogleTokenVerifier) ServiceOption {
	return func(s *Service) {
		s.googleVerifier = verifier
	}
}

func (s *Service) SetGoogleTokenVerifier(verifier GoogleTokenVerifier) {
	s.googleVerifier = verifier
}

func WithRegistrationAttributor(attributor RegistrationAttributor) ServiceOption {
	return func(s *Service) {
		s.attributor = attributor
	}
}

func (s *Service) SetRegistrationAttributor(attributor RegistrationAttributor) {
	s.attributor = attributor
}

func NewService(repo Repository, jwtSecret string, opts ...ServiceOption) *Service {
	s := &Service{
		repo:         repo,
		jwtSecret:    jwtSecret,
		accessTTL:    15 * time.Minute,
		refreshTTL:   30 * 24 * time.Hour,
		argonParams:  DefaultArgonParams,
		resetLimiter: NewResetRateLimiter(60*time.Second, 5, 10),
	}
	for _, opt := range opts {
		opt(s)
	}
	if s.googleVerifier == nil {
		// Fail closed: with no configured OAuth client IDs every Google token is
		// rejected instead of being accepted without audience validation.
		s.googleVerifier = NewGoogleIDTokenVerifier(nil)
	}
	return s
}

func (s *Service) Register(ctx context.Context, req RegisterRequest, clientInfo ClientInfo) (*AuthResponse, error) {
	partnerCode := strings.ToUpper(strings.TrimSpace(req.ReferralCode))
	if partnerCode != "" && s.attributor != nil {
		if err := s.attributor.ValidatePartnerCode(ctx, partnerCode); err != nil {
			return nil, err
		}
	}

	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" || !strings.Contains(req.Email, "@") {
		return nil, fmt.Errorf("a valid email address is required")
	}
	if err := ValidatePasswordPolicy(req.Password); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.DisplayName) == "" {
		return nil, fmt.Errorf("display name cannot be blank")
	}

	birthdate, err := time.Parse("2006-01-02", strings.TrimSpace(req.Birthdate))
	if err != nil {
		return nil, fmt.Errorf("birthdate must be formatted YYYY-MM-DD")
	}
	if err := ValidateAge(birthdate, time.Now().UTC()); err != nil {
		return nil, err
	}

	if len(req.GenderIdentities) == 0 {
		return nil, fmt.Errorf("at least one gender identity must be selected")
	}
	if len(req.SexualOrientations) == 0 {
		return nil, fmt.Errorf("at least one sexual orientation must be selected")
	}
	if err := ValidateTaxonomy(req.GenderIdentities, req.SexualOrientations, req.Pronouns, req.RelationshipIntents); err != nil {
		return nil, err
	}

	if req.HeightCm != nil {
		if *req.HeightCm < 90 || *req.HeightCm > 250 {
			return nil, fmt.Errorf("height must be between 90 cm and 250 cm")
		}
	}
	if req.WeightKg != nil {
		if *req.WeightKg < 30 || *req.WeightKg > 300 {
			return nil, fmt.Errorf("weight must be between 30 kg and 300 kg")
		}
	}

	pwHash, err := HashPasswordWithParams(req.Password, s.argonParams)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	userID := generateUUIDv4()
	now := time.Now().UTC()

	user := &User{
		ID:           userID,
		Email:        req.Email,
		PhoneE164:    req.PhoneE164,
		PasswordHash: pwHash,
		Status:       StatusActive,
		Role:         RoleMember,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	if err := s.repo.CreateUser(ctx, user); err != nil {
		return nil, err
	}

	profile := &Profile{
		UserID:                userID,
		DisplayName:           strings.TrimSpace(req.DisplayName),
		Birthdate:             birthdate,
		Bio:                   "",
		Pronouns:              req.Pronouns,
		GenderIdentities:      req.GenderIdentities,
		SexualOrientations:    req.SexualOrientations,
		RelationshipIntents:   req.RelationshipIntents,
		RelationshipStructure: req.RelationshipStructure,
		HeightCm:              req.HeightCm,
		WeightKg:              req.WeightKg,
		VisibilitySettings:    DefaultVisibilitySettings(),
		CreatedAt:             now,
		UpdatedAt:             now,
	}
	if err := s.repo.UpsertProfile(ctx, profile); err != nil {
		return nil, fmt.Errorf("failed to save initial profile: %w", err)
	}

	pref := DefaultDatingPreferences(userID)
	if len(req.PreferredGenders) > 0 {
		pref.PreferredGenders = req.PreferredGenders
	} else if len(req.LookingFor) > 0 {
		pref.PreferredGenders = req.LookingFor
	}
	if len(pref.PreferredGenders) > 0 {
		if err := ValidateTaxonomy(pref.PreferredGenders, nil, nil, nil); err != nil {
			return nil, fmt.Errorf("invalid preferred gender: %w", err)
		}
	}
	if err := s.repo.UpsertPreferences(ctx, &pref); err != nil {
		return nil, fmt.Errorf("failed to save initial preferences: %w", err)
	}

	// Create initial verification OTP
	_, otpHash, err := GenerateNumericOTP(6)
	if err == nil {
		_ = s.repo.CreateVerification(ctx, &AccountVerification{
			ID:          generateUUIDv4(),
			UserID:      userID,
			Channel:     "EMAIL",
			Target:      req.Email,
			CodeHash:    otpHash,
			MaxAttempts: 5,
			ExpiresAt:   now.Add(24 * time.Hour),
			CreatedAt:   now,
		})
	}

	// Emit transactional outbox event
	if s.outboxPub != nil {
		env, err := events.NewEnvelope("user", userID, "user.registered.v1", "", 1, map[string]any{
			"user_id":       userID,
			"email":         req.Email,
			"display_name":  req.DisplayName,
			"registered_at": now.Format(time.RFC3339),
		})
		if err == nil {
			_ = s.outboxPub.Publish(ctx, env)
		}
	}

	// Attribute registration if referral code or click token is present
	clickToken := strings.TrimSpace(req.ClickToken)
	if (partnerCode != "" || clickToken != "") && s.attributor != nil {
		if err := s.attributor.AttributeRegistration(ctx, userID, partnerCode, clickToken); err != nil {
			if s.logger != nil {
				s.logger.Warn("registration_attribution_failed",
					slog.String("user_id", userID),
					slog.String("partner_code", partnerCode),
					slog.String("error", err.Error()),
				)
			}
		}
	}

	return s.issueAuthSession(ctx, user, profile, clientInfo)
}

func (s *Service) Login(ctx context.Context, req LoginRequest, clientInfo ClientInfo) (*AuthResponse, error) {
	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" || req.Password == "" {
		return nil, ErrInvalidCredentials
	}

	if s.loginTracker != nil {
		if err := s.loginTracker.CheckLoginAllowed(ctx, req.Email, clientInfo.IPAddress); err != nil {
			return nil, err
		}
	}

	user, err := s.repo.GetUserByEmail(ctx, req.Email)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			if s.loginTracker != nil {
				_, _, _ = s.loginTracker.RecordFailedLogin(ctx, req.Email, clientInfo.IPAddress)
			}
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}

	if user.Status != StatusActive {
		return nil, ErrAccountNotActive
	}

	valid, err := VerifyPassword(req.Password, user.PasswordHash)
	if err != nil || !valid {
		if s.loginTracker != nil {
			_, _, _ = s.loginTracker.RecordFailedLogin(ctx, req.Email, clientInfo.IPAddress)
		}
		return nil, ErrInvalidCredentials
	}

	if s.loginTracker != nil {
		_ = s.loginTracker.RecordSuccessfulLogin(ctx, req.Email, clientInfo.IPAddress)
	}

	now := time.Now().UTC()
	user.LastActiveAt = &now
	_ = s.repo.UpdateUser(ctx, user)

	profile, _ := s.repo.GetProfile(ctx, user.ID)
	return s.issueAuthSession(ctx, user, profile, clientInfo)
}

// AuthenticateWithGoogle verifies a Google ID token and issues an Aura session.
//
// The only trusted inputs are the cryptographically verified claims from Google.
// Nothing about the identity (email, subject, verification state) is ever taken
// from the mobile client, and no profile data is invented for new accounts:
// a newly created account has no profile and must complete onboarding.
func (s *Service) AuthenticateWithGoogle(ctx context.Context, req GoogleAuthRequest, clientInfo ClientInfo) (*AuthResponse, error) {
	claims, err := s.googleVerifier.VerifyToken(ctx, req.IDToken)
	if err != nil {
		return nil, err
	}
	if claims == nil {
		return nil, ErrInvalidOAuthToken
	}
	if !claims.EmailVerified {
		return nil, ErrOAuthEmailNotVerified
	}

	subject := strings.TrimSpace(claims.Subject)
	normEmail := strings.ToLower(strings.TrimSpace(claims.Email))
	if subject == "" || normEmail == "" {
		return nil, ErrInvalidOAuthToken
	}

	now := time.Now().UTC()

	// 1. This Google identity is already linked to an Aura account.
	existingIdent, err := s.repo.GetOAuthIdentity(ctx, "google", subject)
	if err != nil && !errors.Is(err, ErrOAuthIdentityNotFound) {
		return nil, err
	}
	if existingIdent != nil {
		user, err := s.repo.GetUserByID(ctx, existingIdent.UserID)
		if err != nil {
			return nil, fmt.Errorf("linked user not found: %w", err)
		}
		if user.Status != StatusActive {
			return nil, ErrAccountNotActive
		}

		_ = s.repo.UpdateOAuthIdentityLastLogin(ctx, existingIdent.ID)
		user.LastActiveAt = &now
		_ = s.repo.UpdateUser(ctx, user)

		profile, profileErr := s.repo.GetProfile(ctx, user.ID)
		if profileErr != nil {
			profile = nil
		}
		return s.issueAuthSession(ctx, user, profile, clientInfo)
	}

	// 2. An Aura account already exists for this email address.
	if existingUser, err := s.repo.GetUserByEmail(ctx, normEmail); err == nil && existingUser != nil {
		if existingUser.Status != StatusActive {
			return nil, ErrAccountNotActive
		}
		if linkedIdent, linkErr := s.repo.GetOAuthIdentityByEmail(ctx, "google", normEmail); linkErr == nil && linkedIdent != nil && linkedIdent.ProviderSubject != subject {
			return nil, ErrGoogleIdentityConflict
		}

		// Security rule: allow automatic linking only when Google is authoritative
		// for this exact email address (e.g. matching @gmail.com, @googlemail.com, or
		// a verified Google Workspace hosted domain). For non-authoritative domains,
		// retain the requirement that the owner prove ownership via password sign-in first.
		if !IsGoogleAuthoritativeForEmail(normEmail, claims.HostedDomain) {
			return nil, ErrGoogleAccountLinkRequired
		}

		// Google is authoritative for this verified email address. Link this Google
		// identity to the existing Aura account without modifying the user's ID, password
		// hash, profile, matches, messages, or subscription entitlements.
		ident := &OAuthIdentity{
			ID:              generateUUIDv4(),
			UserID:          existingUser.ID,
			Provider:        "google",
			ProviderSubject: subject,
			Email:           normEmail,
			EmailVerified:   true,
			LinkedAt:        now,
			LastLoginAt:     now,
		}
		if err := s.repo.CreateOAuthIdentity(ctx, ident); err != nil {
			// Handle race condition: check if a concurrent request already linked this identity
			if checkIdent, checkErr := s.repo.GetOAuthIdentity(ctx, "google", subject); checkErr == nil && checkIdent != nil && checkIdent.UserID == existingUser.ID {
				_ = s.repo.UpdateOAuthIdentityLastLogin(ctx, checkIdent.ID)
			} else {
				return nil, fmt.Errorf("failed to link Google identity: %w", err)
			}
		}

		if existingUser.EmailVerifiedAt == nil {
			existingUser.EmailVerifiedAt = &now
		}
		existingUser.LastActiveAt = &now
		_ = s.repo.UpdateUser(ctx, existingUser)

		profile, profileErr := s.repo.GetProfile(ctx, existingUser.ID)
		if profileErr != nil {
			profile = nil
		}
		return s.issueAuthSession(ctx, existingUser, profile, clientInfo)
	} else if err != nil && !errors.Is(err, ErrUserNotFound) {
		return nil, err
	}

	// 3. Brand new account created from verified Google claims only.
	user := &User{
		ID:              generateUUIDv4(),
		Email:           normEmail,
		PasswordHash:    "",
		Status:          StatusActive,
		Role:            RoleMember,
		EmailVerifiedAt: &now, // Google has verified ownership of this mailbox
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := s.repo.CreateUser(ctx, user); err != nil {
		return nil, fmt.Errorf("failed to create user account: %w", err)
	}

	ident := &OAuthIdentity{
		ID:              generateUUIDv4(),
		UserID:          user.ID,
		Provider:        "google",
		ProviderSubject: subject,
		Email:           normEmail,
		EmailVerified:   true,
		LinkedAt:        now,
		LastLoginAt:     now,
	}
	if err := s.repo.CreateOAuthIdentity(ctx, ident); err != nil {
		return nil, fmt.Errorf("failed to persist Google identity: %w", err)
	}

	// Attribute brand new Google signup if referral code or click token is present
	googlePartnerCode := strings.ToUpper(strings.TrimSpace(req.ReferralCode))
	googleClickToken := strings.TrimSpace(req.ClickToken)
	if (googlePartnerCode != "" || googleClickToken != "") && s.attributor != nil {
		if err := s.attributor.AttributeRegistration(ctx, user.ID, googlePartnerCode, googleClickToken); err != nil {
			if s.logger != nil {
				s.logger.Warn("google_registration_attribution_failed",
					slog.String("user_id", user.ID),
					slog.String("partner_code", googlePartnerCode),
					slog.String("error", err.Error()),
				)
			}
		}
	}

	// No profile is created here. Birthdate, display name, gender identities and
	// orientations are collected through the onboarding flow (UpdateMyProfile).
	resp, err := s.issueAuthSession(ctx, user, nil, clientInfo)
	if err != nil {
		return nil, err
	}
	resp.OnboardingRequired = true
	return resp, nil
}

// LinkGoogleIdentity links a verified Google identity to the currently
// authenticated Aura account. The authenticated session is the proof of
// ownership that authorises the link.
func (s *Service) LinkGoogleIdentity(ctx context.Context, userID string, req LinkGoogleRequest) error {
	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if user.Status != StatusActive {
		return ErrAccountNotActive
	}

	claims, err := s.googleVerifier.VerifyToken(ctx, req.IDToken)
	if err != nil {
		return err
	}
	if claims == nil || !claims.EmailVerified {
		return ErrOAuthEmailNotVerified
	}

	subject := strings.TrimSpace(claims.Subject)
	normEmail := strings.ToLower(strings.TrimSpace(claims.Email))
	if subject == "" || normEmail == "" {
		return ErrInvalidOAuthToken
	}
	if !strings.EqualFold(strings.TrimSpace(user.Email), normEmail) {
		return ErrGoogleEmailMismatch
	}

	if ident, err := s.repo.GetOAuthIdentity(ctx, "google", subject); err == nil && ident != nil {
		if ident.UserID == user.ID {
			return nil // already linked to this account
		}
		return ErrGoogleIdentityConflict
	} else if err != nil && !errors.Is(err, ErrOAuthIdentityNotFound) {
		return err
	}

	if ident, err := s.repo.GetOAuthIdentityByEmail(ctx, "google", normEmail); err == nil && ident != nil {
		if ident.UserID == user.ID {
			return nil
		}
		return ErrGoogleIdentityConflict
	} else if err != nil && !errors.Is(err, ErrOAuthIdentityNotFound) {
		return err
	}

	now := time.Now().UTC()
	return s.repo.CreateOAuthIdentity(ctx, &OAuthIdentity{
		ID:              generateUUIDv4(),
		UserID:          user.ID,
		Provider:        "google",
		ProviderSubject: subject,
		Email:           normEmail,
		EmailVerified:   true,
		LinkedAt:        now,
		LastLoginAt:     now,
	})
}

func (s *Service) RefreshToken(ctx context.Context, refreshToken string, clientInfo ClientInfo) (*AuthResponse, error) {
	tokenHash := HashRefreshToken(strings.TrimSpace(refreshToken))

	session, err := s.repo.GetSessionByTokenHash(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, ErrSessionNotFound) {
			return nil, ErrSessionRevoked
		}
		return nil, err
	}

	// Token Reuse Detection
	if session.RevokedAt != nil {
		_ = s.repo.RevokeSessionFamily(ctx, session.FamilyID)
		return nil, ErrSessionRevoked
	}

	if time.Now().UTC().After(session.ExpiresAt) {
		return nil, ErrSessionExpired
	}

	_ = s.repo.RevokeSession(ctx, session.ID)

	user, err := s.repo.GetUserByID(ctx, session.UserID)
	if err != nil {
		return nil, err
	}
	if user.Status != StatusActive {
		return nil, ErrAccountNotActive
	}

	newPlainRefresh, newHash, err := GenerateRefreshToken()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	newSession := &UserSession{
		ID:                generateUUIDv4(),
		UserID:            user.ID,
		FamilyID:          session.FamilyID, // preserve family ID across rotations
		RefreshTokenHash:  newHash,
		DeviceFingerprint: clientInfo.DeviceFingerprint,
		UserAgent:         clientInfo.UserAgent,
		IPAddress:         clientInfo.IPAddress,
		ExpiresAt:         now.Add(s.refreshTTL),
		CreatedAt:         now,
	}
	if err := s.repo.CreateSession(ctx, newSession); err != nil {
		return nil, err
	}

	accessToken, err := GenerateAccessToken(s.jwtSecret, user, s.accessTTL)
	if err != nil {
		return nil, err
	}

	profile, _ := s.repo.GetProfile(ctx, user.ID)
	return &AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: newPlainRefresh,
		TokenType:    "Bearer",
		ExpiresIn:    int64(s.accessTTL.Seconds()),
		User:         *user,
		Profile:      profile,
	}, nil
}

func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	tokenHash := HashRefreshToken(strings.TrimSpace(refreshToken))
	session, err := s.repo.GetSessionByTokenHash(ctx, tokenHash)
	if err != nil {
		return nil // idempotent logout
	}
	return s.repo.RevokeSession(ctx, session.ID)
}

func (s *Service) SendVerification(ctx context.Context, userID, channel string) (string, error) {
	channel = strings.ToUpper(strings.TrimSpace(channel))
	if channel != "EMAIL" && channel != "PHONE" {
		return "", fmt.Errorf("channel must be EMAIL or PHONE")
	}

	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return "", err
	}

	target := user.Email
	if channel == "PHONE" {
		if user.PhoneE164 == nil || *user.PhoneE164 == "" {
			return "", fmt.Errorf("user does not have a verified or linked phone number")
		}
		target = *user.PhoneE164
	}

	otp, otpHash, err := GenerateNumericOTP(6)
	if err != nil {
		return "", err
	}

	now := time.Now().UTC()
	ver := &AccountVerification{
		ID:          generateUUIDv4(),
		UserID:      userID,
		Channel:     channel,
		Target:      target,
		CodeHash:    otpHash,
		MaxAttempts: 5,
		ExpiresAt:   now.Add(15 * time.Minute),
		CreatedAt:   now,
	}
	if err := s.repo.CreateVerification(ctx, ver); err != nil {
		return "", err
	}

	if s.notificationSink != nil {
		_ = s.notificationSink.DeliverVerificationOTP(ctx, target, channel, otp)
	}

	return otp, nil
}

func (s *Service) ConfirmVerification(ctx context.Context, userID, channel, code string) error {
	channel = strings.ToUpper(strings.TrimSpace(channel))
	ver, err := s.repo.GetLatestVerification(ctx, userID, channel)
	if err != nil {
		return ErrVerificationNotFound
	}

	if ver.VerifiedAt != nil {
		return nil // already verified
	}
	if time.Now().UTC().After(ver.ExpiresAt) {
		return ErrVerificationExpired
	}
	if ver.Attempts >= ver.MaxAttempts {
		return ErrVerificationMaxAttempts
	}

	expectedHash := HashTokenHex(strings.TrimSpace(code))
	if expectedHash != ver.CodeHash {
		_ = s.repo.IncrementVerificationAttempts(ctx, ver.ID)
		return ErrInvalidVerificationCode
	}

	if err := s.repo.MarkVerificationVerified(ctx, ver.ID); err != nil {
		return err
	}

	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	if channel == "EMAIL" {
		user.EmailVerifiedAt = &now
	} else {
		user.PhoneVerifiedAt = &now
	}
	return s.repo.UpdateUser(ctx, user)
}

func (s *Service) RequestPasswordReset(ctx context.Context, email string, clientIP ...string) (string, error) {
	normEmail := strings.ToLower(strings.TrimSpace(email))
	if normEmail == "" {
		return "", errors.New("email is required")
	}

	ip := ""
	if len(clientIP) > 0 {
		ip = strings.TrimSpace(clientIP[0])
	}

	// Rate limiting & resend throttling (checked prior to user lookup to prevent enumeration)
	if s.resetLimiter != nil && !s.resetLimiter.Allow(normEmail, ip) {
		return "", ErrResetRateLimited
	}

	user, err := s.repo.GetUserByEmail(ctx, normEmail)
	if err != nil {
		return "", nil // Defend against user enumeration: do not disclose existence
	}

	token, tokenHash, err := GenerateResetToken()
	if err != nil {
		return "", err
	}

	now := time.Now().UTC()
	reset := &PasswordReset{
		ID:        generateUUIDv4(),
		UserID:    user.ID,
		TokenHash: tokenHash,
		ExpiresAt: now.Add(1 * time.Hour),
		CreatedAt: now,
	}
	if err := s.repo.CreatePasswordReset(ctx, reset); err != nil {
		return "", err
	}

	if s.notificationSink != nil {
		if err := s.notificationSink.DeliverPasswordReset(ctx, user.Email, token); err != nil {
			if s.logger != nil {
				s.logger.Error("password_reset_delivery_failed",
					slog.String("target_masked", maskRecipient(user.Email)),
					slog.String("error", err.Error()),
				)
			}
		}
	}

	return token, nil
}

func (s *Service) ConfirmPasswordReset(ctx context.Context, token, newPassword string) error {
	if err := ValidatePasswordPolicy(newPassword); err != nil {
		return err
	}

	tokenHash := HashTokenHex(strings.TrimSpace(token))
	reset, err := s.repo.GetPasswordResetByHash(ctx, tokenHash)
	if err != nil {
		return ErrPasswordResetNotFound
	}

	if reset.UsedAt != nil || time.Now().UTC().After(reset.ExpiresAt) {
		return ErrPasswordResetExpired
	}

	user, err := s.repo.GetUserByID(ctx, reset.UserID)
	if err != nil {
		return err
	}

	pwHash, err := HashPasswordWithParams(newPassword, s.argonParams)
	if err != nil {
		return err
	}

	user.PasswordHash = pwHash
	if err := s.repo.UpdateUser(ctx, user); err != nil {
		return err
	}

	_ = s.repo.MarkPasswordResetUsed(ctx, reset.ID)
	_ = s.repo.RevokeAllUserSessions(ctx, reset.UserID) // Invalidate all existing sessions
	return nil
}

func (s *Service) GetMyProfile(ctx context.Context, userID string) (*FullProfileResponse, error) {
	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}

	// No profile is ever invented. Accounts created through Google Sign-In (or any
	// other path that has not completed onboarding) simply have no profile until
	// the user supplies their own data via UpdateMyProfile.
	profile, err := s.repo.GetProfile(ctx, userID)
	if err != nil && !errors.Is(err, ErrProfileNotFound) {
		return nil, err
	}
	onboardingRequired := errors.Is(err, ErrProfileNotFound) || profile == nil

	location, _ := s.repo.GetLocation(ctx, userID)
	prefs, _ := s.GetMyPreferences(ctx, userID)

	return &FullProfileResponse{
		User:               *user,
		Profile:            profile,
		OnboardingRequired: onboardingRequired,
		Location:           location,
		Preferences:        prefs,
		IsComplete:         profile.IsComplete(),
	}, nil
}

func (s *Service) UpdateMyProfile(ctx context.Context, userID string, req UpdateProfileRequest) (*Profile, error) {
	profile, err := s.repo.GetProfile(ctx, userID)
	creating := false
	if err != nil {
		if !errors.Is(err, ErrProfileNotFound) {
			return nil, err
		}
		creating = true
		profile = &Profile{
			UserID:             userID,
			VisibilitySettings: DefaultVisibilitySettings(),
			CreatedAt:          time.Now().UTC(),
			UpdatedAt:          time.Now().UTC(),
		}
	}

	now := time.Now().UTC()

	// Birthdate is collected exactly once, during onboarding, and is immutable
	// afterwards so that age-based safety rules cannot be bypassed.
	if req.Birthdate != nil {
		birthdate, parseErr := time.Parse("2006-01-02", strings.TrimSpace(*req.Birthdate))
		if parseErr != nil {
			return nil, fmt.Errorf("birthdate must be formatted YYYY-MM-DD")
		}
		if ageErr := ValidateAge(birthdate, now); ageErr != nil {
			return nil, ageErr
		}
		if !creating && !profile.Birthdate.IsZero() && !profile.Birthdate.Equal(birthdate) {
			return nil, ErrBirthdateImmutable
		}
		profile.Birthdate = birthdate
	}

	if req.DisplayName != nil {
		trimmed := strings.TrimSpace(*req.DisplayName)
		if trimmed == "" || len(trimmed) > 64 {
			return nil, fmt.Errorf("display name must be between 1 and 64 characters")
		}
		profile.DisplayName = trimmed
	}
	if req.Bio != nil {
		if len(*req.Bio) > 1000 {
			return nil, fmt.Errorf("bio cannot exceed 1000 characters")
		}
		profile.Bio = *req.Bio
	}
	if req.Pronouns != nil {
		if err := ValidateTaxonomy(nil, nil, req.Pronouns, nil); err != nil {
			return nil, err
		}
		profile.Pronouns = req.Pronouns
	}
	if req.GenderIdentities != nil {
		if len(req.GenderIdentities) == 0 {
			return nil, fmt.Errorf("at least one gender identity must be selected")
		}
		if err := ValidateTaxonomy(req.GenderIdentities, nil, nil, nil); err != nil {
			return nil, err
		}
		profile.GenderIdentities = req.GenderIdentities
	}
	if req.SexualOrientations != nil {
		if len(req.SexualOrientations) == 0 {
			return nil, fmt.Errorf("at least one sexual orientation must be selected")
		}
		if err := ValidateTaxonomy(nil, req.SexualOrientations, nil, nil); err != nil {
			return nil, err
		}
		profile.SexualOrientations = req.SexualOrientations
	}
	if req.RelationshipIntents != nil {
		if err := ValidateTaxonomy(nil, nil, nil, req.RelationshipIntents); err != nil {
			return nil, err
		}
		profile.RelationshipIntents = req.RelationshipIntents
	}

	// Onboarding must supply the mandatory profile fields explicitly. Nothing is
	// defaulted or fabricated on the user's behalf.
	if creating {
		if strings.TrimSpace(profile.DisplayName) == "" {
			return nil, fmt.Errorf("display name is required to complete onboarding")
		}
		if profile.Birthdate.IsZero() {
			return nil, fmt.Errorf("birthdate is required to complete onboarding")
		}
		if len(profile.GenderIdentities) == 0 {
			return nil, fmt.Errorf("at least one gender identity must be selected")
		}
		if len(profile.SexualOrientations) == 0 {
			return nil, fmt.Errorf("at least one sexual orientation must be selected")
		}
		profile.CreatedAt = now
	}

	if req.RelationshipStructure != nil {
		profile.RelationshipStructure = *req.RelationshipStructure
	}
	if req.VisibilitySettings != nil {
		profile.VisibilitySettings = *req.VisibilitySettings
	}
	if req.DiscreteModeEnabled != nil {
		profile.DiscreteModeEnabled = *req.DiscreteModeEnabled
	}
	if req.IncognitoEnabled != nil {
		profile.IncognitoEnabled = *req.IncognitoEnabled
	}
	if req.SmokingPreference != nil && req.SmokingHabit == nil {
		req.SmokingHabit = req.SmokingPreference
	}
	if req.SmokingHabit != nil {
		profile.SmokingHabit = *req.SmokingHabit
	}
	if req.DrinkingHabit != nil {
		profile.DrinkingHabit = *req.DrinkingHabit
	}
	if req.HeightCm != nil {
		if *req.HeightCm < 90 || *req.HeightCm > 250 {
			return nil, fmt.Errorf("height must be between 90 cm and 250 cm")
		}
		profile.HeightCm = req.HeightCm
	}
	if req.WeightKg != nil {
		if *req.WeightKg < 30 || *req.WeightKg > 300 {
			return nil, fmt.Errorf("weight must be between 30 kg and 300 kg")
		}
		profile.WeightKg = req.WeightKg
	}
	if req.Languages != nil {
		profile.Languages = req.Languages
	}
	if req.Interests != nil {
		profile.Interests = req.Interests
	}
	if req.NonSmokerDealbreaker != nil {
		pref, prefErr := s.repo.GetPreferences(ctx, userID)
		if prefErr == nil && pref != nil {
			pref.Dealbreakers.NonSmokerOnly = *req.NonSmokerDealbreaker
			_ = s.repo.UpsertPreferences(ctx, pref)
		}
	}

	gendersToSave := req.PreferredGenders
	if gendersToSave == nil {
		gendersToSave = req.LookingFor
	}
	if gendersToSave != nil {
		if err := ValidateTaxonomy(gendersToSave, nil, nil, nil); err != nil {
			return nil, fmt.Errorf("invalid preferred gender: %w", err)
		}
		pref, prefErr := s.repo.GetPreferences(ctx, userID)
		if prefErr == nil && pref != nil {
			pref.PreferredGenders = gendersToSave
			_ = s.repo.UpsertPreferences(ctx, pref)
		}
	}

	if err := s.repo.UpsertProfile(ctx, profile); err != nil {
		return nil, err
	}
	return profile, nil
}

func (s *Service) UpdateMyLocation(ctx context.Context, userID string, req UpdateLocationRequest) (*ProfileLocation, error) {
	if req.Latitude < -90 || req.Latitude > 90 {
		return nil, fmt.Errorf("latitude must be between -90 and 90")
	}
	if req.Longitude < -180 || req.Longitude > 180 {
		return nil, fmt.Errorf("longitude must be between -180 and 180")
	}
	if len(strings.TrimSpace(req.CountryCode)) != 2 {
		return nil, fmt.Errorf("country code must be a 2-letter ISO code")
	}

	loc := &ProfileLocation{
		UserID:      userID,
		Latitude:    req.Latitude,
		Longitude:   req.Longitude,
		CityName:    strings.TrimSpace(req.CityName),
		CountryCode: strings.ToUpper(strings.TrimSpace(req.CountryCode)),
		UpdatedAt:   time.Now().UTC(),
	}
	if err := s.repo.UpsertLocation(ctx, loc); err != nil {
		return nil, err
	}
	return loc, nil
}

func (s *Service) GetMyPreferences(ctx context.Context, userID string) (*DatingPreferences, error) {
	pref, err := s.repo.GetPreferences(ctx, userID)
	if err != nil {
		if errors.Is(err, ErrPreferencesNotFound) {
			def := DefaultDatingPreferences(userID)
			_ = s.repo.UpsertPreferences(ctx, &def)
			return &def, nil
		}
		return nil, err
	}
	return pref, nil
}

func (s *Service) UpdateMyPreferences(ctx context.Context, userID string, req UpdatePreferencesRequest) (*DatingPreferences, error) {
	pref, err := s.GetMyPreferences(ctx, userID)
	if err != nil {
		return nil, err
	}

	if req.MinAge != nil {
		if *req.MinAge < 18 {
			return nil, fmt.Errorf("minimum age filter must be at least 18")
		}
		pref.MinAge = *req.MinAge
	}
	if req.MaxAge != nil {
		if *req.MaxAge < pref.MinAge {
			return nil, fmt.Errorf("maximum age cannot be less than minimum age")
		}
		pref.MaxAge = *req.MaxAge
	}
	if req.MaxDistanceKm != nil {
		if *req.MaxDistanceKm < 1 || *req.MaxDistanceKm > 500 {
			return nil, fmt.Errorf("maximum distance must be between 1 and 500 km")
		}
		pref.MaxDistanceKm = *req.MaxDistanceKm
	}
	if req.PreferredGenders != nil {
		pref.PreferredGenders = req.PreferredGenders
	}
	if req.PreferredIntents != nil {
		pref.PreferredIntents = req.PreferredIntents
	}
	if req.VerifiedOnly != nil && req.VerifiedProfilesOnly == nil {
		req.VerifiedProfilesOnly = req.VerifiedOnly
	}
	if req.VerifiedProfilesOnly != nil {
		pref.VerifiedProfilesOnly = *req.VerifiedProfilesOnly
	}
	if req.Dealbreakers != nil {
		pref.Dealbreakers = *req.Dealbreakers
	}
	if req.PreferredOrientations != nil {
		pref.PreferredOrientations = req.PreferredOrientations
	}
	if req.PreferredLanguages != nil {
		pref.PreferredLanguages = req.PreferredLanguages
	}
	if req.PreferredInterests != nil {
		pref.PreferredInterests = req.PreferredInterests
	}
	if req.MinHeightCm != nil {
		if *req.MinHeightCm < 90 || *req.MinHeightCm > 250 {
			return nil, fmt.Errorf("minimum height must be between 90 cm and 250 cm")
		}
		pref.MinHeightCm = req.MinHeightCm
	}
	if req.MaxHeightCm != nil {
		if *req.MaxHeightCm < 90 || *req.MaxHeightCm > 250 {
			return nil, fmt.Errorf("maximum height must be between 90 cm and 250 cm")
		}
		if pref.MinHeightCm != nil && *req.MaxHeightCm < *pref.MinHeightCm {
			return nil, fmt.Errorf("maximum height cannot be less than minimum height")
		}
		pref.MaxHeightCm = req.MaxHeightCm
	}
	if req.MinWeightKg != nil {
		if *req.MinWeightKg < 30 || *req.MinWeightKg > 300 {
			return nil, fmt.Errorf("minimum weight must be between 30 kg and 300 kg")
		}
		pref.MinWeightKg = req.MinWeightKg
	}
	if req.MaxWeightKg != nil {
		if *req.MaxWeightKg < 30 || *req.MaxWeightKg > 300 {
			return nil, fmt.Errorf("maximum weight must be between 30 kg and 300 kg")
		}
		if pref.MinWeightKg != nil && *req.MaxWeightKg < *pref.MinWeightKg {
			return nil, fmt.Errorf("maximum weight cannot be less than minimum weight")
		}
		pref.MaxWeightKg = req.MaxWeightKg
	}
	if req.NotificationPreferences != nil {
		pref.NotificationPreferences = *req.NotificationPreferences
	}

	if err := s.repo.UpsertPreferences(ctx, pref); err != nil {
		return nil, err
	}
	return pref, nil
}

func (s *Service) issueAuthSession(ctx context.Context, user *User, profile *Profile, clientInfo ClientInfo) (*AuthResponse, error) {
	plainRefresh, refreshHash, err := GenerateRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("failed to generate refresh token: %w", err)
	}

	now := time.Now().UTC()
	session := &UserSession{
		ID:                generateUUIDv4(),
		UserID:            user.ID,
		FamilyID:          generateUUIDv4(),
		RefreshTokenHash:  refreshHash,
		DeviceFingerprint: clientInfo.DeviceFingerprint,
		UserAgent:         clientInfo.UserAgent,
		IPAddress:         clientInfo.IPAddress,
		ExpiresAt:         now.Add(s.refreshTTL),
		CreatedAt:         now,
	}

	if err := s.repo.CreateSession(ctx, session); err != nil {
		return nil, fmt.Errorf("failed to persist user session: %w", err)
	}

	accessToken, err := GenerateAccessToken(s.jwtSecret, user, s.accessTTL)
	if err != nil {
		return nil, fmt.Errorf("failed to sign access token: %w", err)
	}

	return &AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: plainRefresh,
		TokenType:    "Bearer",
		ExpiresIn:    int64(s.accessTTL.Seconds()),
		User:         *user,
		Profile:      profile,
	}, nil
}

func generateUUIDv4() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func (s *Service) ListUsers(ctx context.Context, roleFilter, statusFilter, search string, limit, offset int) ([]*User, int, error) {
	return s.repo.ListUsers(ctx, roleFilter, statusFilter, search, limit, offset)
}

func (s *Service) UpdateUserRole(ctx context.Context, actorID string, targetUserID string, newRole UserRole) error {
	if actorID != "" && actorID == targetUserID {
		return errors.New("self-action prohibited: administrators cannot modify their own administrative roles")
	}
	switch newRole {
	case RoleMember, RoleTrustAndSafety, RoleFinanceAdmin, RoleEditorialCMS, RoleCustomerSupport, RoleAffiliateManager, RoleSuperAdmin:
	default:
		return fmt.Errorf("invalid user role: %s", newRole)
	}
	return s.repo.UpdateUserRole(ctx, targetUserID, newRole)
}

func (s *Service) UnlockAccount(ctx context.Context, actorID string, targetUserID string) error {
	if actorID != "" && actorID == targetUserID {
		return errors.New("self-action prohibited: administrators cannot unlock their own accounts")
	}
	return s.repo.UpdateUserStatus(ctx, targetUserID, StatusActive)
}

func (s *Service) AdminResetPassword(ctx context.Context, actorID string, targetUserID string) (*PasswordReset, error) {
	if actorID != "" && actorID == targetUserID {
		return nil, errors.New("self-action prohibited: administrators cannot trigger administrative password resets on their own accounts")
	}
	u, err := s.repo.GetUserByID(ctx, targetUserID)
	if err != nil {
		return nil, err
	}

	token, tokenHash, err := GenerateResetToken()
	if err != nil {
		return nil, err
	}

	reset := &PasswordReset{
		ID:        generateUUIDv4(),
		UserID:    u.ID,
		TokenHash: tokenHash,
		ExpiresAt: time.Now().UTC().Add(24 * time.Hour),
		CreatedAt: time.Now().UTC(),
	}
	if err := s.repo.CreatePasswordReset(ctx, reset); err != nil {
		return nil, err
	}
	if s.notificationSink != nil {
		if err := s.notificationSink.DeliverPasswordReset(ctx, u.Email, token); err != nil {
			if s.logger != nil {
				s.logger.Error("admin_password_reset_delivery_failed",
					slog.String("target_masked", maskRecipient(u.Email)),
					slog.String("error", err.Error()),
				)
			}
		}
	}
	return reset, nil
}

// DeleteAccount permanently deletes/anonymizes user data, revokes sessions, and removes discovery data.
func (s *Service) DeleteAccount(ctx context.Context, userID, password string, confirmDeletion bool) error {
	if !confirmDeletion {
		return ErrDeleteConfirmationRequired
	}

	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if user.Status == StatusDeleted {
		return ErrAccountAlreadyDeleted
	}

	// If user has a password set, require password verification
	if user.PasswordHash != "" {
		if strings.TrimSpace(password) == "" {
			return ErrInvalidCredentials
		}
		valid, err := VerifyPassword(password, user.PasswordHash)
		if err != nil || !valid {
			return ErrInvalidCredentials
		}
	}

	// 1. Revoke all user sessions
	_ = s.repo.RevokeAllUserSessions(ctx, userID)

	// 2. Cascade delete & anonymize user data
	if err := s.repo.DeleteAccountData(ctx, userID); err != nil {
		return fmt.Errorf("deleting account data: %w", err)
	}

	if s.logger != nil {
		s.logger.Info("user account permanently deleted and anonymized", slog.String("user_id", userID))
	}
	return nil
}

// RequestAccountDeletionWeb processes an external deletion request from Google Play compliance web form.
func (s *Service) RequestAccountDeletionWeb(ctx context.Context, email, reason string, confirm bool) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return errors.New("email is required")
	}
	if !confirm {
		return ErrDeleteConfirmationRequired
	}

	user, err := s.repo.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			// Fail silently to avoid user enumeration
			return nil
		}
		return err
	}
	if user.Status == StatusDeleted {
		return nil
	}

	_ = s.repo.RevokeAllUserSessions(ctx, user.ID)
	if err := s.repo.DeleteAccountData(ctx, user.ID); err != nil {
		return fmt.Errorf("deleting account data: %w", err)
	}

	if s.logger != nil {
		s.logger.Info("external account deletion request processed",
			slog.String("user_id", user.ID),
			slog.String("reason", reason),
		)
	}
	return nil
}
