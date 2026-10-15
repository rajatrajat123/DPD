package identity

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"strings"
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
	ErrPasswordTooShort               = errors.New("password must be at least 8 characters long")
	ErrPasswordTooLong                = errors.New("password cannot exceed 128 characters")
	ErrPasswordMissingDigit           = errors.New("password must contain at least one numeric digit (0-9)")
	ErrPasswordMissingSpecial         = errors.New("password must contain at least one special character (such as !, @, #, $, or _)")
	ErrTransactionalEmailUnconfigured = errors.New("transactional email provider unconfigured: delivery blocked in production/staging")
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
	Pronouns              []string              `json:"pronouns,omitempty"`
	RelationshipIntents   []string              `json:"relationship_intents,omitempty"`
	RelationshipStructure RelationshipStructure `json:"relationship_structure,omitempty"`
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
}

type UpdateProfileRequest struct {
	DisplayName           *string                `json:"display_name,omitempty"`
	Bio                   *string                `json:"bio,omitempty"`
	Pronouns              []string               `json:"pronouns,omitempty"`
	GenderIdentities      []string               `json:"gender_identities,omitempty"`
	SexualOrientations    []string               `json:"sexual_orientations,omitempty"`
	RelationshipIntents   []string               `json:"relationship_intents,omitempty"`
	RelationshipStructure *RelationshipStructure `json:"relationship_structure,omitempty"`
	VisibilitySettings    *VisibilitySettings    `json:"visibility_settings,omitempty"`
	DiscreteModeEnabled   *bool                  `json:"discrete_mode_enabled,omitempty"`
	IncognitoEnabled      *bool                  `json:"incognito_enabled,omitempty"`
	SmokingHabit          *SmokingHabit          `json:"smoking_habit,omitempty"`
	SmokingPreference     *SmokingHabit          `json:"smoking_preference,omitempty"`
	NonSmokerDealbreaker  *bool                  `json:"non_smoker_dealbreaker,omitempty"`
	DrinkingHabit         *DrinkingHabit         `json:"drinking_habit,omitempty"`
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
	VerifiedProfilesOnly    *bool                    `json:"verified_profiles_only,omitempty"`
	VerifiedOnly            *bool                    `json:"verified_only,omitempty"`
	DealbreakerNonSmoker    *bool                    `json:"dealbreaker_non_smoker,omitempty"`
	Dealbreakers            *LifestyleDealbreakers   `json:"dealbreakers,omitempty"`
	NotificationPreferences *NotificationPreferences `json:"notification_preferences,omitempty"`
}

type FullProfileResponse struct {
	User        User               `json:"user"`
	Profile     Profile            `json:"profile"`
	Location    *ProfileLocation   `json:"location,omitempty"`
	Preferences *DatingPreferences `json:"preferences,omitempty"`
}

type Service struct {
	repo        Repository
	jwtSecret   string
	accessTTL   time.Duration
	refreshTTL  time.Duration
	argonParams  ArgonParams
	outboxPub        events.Publisher
	loginTracker     LoginAttemptTracker
	notificationSink NotificationDeliverySink
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

func (s *Service) SetNotificationSink(sink NotificationDeliverySink) {
	s.notificationSink = sink
}

func NewService(repo Repository, jwtSecret string, opts ...ServiceOption) *Service {
	s := &Service{
		repo:        repo,
		jwtSecret:   jwtSecret,
		accessTTL:   15 * time.Minute,
		refreshTTL:  30 * 24 * time.Hour,
		argonParams: DefaultArgonParams,
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

func (s *Service) Register(ctx context.Context, req RegisterRequest, clientInfo ClientInfo) (*AuthResponse, error) {
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
		VisibilitySettings:    DefaultVisibilitySettings(),
		CreatedAt:             now,
		UpdatedAt:             now,
	}
	if err := s.repo.UpsertProfile(ctx, profile); err != nil {
		return nil, fmt.Errorf("failed to save initial profile: %w", err)
	}

	pref := DefaultDatingPreferences(userID)
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

func (s *Service) RequestPasswordReset(ctx context.Context, email string) (string, error) {
	user, err := s.repo.GetUserByEmail(ctx, strings.TrimSpace(email))
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
		_ = s.notificationSink.DeliverPasswordReset(ctx, user.Email, token)
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
	_ = s.repo.RevokeSessionFamily(ctx, reset.UserID) // Invalidate existing sessions
	return nil
}

func (s *Service) GetMyProfile(ctx context.Context, userID string) (*FullProfileResponse, error) {
	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	profile, err := s.repo.GetProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	location, _ := s.repo.GetLocation(ctx, userID)
	prefs, _ := s.repo.GetPreferences(ctx, userID)

	return &FullProfileResponse{
		User:        *user,
		Profile:     *profile,
		Location:    location,
		Preferences: prefs,
	}, nil
}

func (s *Service) UpdateMyProfile(ctx context.Context, userID string, req UpdateProfileRequest) (*Profile, error) {
	profile, err := s.repo.GetProfile(ctx, userID)
	if err != nil {
		return nil, err
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
	if req.NonSmokerDealbreaker != nil {
		pref, prefErr := s.repo.GetPreferences(ctx, userID)
		if prefErr == nil && pref != nil {
			pref.Dealbreakers.NonSmokerOnly = *req.NonSmokerDealbreaker
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
	if req.DealbreakerNonSmoker != nil {
		pref.Dealbreakers.NonSmokerOnly = *req.DealbreakerNonSmoker
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
		_ = s.notificationSink.DeliverPasswordReset(ctx, u.Email, token)
	}
	return reset, nil
}
