package discovery

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

type SwipeDirection string

const (
	SwipeLike       SwipeDirection = "LIKE"
	SwipePass       SwipeDirection = "PASS"
	SwipeSuperSpark SwipeDirection = "SUPER_SPARK"
)

func ValidateSwipeDirection(d string) (SwipeDirection, error) {
	norm := strings.ToUpper(strings.TrimSpace(d))
	switch SwipeDirection(norm) {
	case SwipeLike, SwipePass, SwipeSuperSpark:
		return SwipeDirection(norm), nil
	default:
		return "", fmt.Errorf("invalid swipe direction %q: must be LIKE, PASS, or SUPER_SPARK", d)
	}
}

type MatchStatus string

const (
	MatchActive    MatchStatus = "ACTIVE"
	MatchUnmatched MatchStatus = "UNMATCHED"
	MatchBlocked   MatchStatus = "BLOCKED"
)

type PhotoCard struct {
	AssetID  string `json:"asset_id"`
	ThumbURL string `json:"thumb_url"`
	CardURL  string `json:"card_url"`
	FullURL  string `json:"full_url"`
}

type DiscoveryCandidate struct {
	UserID                string      `json:"user_id"`
	DisplayName           string      `json:"display_name"`
	Age                   int         `json:"age"`
	Bio                   string      `json:"bio"`
	Pronouns              []string    `json:"pronouns"`
	GenderIdentities      []string    `json:"gender_identities"`
	SexualOrientations    []string    `json:"sexual_orientations"`
	RelationshipIntents   []string    `json:"relationship_intents"`
	RelationshipStructure string      `json:"relationship_structure,omitempty"`
	SmokingHabit          string      `json:"smoking_habit,omitempty"`
	DrinkingHabit         string      `json:"drinking_habit,omitempty"`
	HeightCm              *int        `json:"height_cm,omitempty"`
	WeightKg              *int        `json:"weight_kg,omitempty"`
	Languages             []string    `json:"languages,omitempty"`
	Interests             []string    `json:"interests,omitempty"`
	ApproximateDistanceKm int         `json:"approximate_distance_km"` // Privacy-preserving integer km, never exact GPS
	IsPhotoVerified       bool        `json:"is_photo_verified"`
	CompatibilityScore    float64     `json:"compatibility_score"`
	Photos                []PhotoCard `json:"photos"`
	IsSponsored           bool        `json:"is_sponsored,omitempty"`
	SponsoredTitle        string      `json:"sponsored_title,omitempty"`
	SponsoredCTA          string      `json:"sponsored_cta,omitempty"`
	SponsoredURL          string      `json:"sponsored_url,omitempty"`
}

type SwipeRequest struct {
	TargetUserID string `json:"target_user_id"`
	Direction    string `json:"direction"`
	IntroNote    string `json:"intro_note,omitempty"`
}

type Match struct {
	ID          string      `json:"id"`
	UserLowID   string      `json:"user_low_id"`
	UserHighID  string      `json:"user_high_id"`
	Status      MatchStatus `json:"status"`
	MatchedAt   time.Time   `json:"matched_at"`
	UnmatchedAt *time.Time  `json:"unmatched_at,omitempty"`
}

type MatchResponse struct {
	ID             string              `json:"id"`
	MatchedUserID  string              `json:"matched_user_id"`
	MatchedProfile *DiscoveryCandidate `json:"matched_profile,omitempty"`
	Status         MatchStatus         `json:"status"`
	MatchedAt      time.Time           `json:"matched_at"`
}

type SwipeResponse struct {
	Matched                bool           `json:"matched"`
	Match                  *MatchResponse `json:"match,omitempty"`
	DailySwipesRemaining   *int           `json:"daily_swipes_remaining,omitempty"`
	UnlimitedSwipesGranted bool           `json:"unlimited_swipes_granted"`
	RewardDetails          string         `json:"reward_details,omitempty"`
}

type DiscoveryFeedResponse struct {
	Candidates       []DiscoveryCandidate `json:"candidates"`
	NextCursor       string               `json:"next_cursor,omitempty"`
	Count            int                  `json:"count"`
	EmptyStateReason string               `json:"empty_state_reason,omitempty"`
}

type DiscoverySearchResponse struct {
	Query      string               `json:"query"`
	Count      int                  `json:"count"`
	Candidates []DiscoveryCandidate `json:"candidates"`
}

type MatchingSummaryResponse struct {
	Count               int       `json:"count"`
	DisplayText         string    `json:"display_text"`
	PrivacyFloorApplied bool      `json:"privacy_floor_applied"`
	CachedAt            time.Time `json:"cached_at"`
	ExpiresAt           time.Time `json:"expires_at"`
}

type BlockRequest struct {
	TargetUserID string `json:"target_user_id"`
	Reason       string `json:"reason,omitempty"`
}

type UnmatchRequest struct {
	Reason string `json:"reason,omitempty"`
}

