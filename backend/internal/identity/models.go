package identity

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type UserStatus string

const (
	StatusActive      UserStatus = "ACTIVE"
	StatusSuspended   UserStatus = "SUSPENDED"
	StatusBanned      UserStatus = "BANNED"
	StatusDeactivated UserStatus = "DEACTIVATED"
	StatusDeleted     UserStatus = "DELETED"
)

type UserRole string

const (
	RoleMember         UserRole = "MEMBER"
	RoleTrustAndSafety UserRole = "TRUST_AND_SAFETY"
	RoleFinanceAdmin   UserRole = "FINANCE_ADMIN"
	RoleEditorialCMS    UserRole = "EDITORIAL_CMS"
	RoleCustomerSupport UserRole = "CUSTOMER_SUPPORT"
	RoleAffiliateManager UserRole = "AFFILIATE_MANAGER"
	RoleSuperAdmin      UserRole = "SUPER_ADMIN"
)

type User struct {
	ID              string     `json:"id"`
	Email           string     `json:"email"`
	PhoneE164       *string    `json:"phone_e164,omitempty"`
	PasswordHash    string     `json:"-"`
	Status          UserStatus `json:"status"`
	Role            UserRole   `json:"role"`
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty"`
	PhoneVerifiedAt *time.Time `json:"phone_verified_at,omitempty"`
	LastActiveAt    *time.Time `json:"last_active_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type UserSession struct {
	ID                string     `json:"id"`
	UserID            string     `json:"user_id"`
	FamilyID          string     `json:"family_id"`
	RefreshTokenHash  []byte     `json:"-"`
	DeviceFingerprint string     `json:"device_fingerprint,omitempty"`
	UserAgent         string     `json:"user_agent,omitempty"`
	IPAddress         string     `json:"ip_address,omitempty"`
	ExpiresAt         time.Time  `json:"expires_at"`
	RevokedAt         *time.Time `json:"revoked_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

type VisibilityLevel string

const (
	VisibilityPublicCommunity VisibilityLevel = "PUBLIC_COMMUNITY"
	VisibilityMatchesOnly     VisibilityLevel = "MATCHES_ONLY"
	VisibilityHidden          VisibilityLevel = "HIDDEN"
)

type VisibilitySettings struct {
	GenderIdentity    VisibilityLevel `json:"gender_identity"`
	SexualOrientation VisibilityLevel `json:"sexual_orientation"`
	Pronouns          VisibilityLevel `json:"pronouns"`
	Distance          VisibilityLevel `json:"distance"`
	OnlineStatus      VisibilityLevel `json:"online_status"`
	TravelerSafety    bool            `json:"traveler_safety"` // Auto-hide profile in restrictive legal zones
	Height            VisibilityLevel `json:"height,omitempty"`
	Weight            VisibilityLevel `json:"weight,omitempty"`
}

func DefaultVisibilitySettings() VisibilitySettings {
	return VisibilitySettings{
		GenderIdentity:    VisibilityPublicCommunity,
		SexualOrientation: VisibilityPublicCommunity,
		Pronouns:          VisibilityPublicCommunity,
		Distance:          VisibilityPublicCommunity,
		OnlineStatus:      VisibilityPublicCommunity,
		TravelerSafety:    true,
		Height:            VisibilityPublicCommunity,
		Weight:            VisibilityPublicCommunity,
	}
}

type RelationshipStructure string

const (
	StructureMonogamous  RelationshipStructure = "MONOGAMOUS"
	StructureENM         RelationshipStructure = "ENM"
	StructurePolyamorous RelationshipStructure = "POLYAMOROUS"
	StructureOpen        RelationshipStructure = "OPEN"
	StructureExploring   RelationshipStructure = "EXPLORING"
)

type SmokingHabit string

const (
	SmokingNonSmoker      SmokingHabit = "NON_SMOKER"
	SmokingSocialSmoker   SmokingHabit = "SOCIAL_SMOKER"
	SmokingRegularSmoker  SmokingHabit = "REGULAR_SMOKER"
	SmokingCannabisOnly   SmokingHabit = "CANNABIS_ONLY"
	SmokingPreferNotToSay SmokingHabit = "PREFER_NOT_TO_SAY"
)

type DrinkingHabit string

const (
	DrinkingNever          DrinkingHabit = "NEVER"
	DrinkingSocially       DrinkingHabit = "SOCIALLY"
	DrinkingFrequently     DrinkingHabit = "FREQUENTLY"
	DrinkingSober          DrinkingHabit = "SOBER"
	DrinkingPreferNotToSay DrinkingHabit = "PREFER_NOT_TO_SAY"
)

type Profile struct {
	UserID                string                `json:"user_id"`
	DisplayName           string                `json:"display_name"`
	Birthdate             time.Time             `json:"birthdate"`
	Bio                   string                `json:"bio"`
	Pronouns              []string              `json:"pronouns"`
	GenderIdentities      []string              `json:"gender_identities"`
	SexualOrientations    []string              `json:"sexual_orientations"`
	RelationshipIntents   []string              `json:"relationship_intents"`
	RelationshipStructure RelationshipStructure `json:"relationship_structure,omitempty"`
	SmokingHabit          SmokingHabit          `json:"smoking_habit,omitempty"`
	DrinkingHabit         DrinkingHabit         `json:"drinking_habit,omitempty"`
	VisibilitySettings    VisibilitySettings    `json:"visibility_settings"`
	IsPhotoVerified       bool                  `json:"is_photo_verified"`
	DiscreteModeEnabled   bool                  `json:"discrete_mode_enabled"`
	IncognitoEnabled      bool                  `json:"incognito_enabled"`
	HeightCm              *int                  `json:"height_cm,omitempty"`
	WeightKg              *int                  `json:"weight_kg,omitempty"`
	Languages             []string              `json:"languages"`
	Interests             []string              `json:"interests"`
	CreatedAt             time.Time             `json:"created_at"`
	UpdatedAt             time.Time             `json:"updated_at"`
}

// IsComplete checks if the profile has all required fields including height (weight is optional).
func (p *Profile) IsComplete() bool {
	if p == nil {
		return false
	}
	if strings.TrimSpace(p.DisplayName) == "" || p.Birthdate.IsZero() {
		return false
	}
	if len(p.GenderIdentities) == 0 || len(p.SexualOrientations) == 0 {
		return false
	}
	if p.HeightCm == nil || *p.HeightCm < 90 || *p.HeightCm > 250 {
		return false
	}
	if p.WeightKg != nil && (*p.WeightKg < 30 || *p.WeightKg > 300) {
		return false
	}
	return true
}

type ProfileLocation struct {
	UserID              string      `json:"user_id"`
	Latitude            float64     `json:"latitude"`
	Longitude           float64     `json:"longitude"`
	PassportCoordinates *[2]float64 `json:"passport_coordinates,omitempty"`
	CityName            string      `json:"city_name"`
	CountryCode         string      `json:"country_code"`
	UpdatedAt           time.Time   `json:"updated_at"`
}

// LifestyleDealbreakers defines hard mandatory filters that strictly exclude candidates regardless of scarcity.
type LifestyleDealbreakers struct {
	NonSmokerOnly     bool `json:"non_smoker_only"`
	RequireVerified   bool `json:"require_verified"`
	RequireMonogamous bool `json:"require_monogamous"`
}

// NotificationPreferences configures per-category push/in-app notification delivery and quiet hours.
type NotificationPreferences struct {
	MatchesEnabled          bool `json:"matches_enabled"`
	MessagesEnabled         bool `json:"messages_enabled"`
	DiscoveryUpdatesEnabled bool `json:"discovery_updates_enabled"`
	BillingAlertsEnabled    bool `json:"billing_alerts_enabled"`
	SecurityAlertsEnabled   bool `json:"security_alerts_enabled"`
	QuietHoursEnabled       bool `json:"quiet_hours_enabled"`
	QuietHoursStartUTC      int  `json:"quiet_hours_start_utc"` // 0-23
	QuietHoursEndUTC        int  `json:"quiet_hours_end_utc"`   // 0-23
}

func DefaultNotificationPreferences() NotificationPreferences {
	return NotificationPreferences{
		MatchesEnabled:          true,
		MessagesEnabled:         true,
		DiscoveryUpdatesEnabled: false, // Opt-in by default
		BillingAlertsEnabled:    true,
		SecurityAlertsEnabled:   true,
		QuietHoursEnabled:       false,
		QuietHoursStartUTC:      22,
		QuietHoursEndUTC:        8,
	}
}

type DatingPreferences struct {
	UserID                  string                  `json:"user_id"`
	MinAge                  int                     `json:"min_age"`
	MaxAge                  int                     `json:"max_age"`
	MaxDistanceKm           int                     `json:"max_distance_km"`
	PreferredGenders        []string                `json:"preferred_genders"`
	PreferredIntents        []string                `json:"preferred_intents"`
	PreferredOrientations   []string                `json:"preferred_orientations,omitempty"`
	PreferredLanguages      []string                `json:"preferred_languages,omitempty"`
	PreferredInterests      []string                `json:"preferred_interests,omitempty"`
	VerifiedProfilesOnly    bool                    `json:"verified_profiles_only"`
	MinHeightCm             *int                    `json:"min_height_cm,omitempty"`
	MaxHeightCm             *int                    `json:"max_height_cm,omitempty"`
	MinWeightKg             *int                    `json:"min_weight_kg,omitempty"`
	MaxWeightKg             *int                    `json:"max_weight_kg,omitempty"`
	Dealbreakers            LifestyleDealbreakers   `json:"dealbreakers"`
	NotificationPreferences NotificationPreferences `json:"notification_preferences"`
	UpdatedAt               time.Time               `json:"updated_at"`
}

func DefaultDatingPreferences(userID string) DatingPreferences {
	return DatingPreferences{
		UserID:                  userID,
		MinAge:                  18,
		MaxAge:                  99,
		MaxDistanceKm:           50,
		PreferredGenders:        []string{},
		PreferredIntents:        []string{},
		PreferredOrientations:   []string{},
		PreferredLanguages:      []string{},
		PreferredInterests:      []string{},
		VerifiedProfilesOnly:    false,
		Dealbreakers:            LifestyleDealbreakers{},
		NotificationPreferences: DefaultNotificationPreferences(),
		UpdatedAt:               time.Now().UTC(),
	}
}

type AccountVerification struct {
	ID          string     `json:"id"`
	UserID      string     `json:"user_id"`
	Channel     string     `json:"channel"` // EMAIL | PHONE
	Target      string     `json:"target"`
	CodeHash    string     `json:"-"`
	Attempts    int        `json:"attempts"`
	MaxAttempts int        `json:"max_attempts"`
	ExpiresAt   time.Time  `json:"expires_at"`
	VerifiedAt  *time.Time `json:"verified_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

type PasswordReset struct {
	ID        string     `json:"id"`
	UserID    string     `json:"user_id"`
	TokenHash string     `json:"-"`
	ExpiresAt time.Time  `json:"expires_at"`
	UsedAt    *time.Time `json:"used_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// Canonical LGBTQ+ Taxonomy Vocabularies
var ValidGenderIdentities = map[string]struct{}{
	"cisgender man":     {},
	"cis man":           {},
	"cisgender_man":     {},
	"transgender man":   {},
	"trans man":         {},
	"transgender_man":   {},
	"cisgender woman":   {},
	"cis woman":         {},
	"cisgender_woman":   {},
	"transgender woman": {},
	"trans woman":       {},
	"transgender_woman": {},
	"woman":             {},
	"man":               {},
	"non-binary":        {},
	"non_binary":        {},
	"genderfluid":       {},
	"agender":           {},
	"two-spirit":        {},
	"two_spirit":        {},
	"genderqueer":       {},
	"intersex":          {},
	"prefer not to say": {},
	"all":               {},
	"everyone":          {},
	"custom":            {},
}

var ValidSexualOrientations = map[string]struct{}{
	"gay":               {},
	"lesbian":           {},
	"bisexual":          {},
	"pansexual":         {},
	"queer":             {},
	"asexual":           {},
	"demisexual":        {},
	"questioning":       {},
	"straight":          {},
	"heterosexual":      {},
	"prefer not to say": {},
	"custom":            {},
}

var ValidPronouns = map[string]struct{}{
	"he/him":    {},
	"she/her":   {},
	"they/them": {},
	"she/they":  {},
	"he/they":   {},
	"ze/zir":    {},
	"custom":    {},
}

var ValidRelationshipIntents = map[string]struct{}{
	"long-term partner":   {},
	"long_term":           {},
	"serious dating":      {},
	"casual dating":       {},
	"casual":              {},
	"queer platonic":      {},
	"community / friends": {},
	"friendship":          {},
	"exploring":           {},
	"dating":              {},
}

func ValidateTaxonomy(genders, orientations, pronouns, intents []string) error {
	for _, g := range genders {
		norm := strings.TrimSpace(strings.ToLower(g))
		if _, ok := ValidGenderIdentities[norm]; !ok && !strings.HasPrefix(norm, "custom:") {
			return fmt.Errorf("unrecognized gender identity: %q", g)
		}
	}
	for _, o := range orientations {
		norm := strings.TrimSpace(strings.ToLower(o))
		if _, ok := ValidSexualOrientations[norm]; !ok && !strings.HasPrefix(norm, "custom:") {
			return fmt.Errorf("unrecognized sexual orientation: %q", o)
		}
	}
	for _, p := range pronouns {
		norm := strings.TrimSpace(strings.ToLower(p))
		if _, ok := ValidPronouns[norm]; !ok && !strings.HasPrefix(norm, "custom:") {
			return fmt.Errorf("unrecognized pronoun: %q", p)
		}
	}
	for _, i := range intents {
		norm := strings.TrimSpace(strings.ToLower(i))
		if _, ok := ValidRelationshipIntents[norm]; !ok {
			return fmt.Errorf("unrecognized relationship intent: %q", i)
		}
	}
	return nil
}

func ValidateAge(birthdate time.Time, now time.Time) error {
	if birthdate.IsZero() {
		return fmt.Errorf("birthdate is required")
	}
	// Calculate age accounting for leap years
	years := now.Year() - birthdate.Year()
	if now.YearDay() < birthdate.YearDay() {
		years--
	}
	if years < 18 {
		return fmt.Errorf("members must be at least 18 years old (current calculated age: %d)", years)
	}
	if years > 120 {
		return fmt.Errorf("invalid birthdate: age cannot exceed 120 years")
	}
	return nil
}

func (vs *VisibilitySettings) Scan(value any) error {
	bytes, ok := value.([]byte)
	if !ok {
		return fmt.Errorf("type assertion to []byte failed")
	}
	return json.Unmarshal(bytes, vs)
}

type OAuthIdentity struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	Provider        string    `json:"provider"`
	ProviderSubject string    `json:"provider_subject"`
	Email           string    `json:"email"`
	EmailVerified   bool      `json:"email_verified"`
	LinkedAt        time.Time `json:"linked_at"`
	LastLoginAt     time.Time `json:"last_login_at"`
}

type DeleteAccountRequest struct {
	Password        string `json:"password,omitempty"`
	ConfirmDeletion bool   `json:"confirm_deletion"`
	Reason          string `json:"reason,omitempty"`
}

type DeleteAccountResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

type DeletionRequestExternalRequest struct {
	Email           string `json:"email"`
	Reason          string `json:"reason,omitempty"`
	ConfirmDeletion bool   `json:"confirm_deletion"`
}
