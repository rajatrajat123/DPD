package discovery

import (
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
	ApproximateDistanceKm int         `json:"approximate_distance_km"` // Privacy-preserving integer km, never exact GPS
	IsPhotoVerified       bool        `json:"is_photo_verified"`
	CompatibilityScore    float64     `json:"compatibility_score"`
	Photos                []PhotoCard `json:"photos"`
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