type RewindResponse struct {
	Success        bool   `json:"success"`
	RestoredUserID string `json:"restored_user_id"`
}

type SwipeAllowanceDetail struct {
	UserID                string    `json:"user_id"`
	DailyQuota            int       `json:"daily_quota"`
	RemainingRegularLikes int       `json:"remaining_regular_likes"`
	RemainingBonusLikes   int       `json:"remaining_bonus_likes"`
	RemainingLikes        int       `json:"remaining_likes"`
	IsUnlimited           bool      `json:"is_unlimited"`
	IsIntroductory        bool      `json:"is_introductory"`
	WindowStart           time.Time `json:"window_start"`
	WindowResetAt         time.Time `json:"window_reset_at"`
}

type IncomingLikeCard struct {
	UserID                string      `json:"user_id"`
	DisplayName           string      `json:"display_name"`
	Age                   int         `json:"age"`
	Bio                   string      `json:"bio"`
	ApproximateDistanceKm int         `json:"approximate_distance_km"`
	IsPhotoVerified       bool        `json:"is_photo_verified"`
	IsRevealed            bool        `json:"is_revealed"`
	LikedAt               time.Time   `json:"liked_at"`
	Photos                []PhotoCard `json:"photos"`
	BlurredPhotoURL       string      `json:"blurred_photo_url,omitempty"`
	InteractionType       string      `json:"interaction_type,omitempty"`
	IsSuperLike           bool        `json:"is_super_like"`
}

type LikesYouResponse struct {
	TotalLikes               int                `json:"total_likes"`
	RevealedCount            int                `json:"revealed_count"`
	UnrevealedCount          int                `json:"unrevealed_count"`
	FreeRevealsRemaining     int                `json:"free_reveals_remaining"`
	BonusRevealsRemaining    int                `json:"bonus_reveals_remaining"`
	CooldownActive           bool               `json:"cooldown_active"`
	CooldownRemainingSeconds int                `json:"cooldown_remaining_seconds"`
	RewardedAdEnabled        bool               `json:"rewarded_ad_enabled"`
	Likes                    []IncomingLikeCard `json:"likes"`
	AdsWatchedInWindow       int                `json:"ads_watched_in_window"`
	MaxAdsPerWindow          int                `json:"max_ads_per_window"`
	CanWatchAd               bool               `json:"can_watch_ad"`
	AdResetInSeconds         int                `json:"ad_reset_in_seconds"`
	ProfilesUnlockedInWindow int                `json:"profiles_unlocked_in_window"`
	MaxProfilesPerWindow     int                `json:"max_profiles_per_window"`
}

const (
	LikesYouAdWindowHours        = 25 * time.Hour
	LikesYouMaxAdsPerWindow      = 5
	LikesYouProfilesPerAd        = 2
	LikesYouMaxProfilesPerWindow = LikesYouMaxAdsPerWindow * LikesYouProfilesPerAd // 10
)

var (
	ErrLikesYouAdLimitReached = errors.New("Likes You rewarded ad limit reached (maximum 5 ads per rolling 25-hour window)")
)

type LikesYouAdStatus struct {
	AdsWatchedInWindow       int  `json:"ads_watched_in_window"`
	MaxAdsPerWindow          int  `json:"max_ads_per_window"`
	CanWatchAd               bool `json:"can_watch_ad"`
	AdResetInSeconds         int  `json:"ad_reset_in_seconds"`
	ProfilesUnlockedInWindow int  `json:"profiles_unlocked_in_window"`
	MaxProfilesPerWindow     int  `json:"max_profiles_per_window"`
}

type LikesYouAdRewardResult struct {
	AdsWatchedInWindow    int
	MaxAdsPerWindow       int
	CanWatchAd            bool
	AdResetInSeconds      int
	NewlyUnlockedUserIDs  []string
	BonusRevealsRemaining int
}

type LikesYouUnlockAdRequest struct {
	TransactionID string `json:"transaction_id"`
	RawQuery      string `json:"raw_query,omitempty"`
}

type LikesYouUnlockAdResponse struct {
	Success               bool              `json:"success"`
	AdsWatchedInWindow    int               `json:"ads_watched_in_window"`
	MaxAdsPerWindow       int               `json:"max_ads_per_window"`
	CanWatchAd            bool              `json:"can_watch_ad"`
	AdResetInSeconds      int               `json:"ad_reset_in_seconds"`
	BonusRevealsRemaining int               `json:"bonus_reveals_remaining"`
	NewlyUnlockedUserIDs  []string          `json:"newly_unlocked_user_ids"`
	UnlockedCount         int               `json:"unlocked_count"`
	LikesYou              *LikesYouResponse `json:"likes_you,omitempty"`
}

type RevealLikeRequest struct {
	TargetUserID string `json:"target_user_id"`
}

type RevealLikeResponse struct {
	Status string           `json:"status"`
	Card   IncomingLikeCard `json:"card"`
	Source string           `json:"source"`
}

type MessageRequest struct {
	ID              string              `json:"id"`
	SenderUserID    string              `json:"sender_user_id"`
	SenderProfile   *DiscoveryCandidate `json:"sender_profile,omitempty"`
	RecipientUserID string              `json:"recipient_user_id"`
	Body            string              `json:"body"`
	Status          string              `json:"status"` // PENDING, ACCEPTED, DECLINED, BLOCKED
	CreatedAt       time.Time           `json:"created_at"`
	RespondedAt     *time.Time          `json:"responded_at,omitempty"`
}

type SendMessageRequestPayload struct {
	RecipientUserID string `json:"recipient_user_id"`
	Body            string `json:"body"`
}

const (
	TrialDuration                  = 30 * 24 * time.Hour
	TrialDiscoveryFreeBatchQuota   = 4
	TrialDiscoveryAdBatchQuota     = 4
	TrialDiscoveryMaxCycleProfiles = 12
	TrialDiscoveryMaxAdsPerCycle   = 2
	TrialDiscoveryCycleCooldown    = 2 * time.Hour
	PostTrialFreeQuota             = 2
	PostTrialBonusQuota            = 2

	// Backwards compatibility constants
	DiscoveryMessageFreeQuota        = 4
	DiscoveryMessageBonusQuota       = 4
	DiscoveryMessageCooldownDuration = 2 * time.Hour
)

type DiscoveryMessagingQuota struct {
	UserID                   string     `json:"user_id"`
	IsUnlimited              bool       `json:"is_unlimited"`

	// 30-day Trial status
	IsInTrial                bool       `json:"is_in_trial"`
	TrialStartedAt           time.Time  `json:"trial_started_at"`
	TrialEndsAt              time.Time  `json:"trial_ends_at"`
	TrialDaysRemaining       int        `json:"trial_days_remaining"`

	// Lock & Ad unlock status
	IsLocked                 bool       `json:"is_locked"`
	CanUnlockWithAd          bool       `json:"can_unlock_with_ad"`
	AdUnlocked               bool       `json:"ad_unlocked"`

	// Trial Discovery direct messaging limits (active when IsInTrial == true)
	TrialInitiationsRemaining int       `json:"trial_initiations_remaining"`
	TrialInitiationsAllowed   int       `json:"trial_initiations_allowed"`
	TrialDistinctMessaged     int       `json:"trial_distinct_messaged"`

	// Post-Trial global messaging limits (active when IsInTrial == false && !IsUnlimited)
	PostTrialFreeRemaining    int       `json:"post_trial_free_remaining"`
	PostTrialBonusRemaining   int       `json:"post_trial_bonus_remaining"`

	// Backwards-compatible fields for existing mobile components
	FreeQuota                int        `json:"free_quota"`
	FreeSlotsRemaining       int        `json:"free_slots_remaining"`
	DistinctProfilesMessaged int        `json:"distinct_profiles_messaged"`
	CooldownActive           bool       `json:"cooldown_active"`
	CooldownSecondsRemaining int        `json:"cooldown_seconds_remaining"`
	CooldownExpiresAt        *time.Time `json:"cooldown_expires_at,omitempty"`
	BonusSlotsRemaining      int        `json:"bonus_slots_remaining"`
}

type DiscoveryMessageQuotaState struct {
	UserID                   string
	TrialStartedAt           time.Time
	TrialEndsAt              time.Time
	TrialDiscoveryProfileIDs []string
	TrialDiscoveryAllowed    int
	TrialDiscoveryAdsWatched int
	PostTrialOutgoingCount   int
	PostTrialAdUnlocked      bool
	PostTrialBonusOutgoing   int
	CycleStartAt             time.Time
	FreeProfileIDs           []string
	CooldownExpiresAt        *time.Time
	AdUnlocked               bool
	BonusProfileIDs          []string
	UpdatedAt                time.Time
}

type UnlockAdQuotaRequest struct {
	RawQuery      string `json:"raw_query,omitempty"`
	TransactionID string `json:"transaction_id,omitempty"`
}

type UserFavourite struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	TargetUserID string    `json:"target_user_id"`
	CreatedAt    time.Time `json:"created_at"`
}

type FavouriteProfileCard struct {
	UserID      string    `json:"user_id"`
	DisplayName string    `json:"display_name"`
	Age         int       `json:"age"`
	Bio         string    `json:"bio"`
	PhotoURL    string    `json:"photo_url,omitempty"`
	AddedAt     time.Time `json:"added_at"`
}

type AddFavouriteRequest struct {
	TargetUserID string `json:"target_user_id"`
}

type AddFavouriteResponse struct {
	Success      bool      `json:"success"`
	TargetUserID string    `json:"target_user_id"`
	AddedAt      time.Time `json:"added_at"`
}

type RemoveFavouriteResponse struct {
	Success      bool   `json:"success"`
	TargetUserID string `json:"target_user_id"`
}

type ListFavouritesResponse struct {
	Count      int                    `json:"count"`
	Favourites []FavouriteProfileCard `json:"favourites"`
}

