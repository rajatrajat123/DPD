package discovery

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/auradating/platform/backend/internal/identity"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrSelfSwipe         = errors.New("cannot swipe on yourself")
	ErrCandidateBlocked  = errors.New("interaction blocked between users")
	ErrCandidateInvalid  = errors.New("candidate account is inactive or not found")
	ErrMatchNotFound     = errors.New("match not found or access denied")
	ErrSwipeLimitReached         = errors.New("daily swipe limit reached; match reward or boost required")
	ErrRewindNotEntitled         = errors.New("rewind requires active Aura Plus or Aura Black membership")
	ErrNoSwipeToRewind           = errors.New("no eligible previous pass found to rewind")
	ErrSwipePhotoMinimumRequired = errors.New("cannot swipe: minimum 3 approved profile photos required")
	ErrBonusLikesVerifiedOnly    = errors.New("free like quota exhausted; bonus likes from rewarded ads can only be used on photo-verified profiles")
	ErrAgeVerificationRequired   = errors.New("mandatory 18+ age verification required")
	ErrBirthdateRequired         = errors.New("birthdate is required to verify adult status")
	ErrUnderageProhibited        = errors.New("underage access prohibited: must be at least 18 years old")
	ErrDiscoveryMessageQuotaLocked       = errors.New("discovery profile messaging quota exhausted; cooldown active")
	ErrDiscoveryMessageAdAlreadyUnlocked = errors.New("rewarded ad already unlocked for current cooldown window")
	ErrDiscoveryMessageCooldownNotActive = errors.New("cooldown is not active")
	ErrDiscoveryMessageAwaitingReply     = errors.New("cannot send another message until recipient replies")
	ErrDiscoveryMessageUsageLimitReached = errors.New("You've reached your usage limit. Please try again in 3 hours.")
	ErrDiscoveryMessageMaxAdsReached     = errors.New("maximum rewarded ad unlocks reached for current cycle")
	ErrSelfFavourite                     = errors.New("cannot add yourself to favourites")
)

type Repository interface {
	GetCandidates(ctx context.Context, actorID string, cursor string, limit int) (candidates []DiscoveryCandidate, nextCursor string, emptyReason string, err error)
	CountMatchingNearby(ctx context.Context, actorID string) (*MatchingSummaryResponse, error)
	CreateSwipe(ctx context.Context, actorID, targetID string, direction SwipeDirection, introNote string, correlationID string) (isMatch bool, match *Match, rewardGranted bool, err error)
	GetMatchByID(ctx context.Context, matchID, requesterID string) (*Match, error)
	ListMatches(ctx context.Context, userID string) ([]Match, error)
	Unmatch(ctx context.Context, matchID, requesterID string) error
	BlockUser(ctx context.Context, blockerID, blockedID, reason string) error
	IsBlocked(ctx context.Context, userA, userB string) (bool, error)
	GetSwipeAllowance(ctx context.Context, userID string) (remaining int, isUnlimited bool, err error)
	GetSwipeAllowanceDetail(ctx context.Context, userID string) (*SwipeAllowanceDetail, error)
	RecordAdReward(ctx context.Context, userID string, transactionID string, rewardAmount int) error
	RewindLastSwipe(ctx context.Context, actorID string) (*RewindResponse, error)
	SetUserCreatedAt(userID string, createdAt time.Time)
	SearchProfiles(ctx context.Context, actorID string, query string, limit int) ([]DiscoveryCandidate, error)
	GetIncomingLikes(ctx context.Context, userID string, limit, offset int) (likes []IncomingLikeCard, total int, err error)
	GetRevealedLikes(ctx context.Context, userID string) (map[string]string, error)
	RecordLikeReveal(ctx context.Context, userID, likedByUserID, source string) error
	GetUserLikesUnlockState(ctx context.Context, userID string) (*UserLikesUnlockState, error)
	SaveUserLikesUnlockState(ctx context.Context, state *UserLikesUnlockState) error
	CreateMessageRequest(ctx context.Context, mr *MessageRequest) error
	ListMessageRequests(ctx context.Context, userID, folder string) ([]MessageRequest, error)
	UpdateMessageRequestStatus(ctx context.Context, requestID, recipientID, status string) error
	GetDiscoveryMessageQuota(ctx context.Context, userID string) (*DiscoveryMessagingQuota, error)
	ConsumeDiscoveryMessageSlot(ctx context.Context, actorID, targetID string) error
	UnlockDiscoveryMessageAdBonus(ctx context.Context, actorID string) (*DiscoveryMessagingQuota, error)
	ConsumeChatOutgoingSlot(ctx context.Context, userID string) error
	CheckCanSendChat(ctx context.Context, senderID, recipientID string) error
	HasRecipientReplied(ctx context.Context, senderID, recipientID string) (bool, error)
	RecordRecipientReply(ctx context.Context, senderID, recipientID string) error
	AddFavourite(ctx context.Context, userID, targetUserID string) (*UserFavourite, error)
	RemoveFavourite(ctx context.Context, userID, targetUserID string) error
	ListFavourites(ctx context.Context, userID string) ([]FavouriteProfileCard, error)
	IsFavourite(ctx context.Context, userID, targetUserID string) (bool, error)
	GetLikesYouAdStatus(ctx context.Context, userID string) (*LikesYouAdStatus, error)
	UnlockLikesYouAdReward(ctx context.Context, userID string, transactionID string) (*LikesYouAdRewardResult, error)
}

type UserLikesUnlockState struct {
	UserID                string
	FreeRevealsUsed       int
	AdRevealsToday        int
	BonusRevealsRemaining int
	LastAdRevealAt        *time.Time
}

type cachedSummaryEntry struct {
	summary   *MatchingSummaryResponse
	expiresAt time.Time
}

const (
	IntroductoryDuration = 30 * 24 * time.Hour
	PostIntroWindowHours = 12 * time.Hour
	PostIntroQuota       = 15
)

// MemoryRepository provides thread-safe in-memory storage for unit tests and local mocks.
type MemoryRepository struct {
	mu             sync.RWMutex
	identRepo      identity.Repository
	swipes         map[string]*swipeRecord // key: actorID:targetID
	matches        map[string]*Match       // key: matchID
	matchByPair    map[string]string       // key: lowID:highID -> matchID
	blocks         map[string]struct{}     // key: blocker:blocked
	entitlements   map[string][]entitlementRecord
	boosts         map[string]float64 // key: userID -> boost multiplier
	outboxEvents   []outboxRecord
	summaryCache   map[string]*cachedSummaryEntry
	dailyLikeQuota   int                  // default 15
	rewardedLikes    map[string]int       // key: userID -> extra likes earned
	usedAdRewards    map[string]time.Time // key: transactionID -> verifiedAt (replay protection)
	userCreatedAt    map[string]time.Time // key: userID -> created_at
	revealedLikes    map[string]map[string]string
	likesUnlockState map[string]*UserLikesUnlockState
	messageRequests  map[string]*MessageRequest
	messagingQuotas  map[string]*DiscoveryMessageQuotaState
	repliedPairs      map[string]bool                 // key: senderID:recipientID
	favourites        map[string]map[string]time.Time // key: userID -> targetUserID -> addedAt
	likesYouAdRewards map[string][]time.Time          // key: userID -> slice of verifiedAt
}

type swipeRecord struct {
	ActorID   string
	TargetID  string
	Direction SwipeDirection
	IntroNote string
	CreatedAt time.Time
}

type entitlementRecord struct {
	Code      string
	ExpiresAt time.Time
	Source    string
}

type outboxRecord struct {
	EventType  string
	Payload    string
	OccurredAt time.Time
}

func NewMemoryRepository(identRepo identity.Repository) *MemoryRepository {
	return &MemoryRepository{
		identRepo:        identRepo,
		swipes:           make(map[string]*swipeRecord),
		matches:          make(map[string]*Match),
		matchByPair:      make(map[string]string),
		blocks:           make(map[string]struct{}),
		entitlements:     make(map[string][]entitlementRecord),
		boosts:           make(map[string]float64),
		summaryCache:     make(map[string]*cachedSummaryEntry),
		dailyLikeQuota:   PostIntroQuota,
		rewardedLikes:    make(map[string]int),
		usedAdRewards:    make(map[string]time.Time),
		userCreatedAt:    make(map[string]time.Time),
		revealedLikes:    make(map[string]map[string]string),
		likesUnlockState: make(map[string]*UserLikesUnlockState),
		messageRequests:  make(map[string]*MessageRequest),
		messagingQuotas:  make(map[string]*DiscoveryMessageQuotaState),
		repliedPairs:      make(map[string]bool),
		favourites:        make(map[string]map[string]time.Time),
		likesYouAdRewards: make(map[string][]time.Time),
	}
}

func (m *MemoryRepository) SetUserCreatedAt(userID string, createdAt time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.userCreatedAt[userID] = createdAt
}

func (m *MemoryRepository) SetDailyLikeQuota(quota int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if quota > 0 {
		m.dailyLikeQuota = quota
	}
}

func (m *MemoryRepository) RecordSwipeWithTime(ctx context.Context, actorID, targetID string, direction SwipeDirection, createdAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	swipeKey := fmt.Sprintf("%s:%s", actorID, targetID)
	m.swipes[swipeKey] = &swipeRecord{
		ActorID:   actorID,
		TargetID:  targetID,
		Direction: direction,
		CreatedAt: createdAt,
	}
	return nil
}

func (m *MemoryRepository) RecordAdReward(ctx context.Context, userID string, transactionID string, rewardAmount int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.usedAdRewards[transactionID]; exists {
		return ErrDuplicateSSVReward
	}

	m.usedAdRewards[transactionID] = time.Now().UTC()
	m.rewardedLikes[userID] += rewardAmount
	return nil
}

func (m *MemoryRepository) SetUserBoost(userID string, multiplier float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if multiplier <= 1.0 {
		delete(m.boosts, userID)
		return
	}
	m.boosts[userID] = multiplier
}

func (m *MemoryRepository) GrantTestEntitlement(userID, code string, expiresAt time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.entitlements[userID] = append(m.entitlements[userID], entitlementRecord{
		Code:      code,
		ExpiresAt: expiresAt,
		Source:    "TEST",
	})
}

func (m *MemoryRepository) IsBlocked(ctx context.Context, userA, userB string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	key1 := fmt.Sprintf("%s:%s", userA, userB)
	key2 := fmt.Sprintf("%s:%s", userB, userA)
	_, blocked1 := m.blocks[key1]
	_, blocked2 := m.blocks[key2]
	return blocked1 || blocked2, nil
}

func (m *MemoryRepository) BlockUser(ctx context.Context, blockerID, blockedID, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if blockerID == blockedID {
		return errors.New("cannot block yourself")
	}

	key := fmt.Sprintf("%s:%s", blockerID, blockedID)
	m.blocks[key] = struct{}{}

	// Invalidate any active match between them
	low, high := canonicalPair(blockerID, blockedID)
	pairKey := fmt.Sprintf("%s:%s", low, high)
	if matchID, ok := m.matchByPair[pairKey]; ok {
		if match, exists := m.matches[matchID]; exists {
			match.Status = MatchBlocked
			now := time.Now().UTC()
			match.UnmatchedAt = &now
		}
	}
	return nil
}

func (m *MemoryRepository) getSwipeAllowanceDetailLocked(userID string) *SwipeAllowanceDetail {
	now := time.Now().UTC()
	windowStart := now.Truncate(PostIntroWindowHours)
	windowEnd := windowStart.Add(PostIntroWindowHours)

	// 1. Check active entitlement (VIP, subscription, match reward)
	if list, ok := m.entitlements[userID]; ok {
		for _, e := range list {
			if e.Code == "UNLIMITED_SWIPES" && e.ExpiresAt.After(now) {
				return &SwipeAllowanceDetail{
					UserID:                userID,
					DailyQuota:            9999,
					RemainingRegularLikes: 9999,
					RemainingBonusLikes:   0,
					RemainingLikes:        9999,
					IsUnlimited:           true,
					IsIntroductory:        false,
					WindowStart:           windowStart,
					WindowResetAt:         windowEnd,
				}
			}
		}
	}

	// 2. Check 30-day Introductory Free Period from users.created_at
	var userCreatedAt time.Time
	if t, ok := m.userCreatedAt[userID]; ok {
		userCreatedAt = t
	} else if m.identRepo != nil {
		if u, err := m.identRepo.GetUserByID(context.Background(), userID); err == nil && u != nil {
			userCreatedAt = u.CreatedAt
		}
	}

	if !userCreatedAt.IsZero() && now.Sub(userCreatedAt) < IntroductoryDuration {
		return &SwipeAllowanceDetail{
			UserID:                userID,
			DailyQuota:            9999,
			RemainingRegularLikes: 9999,
			RemainingBonusLikes:   0,
			RemainingLikes:        9999,
			IsUnlimited:           true,
			IsIntroductory:        true,
			WindowStart:           windowStart,
			WindowResetAt:         windowEnd,
		}
	}

	// 3. Post-Introductory: 15 likes per fixed 12-hour window
	quota := PostIntroQuota
	if m.dailyLikeQuota > 0 {
		quota = m.dailyLikeQuota
	}

	// Count only LIKE and SUPER_SPARK swipes in the current fixed 12h window
	likeCount := 0
	for _, s := range m.swipes {
		if s.ActorID == userID && !s.CreatedAt.Before(windowStart) && (s.Direction == SwipeLike || s.Direction == SwipeSuperSpark) {
			likeCount++
		}
	}

	bonusEarned := m.rewardedLikes[userID]
	regularRemaining := quota - likeCount
	bonusRemaining := bonusEarned
	if regularRemaining < 0 {
		bonusUsed := -regularRemaining
		bonusRemaining = bonusEarned - bonusUsed
		if bonusRemaining < 0 {
			bonusRemaining = 0
		}
		regularRemaining = 0
	}
	totalRemaining := regularRemaining + bonusRemaining

	return &SwipeAllowanceDetail{
		UserID:                userID,
		DailyQuota:            quota,
		RemainingRegularLikes: regularRemaining,
		RemainingBonusLikes:   bonusRemaining,
		RemainingLikes:        totalRemaining,
		IsUnlimited:           false,
		IsIntroductory:        false,
		WindowStart:           windowStart,
		WindowResetAt:         windowEnd,
	}
}

func (m *MemoryRepository) getSwipeAllowanceLocked(userID string) (int, bool) {
	detail := m.getSwipeAllowanceDetailLocked(userID)
	return detail.RemainingLikes, detail.IsUnlimited
}

func (m *MemoryRepository) GetSwipeAllowance(ctx context.Context, userID string) (int, bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	d := m.getSwipeAllowanceDetailLocked(userID)
	return d.RemainingLikes, d.IsUnlimited, nil
}

func (m *MemoryRepository) GetSwipeAllowanceDetail(ctx context.Context, userID string) (*SwipeAllowanceDetail, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.getSwipeAllowanceDetailLocked(userID), nil
}

func violatesDealbreakers(actorProf *identity.Profile, actorPref *identity.DatingPreferences, targetProf *identity.Profile, targetPref *identity.DatingPreferences) bool {
	// 1. Non-smoker dealbreaker
	if actorPref.Dealbreakers.NonSmokerOnly {
		if targetProf.SmokingHabit != "" && targetProf.SmokingHabit != identity.SmokingNonSmoker {
			return true
		}
	}
	if targetPref != nil && targetPref.Dealbreakers.NonSmokerOnly {
		if actorProf.SmokingHabit != "" && actorProf.SmokingHabit != identity.SmokingNonSmoker {
			return true
		}
	}

	// 2. Photo verified dealbreaker
	if actorPref.Dealbreakers.RequireVerified || actorPref.VerifiedProfilesOnly {
		if !targetProf.IsPhotoVerified {
			return true
		}
	}
	if targetPref != nil && (targetPref.Dealbreakers.RequireVerified || targetPref.VerifiedProfilesOnly) {
		if !actorProf.IsPhotoVerified {
			return true
		}
	}

	// 3. Monogamous dealbreaker
	if actorPref.Dealbreakers.RequireMonogamous {
		if targetProf.RelationshipStructure != "" && targetProf.RelationshipStructure != identity.StructureMonogamous {
			return true
		}
	}
	if targetPref != nil && targetPref.Dealbreakers.RequireMonogamous {
		if actorProf.RelationshipStructure != "" && actorProf.RelationshipStructure != identity.StructureMonogamous {
			return true
		}
	}

	return false
}

func (m *MemoryRepository) GetCandidates(ctx context.Context, actorID string, cursor string, limit int) ([]DiscoveryCandidate, string, string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if limit <= 0 || limit > 50 {
		limit = 20
	}

	// 1. Fetch actor profile, preferences, and location
	actorProf, err := m.identRepo.GetProfile(ctx, actorID)
	if err != nil || actorProf == nil {
		now := time.Now().UTC()
		actorProf = &identity.Profile{
			UserID:                actorID,
			Birthdate:             now.AddDate(-25, 0, 0),
			GenderIdentities:      []string{"non_binary"},
			SexualOrientations:    []string{"queer"},
			RelationshipIntents:   []string{"dating"},
			RelationshipStructure: "MONOGAMOUS",
		}
	}
	actorPref, err := m.identRepo.GetPreferences(ctx, actorID)
	if err != nil || actorPref == nil {
		def := identity.DefaultDatingPreferences(actorID)
		actorPref = &def
	}
	actorLoc, _ := m.identRepo.GetLocation(ctx, actorID)

	actorAge := calculateAge(actorProf.Birthdate, time.Now().UTC())

	memIdent, ok := m.identRepo.(*identity.MemoryRepository)
	if !ok {
		return []DiscoveryCandidate{}, "", "NO_CANDIDATES_FOUND", nil
	}

	users := memIdent.ListAllUsers()

	var candidates []DiscoveryCandidate
	swipedCount, dealbreakerCount, distanceCount, ageCount := 0, 0, 0, 0

	for _, targetUser := range users {
		targetID := targetUser.ID
		if targetID == actorID || targetUser.Status != identity.StatusActive {
			continue
		}

		// Check blocks
		key1 := fmt.Sprintf("%s:%s", actorID, targetID)
		key2 := fmt.Sprintf("%s:%s", targetID, actorID)
		if _, b1 := m.blocks[key1]; b1 {
			continue
		}
		if _, b2 := m.blocks[key2]; b2 {
			continue
		}

		// Check already swiped
		swipeKey := fmt.Sprintf("%s:%s", actorID, targetID)
		if _, alreadySwiped := m.swipes[swipeKey]; alreadySwiped {
			swipedCount++
			continue
		}

		targetProf, err := m.identRepo.GetProfile(ctx, targetID)
		if err != nil || targetProf.IncognitoEnabled {
			continue
		}

		targetAge := calculateAge(targetProf.Birthdate, time.Now().UTC())
		if targetAge < 18 {
			continue
		}

		// Reciprocal age compatibility check
		if targetAge < actorPref.MinAge || targetAge > actorPref.MaxAge {
			ageCount++
			continue
		}
		targetPref, err := m.identRepo.GetPreferences(ctx, targetID)
		if err == nil && targetPref != nil {
			if actorAge < targetPref.MinAge || actorAge > targetPref.MaxAge {
				ageCount++
				continue
			}
			// Photo verification & dealbreakers check
			if violatesDealbreakers(actorProf, actorPref, targetProf, targetPref) {
				dealbreakerCount++
				continue
			}
			// Reciprocal gender preference compatibility
			if len(actorPref.PreferredGenders) > 0 && !hasOverlap(actorPref.PreferredGenders, targetProf.GenderIdentities) {
				dealbreakerCount++
				continue
			}
			if len(targetPref.PreferredGenders) > 0 && !hasOverlap(targetPref.PreferredGenders, actorProf.GenderIdentities) {
				dealbreakerCount++
				continue
			}
		}

		// Height check
		if actorPref.MinHeightCm != nil && targetProf.HeightCm != nil && *targetProf.HeightCm < *actorPref.MinHeightCm {
			continue
		}
		if actorPref.MaxHeightCm != nil && targetProf.HeightCm != nil && *targetProf.HeightCm > *actorPref.MaxHeightCm {
			continue
		}

		// Weight check
		if actorPref.MinWeightKg != nil && targetProf.WeightKg != nil && *targetProf.WeightKg < *actorPref.MinWeightKg {
			continue
		}
		if actorPref.MaxWeightKg != nil && targetProf.WeightKg != nil && *targetProf.WeightKg > *actorPref.MaxWeightKg {
			continue
		}

		// Sexual orientation preferences
		if len(actorPref.PreferredOrientations) > 0 && !hasOverlap(actorPref.PreferredOrientations, targetProf.SexualOrientations) {
			continue
		}

		// Relationship intents preferences
		if len(actorPref.PreferredIntents) > 0 && !hasOverlap(actorPref.PreferredIntents, targetProf.RelationshipIntents) {
			continue
		}

		// Distance check
		distanceKm := 10.0 // Default reasonable distance if coords missing
		if actorLoc != nil {
			targetLoc, _ := m.identRepo.GetLocation(ctx, targetID)
			if targetLoc != nil {
				distanceKm = haversineDistance(actorLoc.Latitude, actorLoc.Longitude, targetLoc.Latitude, targetLoc.Longitude)
				if distanceKm > float64(actorPref.MaxDistanceKm) {
					distanceCount++
					continue
				}
			}
		}

		// Privacy fuzzing: floor at 1 km, round to whole km, never raw GPS
		displayDist := int(math.Ceil(distanceKm))
		if displayDist < 1 {
			displayDist = 1
		}

		relevance := CalculateRelevanceScore(actorProf, actorPref, targetProf, distanceKm)
		if mult, ok := m.boosts[targetID]; ok && mult > 1.0 {
			relevance = CalculateBoostedScore(relevance, mult)
		}

		// Filter sensitive fields by visibility
		pronouns := targetProf.Pronouns
		if targetProf.VisibilitySettings.Pronouns == identity.VisibilityHidden {
			pronouns = nil
		}
		genders := targetProf.GenderIdentities
		if targetProf.VisibilitySettings.GenderIdentity == identity.VisibilityHidden {
			genders = nil
		}
		orientations := targetProf.SexualOrientations
		if targetProf.VisibilitySettings.SexualOrientation == identity.VisibilityHidden {
			orientations = nil
		}
		var candHeight *int
		if targetProf.VisibilitySettings.Height != identity.VisibilityHidden {
			candHeight = targetProf.HeightCm
		}
		var candWeight *int
		if targetProf.VisibilitySettings.Weight != identity.VisibilityHidden {
			candWeight = targetProf.WeightKg
		}

		candidates = append(candidates, DiscoveryCandidate{
			UserID:                targetID,
			DisplayName:           targetProf.DisplayName,
			Age:                   targetAge,
			Bio:                   targetProf.Bio,
			Pronouns:              pronouns,
			GenderIdentities:      genders,
			SexualOrientations:    orientations,
			RelationshipIntents:   targetProf.RelationshipIntents,
			RelationshipStructure: string(targetProf.RelationshipStructure),
			SmokingHabit:          string(targetProf.SmokingHabit),
			DrinkingHabit:         string(targetProf.DrinkingHabit),
			HeightCm:              candHeight,
			WeightKg:              candWeight,
			ApproximateDistanceKm: displayDist,
			IsPhotoVerified:       targetProf.IsPhotoVerified,
			CompatibilityScore:    relevance,
			Photos:                []PhotoCard{},
		})
	}

	// Sort by relevance score descending with UserID as stable tie-breaker
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].CompatibilityScore != candidates[j].CompatibilityScore {
			return candidates[i].CompatibilityScore > candidates[j].CompatibilityScore
		}
		return candidates[i].UserID < candidates[j].UserID
	})

	startIndex := 0
	if cursor != "" {
		if curData, off, _ := decodeCandidateCursor(cursor); curData != nil {
			for idx, c := range candidates {
				if c.UserID == curData.id {
					startIndex = idx + 1
					break
				}
			}
		} else if off > 0 && off < len(candidates) {
			startIndex = off
		} else {
			for idx, c := range candidates {
				if c.UserID == cursor {
					startIndex = idx + 1
					break
				}
			}
		}
	}

	if startIndex > len(candidates) {
		startIndex = len(candidates)
	}
	remaining := candidates[startIndex:]

	var nextCursor string
	if len(remaining) > limit {
		nextCursor = remaining[limit-1].UserID
		candidates = remaining[:limit]
	} else {
		candidates = remaining
	}

	var emptyReason string
	if len(candidates) == 0 {
		if cursor == "" {
			switch {
			case swipedCount > 0 && dealbreakerCount == 0 && distanceCount == 0 && ageCount == 0:
				emptyReason = "ALL_CANDIDATES_SWIPED"
			case dealbreakerCount > 0:
				emptyReason = "DEALBREAKERS_EXCLUDED_ALL"
			case distanceCount > 0:
				emptyReason = "DISTANCE_RADIUS_EXHAUSTED"
			case ageCount > 0:
				emptyReason = "AGE_RANGE_TOO_NARROW"
			default:
				emptyReason = "NO_CANDIDATES_FOUND"
			}
		}
	}

	return candidates, nextCursor, emptyReason, nil
}

func (m *MemoryRepository) CountMatchingNearby(ctx context.Context, actorID string) (*MatchingSummaryResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	if entry, ok := m.summaryCache[actorID]; ok && now.Before(entry.expiresAt) {
		copied := *entry.summary
		return &copied, nil
	}

	actorProf, err := m.identRepo.GetProfile(ctx, actorID)
	if err != nil || actorProf == nil {
		now := time.Now().UTC()
		actorProf = &identity.Profile{
			UserID:                actorID,
			Birthdate:             now.AddDate(-25, 0, 0),
			GenderIdentities:      []string{"non_binary"},
			SexualOrientations:    []string{"queer"},
			RelationshipIntents:   []string{"dating"},
			RelationshipStructure: "MONOGAMOUS",
		}
	}
	actorPref, err := m.identRepo.GetPreferences(ctx, actorID)
	if err != nil || actorPref == nil {
		def := identity.DefaultDatingPreferences(actorID)
		actorPref = &def
	}
	actorLoc, _ := m.identRepo.GetLocation(ctx, actorID)
	actorAge := calculateAge(actorProf.Birthdate, now)

	memIdent, ok := m.identRepo.(*identity.MemoryRepository)
	if !ok {
		return &MatchingSummaryResponse{
			Count:               0,
			DisplayText:         "No people match your preferences nearby.",
			PrivacyFloorApplied: false,
			CachedAt:            now,
			ExpiresAt:           now.Add(5 * time.Minute),
		}, nil
	}

	users := memIdent.ListAllUsers()
	matchingCount := 0

	for _, targetUser := range users {
		targetID := targetUser.ID
		if targetID == actorID || targetUser.Status != identity.StatusActive {
			continue
		}

		key1 := fmt.Sprintf("%s:%s", actorID, targetID)
		key2 := fmt.Sprintf("%s:%s", targetID, actorID)
		if _, b1 := m.blocks[key1]; b1 {
			continue
		}
		if _, b2 := m.blocks[key2]; b2 {
			continue
		}

		targetProf, err := m.identRepo.GetProfile(ctx, targetID)
		if err != nil || targetProf.IncognitoEnabled {
			continue
		}

		targetAge := calculateAge(targetProf.Birthdate, now)
		if targetAge < 18 || targetAge < actorPref.MinAge || targetAge > actorPref.MaxAge {
			continue
		}

		targetPref, err := m.identRepo.GetPreferences(ctx, targetID)
		if err == nil && targetPref != nil {
			if actorAge < targetPref.MinAge || actorAge > targetPref.MaxAge {
				continue
			}
			if len(actorPref.PreferredGenders) > 0 && !hasOverlap(actorPref.PreferredGenders, targetProf.GenderIdentities) {
				continue
			}
			if len(targetPref.PreferredGenders) > 0 && !hasOverlap(targetPref.PreferredGenders, actorProf.GenderIdentities) {
				continue
			}
			if violatesDealbreakers(actorProf, actorPref, targetProf, targetPref) {
				continue
			}
		}

		if actorLoc != nil {
			targetLoc, _ := m.identRepo.GetLocation(ctx, targetID)
			if targetLoc != nil {
				dist := haversineDistance(actorLoc.Latitude, actorLoc.Longitude, targetLoc.Latitude, targetLoc.Longitude)
				if dist > float64(actorPref.MaxDistanceKm) {
					continue
				}
			}
		}

		matchingCount++
	}

	resp := &MatchingSummaryResponse{
		CachedAt:  now,
		ExpiresAt: now.Add(5 * time.Minute),
	}

	if matchingCount == 0 {
		resp.Count = 0
		resp.DisplayText = "No people match your preferences nearby."
		resp.PrivacyFloorApplied = false
	} else if matchingCount < 5 {
		resp.Count = 0
		resp.DisplayText = "Fewer than 5 people match your preferences nearby."
		resp.PrivacyFloorApplied = true
	} else {
		resp.Count = matchingCount
		resp.DisplayText = fmt.Sprintf("%d people match your preferences nearby.", matchingCount)
		resp.PrivacyFloorApplied = false
	}

	m.summaryCache[actorID] = &cachedSummaryEntry{
		summary:   resp,
		expiresAt: resp.ExpiresAt,
	}

	copied := *resp
	return &copied, nil
}

func (m *MemoryRepository) CreateSwipe(ctx context.Context, actorID, targetID string, direction SwipeDirection, introNote string, correlationID string) (bool, *Match, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if actorID == targetID {
		return false, nil, false, ErrSelfSwipe
	}

	// Check blocks
	key1 := fmt.Sprintf("%s:%s", actorID, targetID)
	key2 := fmt.Sprintf("%s:%s", targetID, actorID)
	if _, b1 := m.blocks[key1]; b1 {
		return false, nil, false, ErrCandidateBlocked
	}
	if _, b2 := m.blocks[key2]; b2 {
		return false, nil, false, ErrCandidateBlocked
	}

	swipeKey := fmt.Sprintf("%s:%s", actorID, targetID)
	if existing, ok := m.swipes[swipeKey]; ok {
		// Idempotent: return existing match if formed
		low, high := canonicalPair(actorID, targetID)
		pairKey := fmt.Sprintf("%s:%s", low, high)
		if matchID, hasMatch := m.matchByPair[pairKey]; hasMatch {
			return true, m.matches[matchID], false, nil
		}
		_ = existing
		return false, nil, false, nil
	}

	// Enforce daily quota atomically for LIKE and SUPER_SPARK
	if direction != SwipePass {
		allowance := m.getSwipeAllowanceDetailLocked(actorID)
		if !allowance.IsUnlimited {
			if allowance.RemainingRegularLikes <= 0 {
				if allowance.RemainingBonusLikes <= 0 {
					return false, nil, false, ErrSwipeLimitReached
				}
				// Bonus likes from rewarded ads can only be used on photo-verified profiles
				targetProf, err := m.identRepo.GetProfile(ctx, targetID)
				if err != nil || targetProf == nil || !targetProf.IsPhotoVerified {
					return false, nil, false, ErrBonusLikesVerifiedOnly
				}
			}
		}
	}

	// Enforce Discovery messaging quota if initiating a message with an Intro Note
	if strings.TrimSpace(introNote) != "" {
		if err := m.consumeDiscoveryMessageSlotLocked(actorID, targetID); err != nil {
			return false, nil, false, err
		}
	}

	now := time.Now().UTC()
	m.swipes[swipeKey] = &swipeRecord{
		ActorID:   actorID,
		TargetID:  targetID,
		Direction: direction,
		IntroNote: introNote,
		CreatedAt: now,
	}

	if strings.TrimSpace(introNote) != "" {
		mrID := fmt.Sprintf("mr-%d", now.UnixNano())
		m.messageRequests[mrID] = &MessageRequest{
			ID:              mrID,
			SenderUserID:    actorID,
			RecipientUserID: targetID,
			Body:            strings.TrimSpace(introNote),
			Status:          "PENDING",
			CreatedAt:       now,
		}
	}

	// If direction is PASS, no match can occur
	if direction == SwipePass {
		return false, nil, false, nil
	}

	// Check reciprocal like
	reciprocalKey := fmt.Sprintf("%s:%s", targetID, actorID)
	reciprocal, hasReciprocal := m.swipes[reciprocalKey]
	if hasReciprocal && (reciprocal.Direction == SwipeLike || reciprocal.Direction == SwipeSuperSpark) {
		// Form mutual match!
		low, high := canonicalPair(actorID, targetID)
		pairKey := fmt.Sprintf("%s:%s", low, high)

		matchID := fmt.Sprintf("match-%d", now.UnixNano())
		match := &Match{
			ID:         matchID,
			UserLowID:  low,
			UserHighID: high,
			Status:     MatchActive,
			MatchedAt:  now,
		}
		m.matches[matchID] = match
		m.matchByPair[pairKey] = matchID

		// Record transactional outbox event
		payloadBytes, _ := json.Marshal(map[string]any{
			"match_id":    matchID,
			"user_low_id": low,
			"user_high_id": high,
			"matched_at":  now,
		})
		m.outboxEvents = append(m.outboxEvents, outboxRecord{
			EventType:  "match.created.v1",
			Payload:    string(payloadBytes),
			OccurredAt: now,
		})

		// Grant match-triggered reward: 24h unlimited swipes
		rewardExpires := now.Add(24 * time.Hour)
		m.entitlements[actorID] = append(m.entitlements[actorID], entitlementRecord{
			Code:      "UNLIMITED_SWIPES",
			ExpiresAt: rewardExpires,
			Source:    "MATCH_REWARD",
		})
		m.entitlements[targetID] = append(m.entitlements[targetID], entitlementRecord{
			Code:      "UNLIMITED_SWIPES",
			ExpiresAt: rewardExpires,
			Source:    "MATCH_REWARD",
		})

		return true, match, true, nil
	}

	return false, nil, false, nil
}

func (m *MemoryRepository) GetMatchByID(ctx context.Context, matchID, requesterID string) (*Match, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	match, ok := m.matches[matchID]
	if !ok || match.Status != MatchActive {
		return nil, ErrMatchNotFound
	}
	if requesterID != "" && match.UserLowID != requesterID && match.UserHighID != requesterID {
		return nil, ErrMatchNotFound
	}
	cloned := *match
	return &cloned, nil
}

func (m *MemoryRepository) ListMatches(ctx context.Context, userID string) ([]Match, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var results []Match
	for _, match := range m.matches {
		if (match.UserLowID == userID || match.UserHighID == userID) && match.Status == MatchActive {
			results = append(results, *match)
		}
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].MatchedAt.After(results[j].MatchedAt)
	})
	return results, nil
}

func (m *MemoryRepository) Unmatch(ctx context.Context, matchID, requesterID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	match, ok := m.matches[matchID]
	if !ok {
		return ErrMatchNotFound
	}
	if requesterID != "" && match.UserLowID != requesterID && match.UserHighID != requesterID {
		return ErrMatchNotFound
	}

	match.Status = MatchUnmatched
	now := time.Now().UTC()
	match.UnmatchedAt = &now
	return nil
}

func (m *MemoryRepository) RewindLastSwipe(ctx context.Context, actorID string) (*RewindResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	hasEntitlement := false
	if list, ok := m.entitlements[actorID]; ok {
		for _, e := range list {
			if (e.Code == "REWIND" || e.Code == "UNLIMITED_SWIPES") && e.ExpiresAt.After(now) {
				hasEntitlement = true
				break
			}
		}
	}
	if !hasEntitlement {
		return nil, ErrRewindNotEntitled
	}

	var latestKey string
	var latestSwipe *swipeRecord
	for key, s := range m.swipes {
		if s.ActorID == actorID {
			if latestSwipe == nil || s.CreatedAt.After(latestSwipe.CreatedAt) {
				latestSwipe = s
				latestKey = key
			}
		}
	}

	if latestSwipe == nil || latestSwipe.Direction != SwipePass {
		return nil, ErrNoSwipeToRewind
	}

	restoredID := latestSwipe.TargetID
	delete(m.swipes, latestKey)

	return &RewindResponse{
		Success:        true,
		RestoredUserID: restoredID,
	}, nil
}

func (m *MemoryRepository) SearchProfiles(ctx context.Context, actorID string, query string, limit int) ([]DiscoveryCandidate, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if limit <= 0 || limit > 50 {
		limit = 20
	}

	q := strings.TrimSpace(strings.ToLower(query))

	memIdent, ok := m.identRepo.(*identity.MemoryRepository)
	if !ok {
		return []DiscoveryCandidate{}, nil
	}

	actorLoc, _ := m.identRepo.GetLocation(ctx, actorID)
	users := memIdent.ListAllUsers()

	var results []DiscoveryCandidate
	for _, targetUser := range users {
		targetID := targetUser.ID
		if targetID == actorID || targetUser.Status != identity.StatusActive {
			continue
		}

		// Blocks
		key1 := fmt.Sprintf("%s:%s", actorID, targetID)
		key2 := fmt.Sprintf("%s:%s", targetID, actorID)
		if _, b1 := m.blocks[key1]; b1 {
			continue
		}
		if _, b2 := m.blocks[key2]; b2 {
			continue
		}

		targetProf, err := m.identRepo.GetProfile(ctx, targetID)
		if err != nil || targetProf == nil {
			continue
		}

		// Privacy & Incognito
		if targetProf.IncognitoEnabled {
			continue
		}

		// Must be 18+
		targetAge := calculateAge(targetProf.Birthdate, time.Now().UTC())
		if targetAge < 18 {
			continue
		}

		// Match query against display_name, bio, gender_identities, sexual_orientations
		if q != "" {
			matched := false
			if strings.Contains(strings.ToLower(targetProf.DisplayName), q) {
				matched = true
			} else if strings.Contains(strings.ToLower(targetProf.Bio), q) {
				matched = true
			} else {
				for _, g := range targetProf.GenderIdentities {
					if strings.Contains(strings.ToLower(g), q) {
						matched = true
						break
					}
				}
				if !matched {
					for _, s := range targetProf.SexualOrientations {
						if strings.Contains(strings.ToLower(s), q) {
							matched = true
							break
						}
					}
				}
			}
			if !matched {
				continue
			}
		}

		// Calculate approximate distance
		targetLoc, _ := m.identRepo.GetLocation(ctx, targetID)
		approxKm := 1
		if actorLoc != nil && targetLoc != nil {
			dist := haversineDistance(actorLoc.Latitude, actorLoc.Longitude, targetLoc.Latitude, targetLoc.Longitude)
			approxKm = int(math.Round(dist))
			if approxKm < 1 {
				approxKm = 1
			}
		}

		cand := DiscoveryCandidate{
			UserID:                targetID,
			DisplayName:           targetProf.DisplayName,
			Age:                   targetAge,
			Bio:                   targetProf.Bio,
			Pronouns:              targetProf.Pronouns,
			GenderIdentities:      targetProf.GenderIdentities,
			SexualOrientations:    targetProf.SexualOrientations,
			RelationshipIntents:   targetProf.RelationshipIntents,
			RelationshipStructure: string(targetProf.RelationshipStructure),
			IsPhotoVerified:       targetProf.IsPhotoVerified,
			SmokingHabit:          string(targetProf.SmokingHabit),
			DrinkingHabit:         string(targetProf.DrinkingHabit),
			ApproximateDistanceKm: approxKm,
			Photos:                []PhotoCard{},
		}

		// Visibility settings
		if targetProf.VisibilitySettings.Pronouns == identity.VisibilityHidden {
			cand.Pronouns = nil
		}
		if targetProf.VisibilitySettings.GenderIdentity == identity.VisibilityHidden {
			cand.GenderIdentities = nil
		}
		if targetProf.VisibilitySettings.SexualOrientation == identity.VisibilityHidden {
			cand.SexualOrientations = nil
		}

		results = append(results, cand)
		if len(results) >= limit {
			break
		}
	}

	return results, nil
}

func (m *MemoryRepository) GetIncomingLikes(ctx context.Context, userID string, limit, offset int) ([]IncomingLikeCard, int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var incoming []IncomingLikeCard
	for _, s := range m.swipes {
		if s.TargetID == userID && (s.Direction == SwipeLike || s.Direction == SwipeSuperSpark) {
			k1 := fmt.Sprintf("%s:%s", userID, s.ActorID)
			k2 := fmt.Sprintf("%s:%s", s.ActorID, userID)
			if _, b1 := m.blocks[k1]; b1 {
				continue
			}
			if _, b2 := m.blocks[k2]; b2 {
				continue
			}

			prof, err := m.identRepo.GetProfile(ctx, s.ActorID)
			if err != nil || prof == nil {
				continue
			}

			age := calculateAge(prof.Birthdate, time.Now().UTC())
			isRevealed := false
			if revs, ok := m.revealedLikes[userID]; ok {
				if _, rOk := revs[s.ActorID]; rOk {
					isRevealed = true
				}
			}

			distKm := 1
			actorLoc, _ := m.identRepo.GetLocation(ctx, s.ActorID)
			targetLoc, _ := m.identRepo.GetLocation(ctx, userID)
			if actorLoc != nil && targetLoc != nil && (actorLoc.Latitude != 0 || actorLoc.Longitude != 0) && (targetLoc.Latitude != 0 || targetLoc.Longitude != 0) {
				calculated := int(math.Ceil(haversineDistance(actorLoc.Latitude, actorLoc.Longitude, targetLoc.Latitude, targetLoc.Longitude)))
				if calculated > 0 {
					distKm = calculated
				}
			}

			card := IncomingLikeCard{
				UserID:                s.ActorID,
				DisplayName:           prof.DisplayName,
				Age:                   age,
				Bio:                   prof.Bio,
				ApproximateDistanceKm: distKm,
				IsPhotoVerified:       prof.IsPhotoVerified,
				IsRevealed:            isRevealed,
				LikedAt:               s.CreatedAt,
				Photos:                []PhotoCard{},
				InteractionType:       string(s.Direction),
				IsSuperLike:           s.Direction == SwipeSuperSpark,
			}
			incoming = append(incoming, card)
		}
	}

	sort.Slice(incoming, func(i, j int) bool {
		if incoming[i].IsSuperLike != incoming[j].IsSuperLike {
			return incoming[i].IsSuperLike
		}
		return incoming[i].LikedAt.After(incoming[j].LikedAt)
	})

	total := len(incoming)
	if offset >= total {
		return []IncomingLikeCard{}, total, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return incoming[offset:end], total, nil
}

func (m *MemoryRepository) GetRevealedLikes(_ context.Context, userID string) (map[string]string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make(map[string]string)
	if revs, ok := m.revealedLikes[userID]; ok {
		for k, v := range revs {
			out[k] = v
		}
	}
	return out, nil
}

func (m *MemoryRepository) RecordLikeReveal(_ context.Context, userID, likedByUserID, source string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.revealedLikes[userID]; !ok {
		m.revealedLikes[userID] = make(map[string]string)
	}
	m.revealedLikes[userID][likedByUserID] = source
	return nil
}

func (m *MemoryRepository) GetUserLikesUnlockState(_ context.Context, userID string) (*UserLikesUnlockState, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	st, ok := m.likesUnlockState[userID]
	if !ok {
		return &UserLikesUnlockState{
			UserID:                userID,
			FreeRevealsUsed:       0,
			AdRevealsToday:        0,
			BonusRevealsRemaining: 0,
		}, nil
	}
	cloned := *st
	return &cloned, nil
}

func (m *MemoryRepository) SaveUserLikesUnlockState(_ context.Context, state *UserLikesUnlockState) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cloned := *state
	m.likesUnlockState[state.UserID] = &cloned
	return nil
}

func (m *MemoryRepository) GetLikesYouAdStatus(_ context.Context, userID string) (*LikesYouAdStatus, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now().UTC()
	cutoff := now.Add(-LikesYouAdWindowHours)

	var active []time.Time
	for _, t := range m.likesYouAdRewards[userID] {
		if t.After(cutoff) {
			active = append(active, t)
		}
	}

	adsCount := len(active)
	canWatch := adsCount < LikesYouMaxAdsPerWindow
	resetSec := 0

	if !canWatch && len(active) > 0 {
		earliest := active[0]
		for _, t := range active {
			if t.Before(earliest) {
				earliest = t
			}
		}
		rem := earliest.Add(LikesYouAdWindowHours).Sub(now)
		resetSec = int(math.Ceil(rem.Seconds()))
		if resetSec < 0 {
			resetSec = 0
		}
	}

	return &LikesYouAdStatus{
		AdsWatchedInWindow:       adsCount,
		MaxAdsPerWindow:          LikesYouMaxAdsPerWindow,
		CanWatchAd:               canWatch,
		AdResetInSeconds:         resetSec,
		ProfilesUnlockedInWindow: adsCount * LikesYouProfilesPerAd,
		MaxProfilesPerWindow:     LikesYouMaxProfilesPerWindow,
	}, nil
}

func (m *MemoryRepository) UnlockLikesYouAdReward(ctx context.Context, userID string, transactionID string) (*LikesYouAdRewardResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.usedAdRewards[transactionID]; exists {
		return nil, ErrDuplicateSSVReward
	}

	now := time.Now().UTC()
	cutoff := now.Add(-LikesYouAdWindowHours)

	var active []time.Time
	for _, t := range m.likesYouAdRewards[userID] {
		if t.After(cutoff) {
			active = append(active, t)
		}
	}

	if len(active) >= LikesYouMaxAdsPerWindow {
		earliest := active[0]
		for _, t := range active {
			if t.Before(earliest) {
				earliest = t
			}
		}
		rem := earliest.Add(LikesYouAdWindowHours).Sub(now)
		resetSec := int(math.Ceil(rem.Seconds()))
		if resetSec < 0 {
			resetSec = 0
		}
		return nil, ErrLikesYouAdLimitReached
	}

	m.usedAdRewards[transactionID] = now
	active = append(active, now)
	m.likesYouAdRewards[userID] = active

	// Find up to 2 unrevealed incoming likes
	type candidateLike struct {
		actorID     string
		isSuperLike bool
		likedAt     time.Time
	}

	var unrevealed []candidateLike
	for _, s := range m.swipes {
		if s.TargetID == userID && (s.Direction == SwipeLike || s.Direction == SwipeSuperSpark) {
			k1 := fmt.Sprintf("%s:%s", userID, s.ActorID)
			k2 := fmt.Sprintf("%s:%s", s.ActorID, userID)
			if _, b1 := m.blocks[k1]; b1 {
				continue
			}
			if _, b2 := m.blocks[k2]; b2 {
				continue
			}

			isRev := false
			if revs, ok := m.revealedLikes[userID]; ok {
				if _, rOk := revs[s.ActorID]; rOk {
					isRev = true
				}
			}
			if !isRev {
				unrevealed = append(unrevealed, candidateLike{
					actorID:     s.ActorID,
					isSuperLike: s.Direction == SwipeSuperSpark,
					likedAt:     s.CreatedAt,
				})
			}
		}
	}

	// Order by Super Likes first, then newest
	sort.Slice(unrevealed, func(i, j int) bool {
		if unrevealed[i].isSuperLike != unrevealed[j].isSuperLike {
			return unrevealed[i].isSuperLike
		}
		return unrevealed[i].likedAt.After(unrevealed[j].likedAt)
	})

	if m.revealedLikes[userID] == nil {
		m.revealedLikes[userID] = make(map[string]string)
	}

	var newlyUnlocked []string
	toUnlock := LikesYouProfilesPerAd
	if len(unrevealed) < toUnlock {
		toUnlock = len(unrevealed)
	}

	for i := 0; i < toUnlock; i++ {
		actorID := unrevealed[i].actorID
		m.revealedLikes[userID][actorID] = "REWARDED_AD"
		newlyUnlocked = append(newlyUnlocked, actorID)
	}

	remainder := LikesYouProfilesPerAd - len(newlyUnlocked)
	if remainder < 0 {
		remainder = 0
	}

	st, ok := m.likesUnlockState[userID]
	if !ok {
		st = &UserLikesUnlockState{
			UserID: userID,
		}
	}
	st.BonusRevealsRemaining += remainder
	st.AdRevealsToday++
	st.LastAdRevealAt = &now
	m.likesUnlockState[userID] = st

	newCount := len(active)
	canWatch := newCount < LikesYouMaxAdsPerWindow
	resetSec := 0
	if !canWatch && len(active) > 0 {
		earliest := active[0]
		for _, t := range active {
			if t.Before(earliest) {
				earliest = t
			}
		}
		rem := earliest.Add(LikesYouAdWindowHours).Sub(now)
		resetSec = int(math.Ceil(rem.Seconds()))
		if resetSec < 0 {
			resetSec = 0
		}
	}

	return &LikesYouAdRewardResult{
		AdsWatchedInWindow:    newCount,
		MaxAdsPerWindow:       LikesYouMaxAdsPerWindow,
		CanWatchAd:            canWatch,
		AdResetInSeconds:      resetSec,
		NewlyUnlockedUserIDs:  newlyUnlocked,
		BonusRevealsRemaining: st.BonusRevealsRemaining,
	}, nil
}

func (m *MemoryRepository) CreateMessageRequest(_ context.Context, req *MessageRequest) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cloned := *req
	m.messageRequests[req.ID] = &cloned
	return nil
}

func (m *MemoryRepository) ListMessageRequests(ctx context.Context, userID string, folder string) ([]MessageRequest, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var res []MessageRequest
	for _, req := range m.messageRequests {
		if folder == "sent" && req.SenderUserID == userID {
			res = append(res, *req)
		} else if folder != "sent" && req.RecipientUserID == userID {
			cloned := *req
			if prof, err := m.identRepo.GetProfile(ctx, req.SenderUserID); err == nil && prof != nil {
				age := calculateAge(prof.Birthdate, time.Now().UTC())
				cloned.SenderProfile = &DiscoveryCandidate{
					UserID:          req.SenderUserID,
					DisplayName:     prof.DisplayName,
					Age:             age,
					Bio:             prof.Bio,
					IsPhotoVerified: prof.IsPhotoVerified,
					Photos:          []PhotoCard{},
				}
			}
			res = append(res, cloned)
		}
	}
	sort.Slice(res, func(i, j int) bool {
		return res[i].CreatedAt.After(res[j].CreatedAt)
	})
	return res, nil
}

func (m *MemoryRepository) UpdateMessageRequestStatus(_ context.Context, requestID, recipientID, status string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	req, ok := m.messageRequests[requestID]
	if !ok || req.RecipientUserID != recipientID {
		return errors.New("message request not found")
	}
	req.Status = status
	now := time.Now().UTC()
	req.RespondedAt = &now
	return nil
}

func (m *MemoryRepository) isUserUnlimited(actorID string) bool {
	now := time.Now().UTC()
	for _, e := range m.entitlements[actorID] {
		if (e.Code == "VIP_SUBSCRIPTION" || e.Code == "UNLIMITED_MESSAGING" || (e.Code == "UNLIMITED_SWIPES" && e.Source != "MATCH_REWARD")) && e.ExpiresAt.After(now) {
			return true
		}
	}
	return false
}

func evaluateMessageQuotaState(state *DiscoveryMessageQuotaState, now time.Time, isUnlimited bool) *DiscoveryMessagingQuota {
	if isUnlimited {
		return &DiscoveryMessagingQuota{
			UserID:                    state.UserID,
			IsUnlimited:               true,
			IsInTrial:                 false,
			TrialStartedAt:            state.TrialStartedAt,
			TrialEndsAt:               state.TrialEndsAt,
			TrialDaysRemaining:        0,
			IsLocked:                  false,
			CanUnlockWithAd:           false,
			AdUnlocked:                false,
			TrialInitiationsRemaining: 0,
			TrialInitiationsAllowed:   0,
			TrialDistinctMessaged:     0,
			PostTrialFreeRemaining:    0,
			PostTrialBonusRemaining:   0,
			FreeQuota:                 0,
			FreeSlotsRemaining:        0,
			DistinctProfilesMessaged:  0,
			CooldownActive:            false,
			CooldownSecondsRemaining:  0,
			BonusSlotsRemaining:       0,
		}
	}

	isInTrial := now.Before(state.TrialEndsAt)
	if isInTrial {
		daysRemaining := int(math.Ceil(state.TrialEndsAt.Sub(now).Hours() / 24.0))
		if daysRemaining < 0 {
			daysRemaining = 0
		}

		cooldownActive := false
		cooldownSecs := 0
		var cooldownExp *time.Time

		if state.CooldownExpiresAt != nil {
			if state.CooldownExpiresAt.After(now) {
				cooldownActive = true
				cooldownSecs = int(state.CooldownExpiresAt.Sub(now).Seconds())
				cooldownExp = state.CooldownExpiresAt
			} else {
				// Expired! Reset cycle
				state.TrialDiscoveryProfileIDs = []string{}
				state.TrialDiscoveryAllowed = TrialDiscoveryFreeBatchQuota
				state.TrialDiscoveryAdsWatched = 0
				state.CooldownExpiresAt = nil
				state.UpdatedAt = now
			}
		}

		distinctCount := len(state.TrialDiscoveryProfileIDs)
		allowed := state.TrialDiscoveryAllowed
		if allowed <= 0 {
			allowed = TrialDiscoveryFreeBatchQuota
		}
		initiationsRemaining := allowed - distinctCount
		if initiationsRemaining < 0 {
			initiationsRemaining = 0
		}

		isLocked := false
		canUnlockWithAd := false

		if cooldownActive {
			isLocked = true
			canUnlockWithAd = false
		} else if distinctCount >= TrialDiscoveryMaxCycleProfiles {
			isLocked = true
			canUnlockWithAd = false
			cooldownActive = true
			if state.CooldownExpiresAt != nil && state.CooldownExpiresAt.After(now) {
				cooldownSecs = int(state.CooldownExpiresAt.Sub(now).Seconds())
				cooldownExp = state.CooldownExpiresAt
			}
		} else if initiationsRemaining == 0 {
			isLocked = true
			if state.TrialDiscoveryAdsWatched < TrialDiscoveryMaxAdsPerCycle {
				canUnlockWithAd = true
			}
		}

		adUnlocked := (state.TrialDiscoveryAdsWatched > 0 && !isLocked)

		return &DiscoveryMessagingQuota{
			UserID:                    state.UserID,
			IsUnlimited:               false,
			IsInTrial:                 true,
			TrialStartedAt:            state.TrialStartedAt,
			TrialEndsAt:               state.TrialEndsAt,
			TrialDaysRemaining:        daysRemaining,
			IsLocked:                  isLocked,
			CanUnlockWithAd:           canUnlockWithAd,
			AdUnlocked:                adUnlocked,
			TrialInitiationsRemaining: initiationsRemaining,
			TrialInitiationsAllowed:   allowed,
			TrialDistinctMessaged:     distinctCount,
			PostTrialFreeRemaining:    PostTrialFreeQuota,
			PostTrialBonusRemaining:   0,
			FreeQuota:                 allowed,
			FreeSlotsRemaining:        initiationsRemaining,
			DistinctProfilesMessaged:  distinctCount,
			CooldownActive:            cooldownActive,
			CooldownSecondsRemaining:  cooldownSecs,
			CooldownExpiresAt:         cooldownExp,
			BonusSlotsRemaining:       0,
		}
	}

	// Post-trial mode
	postFreeRemaining := PostTrialFreeQuota - state.PostTrialOutgoingCount
	if postFreeRemaining < 0 {
		postFreeRemaining = 0
	}
	postBonusRemaining := 0
	if state.PostTrialAdUnlocked {
		postBonusRemaining = PostTrialBonusQuota - state.PostTrialBonusOutgoing
		if postBonusRemaining < 0 {
			postBonusRemaining = 0
		}
	}

	isLocked := false
	canUnlockWithAd := false
	if postFreeRemaining <= 0 {
		if !state.PostTrialAdUnlocked {
			isLocked = true
			canUnlockWithAd = true
		} else {
			if postBonusRemaining <= 0 {
				isLocked = true
				canUnlockWithAd = false
			} else {
				isLocked = false
				canUnlockWithAd = false
			}
		}
	}

	return &DiscoveryMessagingQuota{
		UserID:                    state.UserID,
		IsUnlimited:               false,
		IsInTrial:                 false,
		TrialStartedAt:            state.TrialStartedAt,
		TrialEndsAt:               state.TrialEndsAt,
		TrialDaysRemaining:        0,
		IsLocked:                  isLocked,
		CanUnlockWithAd:           canUnlockWithAd,
		AdUnlocked:                state.PostTrialAdUnlocked,
		TrialInitiationsRemaining: 0,
		TrialInitiationsAllowed:   state.TrialDiscoveryAllowed,
		TrialDistinctMessaged:     len(state.TrialDiscoveryProfileIDs),
		PostTrialFreeRemaining:    postFreeRemaining,
		PostTrialBonusRemaining:   postBonusRemaining,
		FreeQuota:                 PostTrialFreeQuota,
		FreeSlotsRemaining:        postFreeRemaining,
		DistinctProfilesMessaged:  state.PostTrialOutgoingCount,
		CooldownActive:            isLocked,
		CooldownSecondsRemaining:  0,
		CooldownExpiresAt:         nil,
		BonusSlotsRemaining:       postBonusRemaining,
	}
}

func (m *MemoryRepository) consumeDiscoveryMessageSlotLocked(actorID, targetID string) error {
	now := time.Now().UTC()
	if m.isUserUnlimited(actorID) {
		return nil
	}

	state, ok := m.messagingQuotas[actorID]
	if !ok {
		userCreatedAt := now
		if t, ok := m.userCreatedAt[actorID]; ok && !t.IsZero() {
			userCreatedAt = t
		}
		state = &DiscoveryMessageQuotaState{
			UserID:                   actorID,
			TrialStartedAt:           userCreatedAt,
			TrialEndsAt:              userCreatedAt.Add(TrialDuration),
			TrialDiscoveryProfileIDs: []string{},
			TrialDiscoveryAllowed:    TrialDiscoveryFreeBatchQuota,
			TrialDiscoveryAdsWatched: 0,
			PostTrialOutgoingCount:   0,
			PostTrialAdUnlocked:      false,
			PostTrialBonusOutgoing:   0,
			UpdatedAt:                now,
		}
		m.messagingQuotas[actorID] = state
	}

	if state.TrialDiscoveryAllowed <= 0 {
		state.TrialDiscoveryAllowed = TrialDiscoveryFreeBatchQuota
	}
	if state.TrialEndsAt.IsZero() {
		state.TrialStartedAt = now
		state.TrialEndsAt = now.Add(TrialDuration)
	}

	// 1. In Trial Mode
	if now.Before(state.TrialEndsAt) {
		// A. Check 3-hour cooldown
		if state.CooldownExpiresAt != nil {
			if state.CooldownExpiresAt.After(now) {
				return ErrDiscoveryMessageUsageLimitReached
			}
			// Cooldown expired! Reset trial cycle
			state.TrialDiscoveryProfileIDs = []string{}
			state.TrialDiscoveryAllowed = TrialDiscoveryFreeBatchQuota
			state.TrialDiscoveryAdsWatched = 0
			state.CooldownExpiresAt = nil
			state.UpdatedAt = now
		}

		// B. Check if targetID was already contacted
		alreadyContacted := false
		for _, id := range state.TrialDiscoveryProfileIDs {
			if id == targetID {
				alreadyContacted = true
				break
			}
		}

		if alreadyContacted {
			// One initial message per profile until they reply!
			hasReplied := m.repliedPairs[actorID+":"+targetID]
			if !hasReplied {
				for _, req := range m.messageRequests {
					if (req.SenderUserID == actorID && req.RecipientUserID == targetID && req.Status == "ACCEPTED") ||
					   (req.SenderUserID == targetID && req.RecipientUserID == actorID) {
						hasReplied = true
						break
					}
				}
			}
			if !hasReplied {
				return ErrDiscoveryMessageAwaitingReply
			}
			// Recipient replied; conversation is established, allowed without consuming an additional slot
			return nil
		}

		// C. Target is a new distinct profile
		if len(state.TrialDiscoveryProfileIDs) < state.TrialDiscoveryAllowed {
			state.TrialDiscoveryProfileIDs = append(state.TrialDiscoveryProfileIDs, targetID)
			if len(state.TrialDiscoveryProfileIDs) >= TrialDiscoveryMaxCycleProfiles {
				exp := now.Add(TrialDiscoveryCycleCooldown)
				state.CooldownExpiresAt = &exp
			}
			state.UpdatedAt = now
			return nil
		}

		return ErrDiscoveryMessageQuotaLocked
	}

	// 2. Post-Trial Mode
	if state.PostTrialOutgoingCount < PostTrialFreeQuota {
		state.PostTrialOutgoingCount++
		state.UpdatedAt = now
		return nil
	}

	if state.PostTrialAdUnlocked && state.PostTrialBonusOutgoing < PostTrialBonusQuota {
		state.PostTrialBonusOutgoing++
		state.UpdatedAt = now
		return nil
	}

	return ErrDiscoveryMessageQuotaLocked
}

func (m *MemoryRepository) ConsumeDiscoveryMessageSlot(_ context.Context, actorID, targetID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.consumeDiscoveryMessageSlotLocked(actorID, targetID)
}

func (m *MemoryRepository) ConsumeChatOutgoingSlot(_ context.Context, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	if m.isUserUnlimited(userID) {
		return nil
	}

	state, ok := m.messagingQuotas[userID]
	if !ok {
		userCreatedAt := now
		if t, ok := m.userCreatedAt[userID]; ok && !t.IsZero() {
			userCreatedAt = t
		}
		state = &DiscoveryMessageQuotaState{
			UserID:                   userID,
			TrialStartedAt:           userCreatedAt,
			TrialEndsAt:              userCreatedAt.Add(TrialDuration),
			TrialDiscoveryProfileIDs: []string{},
			TrialDiscoveryAllowed:    TrialDiscoveryFreeBatchQuota,
			TrialDiscoveryAdsWatched: 0,
			PostTrialOutgoingCount:   0,
			PostTrialAdUnlocked:      false,
			PostTrialBonusOutgoing:   0,
			UpdatedAt:                now,
		}
		m.messagingQuotas[userID] = state
	}

	if state.TrialEndsAt.IsZero() {
		state.TrialStartedAt = now
		state.TrialEndsAt = now.Add(TrialDuration)
	}

	// During trial: all messages & replies in existing conversations are unlimited!
	if now.Before(state.TrialEndsAt) {
		return nil
	}

	// Post-trial mode
	if state.PostTrialOutgoingCount < PostTrialFreeQuota {
		state.PostTrialOutgoingCount++
		state.UpdatedAt = now
		return nil
	}

	if state.PostTrialAdUnlocked && state.PostTrialBonusOutgoing < PostTrialBonusQuota {
		state.PostTrialBonusOutgoing++
		state.UpdatedAt = now
		return nil
	}

	return ErrDiscoveryMessageQuotaLocked
}

func (m *MemoryRepository) CheckCanSendChat(_ context.Context, senderID, recipientID string) error {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now().UTC()
	if m.isUserUnlimited(senderID) {
		return nil
	}

	state, ok := m.messagingQuotas[senderID]
	if !ok {
		return nil
	}

	if now.Before(state.TrialEndsAt) {
		isDiscoveryContact := false
		for _, id := range state.TrialDiscoveryProfileIDs {
			if id == recipientID {
				isDiscoveryContact = true
				break
			}
		}
		if isDiscoveryContact {
			if m.repliedPairs[senderID+":"+recipientID] {
				return nil
			}
			for _, req := range m.messageRequests {
				if (req.SenderUserID == senderID && req.RecipientUserID == recipientID && req.Status == "ACCEPTED") ||
				   (req.SenderUserID == recipientID && req.RecipientUserID == senderID) {
					return nil
				}
			}
			return ErrDiscoveryMessageAwaitingReply
		}
	}
	return nil
}

func (m *MemoryRepository) HasRecipientReplied(_ context.Context, senderID, recipientID string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.repliedPairs[senderID+":"+recipientID] {
		return true, nil
	}
	for _, req := range m.messageRequests {
		if (req.SenderUserID == senderID && req.RecipientUserID == recipientID && req.Status == "ACCEPTED") ||
		   (req.SenderUserID == recipientID && req.RecipientUserID == senderID) {
			return true, nil
		}
	}
	return false, nil
}

func (m *MemoryRepository) RecordRecipientReply(_ context.Context, senderID, recipientID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.repliedPairs[senderID+":"+recipientID] = true
	return nil
}

func (m *MemoryRepository) GetDiscoveryMessageQuota(_ context.Context, userID string) (*DiscoveryMessagingQuota, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	state, ok := m.messagingQuotas[userID]
	if !ok {
		userCreatedAt := now
		if t, ok := m.userCreatedAt[userID]; ok && !t.IsZero() {
			userCreatedAt = t
		}
		state = &DiscoveryMessageQuotaState{
			UserID:                   userID,
			TrialStartedAt:           userCreatedAt,
			TrialEndsAt:              userCreatedAt.Add(TrialDuration),
			TrialDiscoveryProfileIDs: []string{},
			TrialDiscoveryAllowed:    TrialDiscoveryFreeBatchQuota,
			TrialDiscoveryAdsWatched: 0,
			PostTrialOutgoingCount:   0,
			PostTrialAdUnlocked:      false,
			PostTrialBonusOutgoing:   0,
			UpdatedAt:                now,
		}
		m.messagingQuotas[userID] = state
	}

	if state.TrialDiscoveryAllowed <= 0 {
		state.TrialDiscoveryAllowed = TrialDiscoveryFreeBatchQuota
	}
	if state.TrialEndsAt.IsZero() {
		state.TrialStartedAt = now
		state.TrialEndsAt = now.Add(TrialDuration)
	}

	isUnlimited := m.isUserUnlimited(userID)
	return evaluateMessageQuotaState(state, now, isUnlimited), nil
}

func (m *MemoryRepository) UnlockDiscoveryMessageAdBonus(_ context.Context, actorID string) (*DiscoveryMessagingQuota, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	isUnlimited := m.isUserUnlimited(actorID)
	if isUnlimited {
		return evaluateMessageQuotaState(&DiscoveryMessageQuotaState{UserID: actorID}, now, true), nil
	}

	state, ok := m.messagingQuotas[actorID]
	if !ok {
		userCreatedAt := now
		if t, ok := m.userCreatedAt[actorID]; ok && !t.IsZero() {
			userCreatedAt = t
		}
		state = &DiscoveryMessageQuotaState{
			UserID:                   actorID,
			TrialStartedAt:           userCreatedAt,
			TrialEndsAt:              userCreatedAt.Add(TrialDuration),
			TrialDiscoveryProfileIDs: []string{},
			TrialDiscoveryAllowed:    TrialDiscoveryFreeBatchQuota,
			TrialDiscoveryAdsWatched: 0,
			PostTrialOutgoingCount:   0,
			PostTrialAdUnlocked:      false,
			PostTrialBonusOutgoing:   0,
			UpdatedAt:                now,
		}
		m.messagingQuotas[actorID] = state
	}

	if state.TrialDiscoveryAllowed <= 0 {
		state.TrialDiscoveryAllowed = TrialDiscoveryFreeBatchQuota
	}
	if state.TrialEndsAt.IsZero() {
		state.TrialStartedAt = now
		state.TrialEndsAt = now.Add(TrialDuration)
	}

	if now.Before(state.TrialEndsAt) {
		if state.CooldownExpiresAt != nil && state.CooldownExpiresAt.After(now) {
			return nil, ErrDiscoveryMessageUsageLimitReached
		}
		if state.TrialDiscoveryAdsWatched >= TrialDiscoveryMaxAdsPerCycle {
			return nil, ErrDiscoveryMessageMaxAdsReached
		}
		if len(state.TrialDiscoveryProfileIDs) < state.TrialDiscoveryAllowed {
			return nil, ErrDiscoveryMessageCooldownNotActive
		}
		state.TrialDiscoveryAllowed += TrialDiscoveryAdBatchQuota
		state.TrialDiscoveryAdsWatched++
		state.UpdatedAt = now
		return evaluateMessageQuotaState(state, now, false), nil
	}

	// Post-trial
	if state.PostTrialOutgoingCount < PostTrialFreeQuota {
		return nil, ErrDiscoveryMessageCooldownNotActive
	}
	if state.PostTrialAdUnlocked && state.PostTrialBonusOutgoing < PostTrialBonusQuota {
		return nil, ErrDiscoveryMessageAdAlreadyUnlocked
	}

	state.PostTrialAdUnlocked = true
	state.PostTrialBonusOutgoing = 0
	state.UpdatedAt = now
	return evaluateMessageQuotaState(state, now, false), nil
}

func (m *MemoryRepository) AddFavourite(ctx context.Context, userID, targetUserID string) (*UserFavourite, error) {
	if userID == targetUserID {
		return nil, ErrSelfFavourite
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if blocked
	k1 := fmt.Sprintf("%s:%s", userID, targetUserID)
	k2 := fmt.Sprintf("%s:%s", targetUserID, userID)
	if _, b1 := m.blocks[k1]; b1 {
		return nil, ErrCandidateBlocked
	}
	if _, b2 := m.blocks[k2]; b2 {
		return nil, ErrCandidateBlocked
	}

	if m.favourites[userID] == nil {
		m.favourites[userID] = make(map[string]time.Time)
	}
	now := time.Now().UTC()
	m.favourites[userID][targetUserID] = now

	return &UserFavourite{
		ID:           uuid.New().String(),
		UserID:       userID,
		TargetUserID: targetUserID,
		CreatedAt:    now,
	}, nil
}

func (m *MemoryRepository) RemoveFavourite(ctx context.Context, userID, targetUserID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.favourites[userID] != nil {
		delete(m.favourites[userID], targetUserID)
	}
	return nil
}

func (m *MemoryRepository) ListFavourites(ctx context.Context, userID string) ([]FavouriteProfileCard, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	userFavs, ok := m.favourites[userID]
	if !ok || len(userFavs) == 0 {
		return []FavouriteProfileCard{}, nil
	}

	var results []FavouriteProfileCard
	for targetID, addedAt := range userFavs {
		// Check blocks
		k1 := fmt.Sprintf("%s:%s", userID, targetID)
		k2 := fmt.Sprintf("%s:%s", targetID, userID)
		if _, b1 := m.blocks[k1]; b1 {
			continue
		}
		if _, b2 := m.blocks[k2]; b2 {
			continue
		}

		prof, err := m.identRepo.GetProfile(ctx, targetID)
		if err != nil || prof == nil {
			continue
		}

		age := calculateAge(prof.Birthdate, time.Now().UTC())
		results = append(results, FavouriteProfileCard{
			UserID:      targetID,
			DisplayName: prof.DisplayName,
			Age:         age,
			Bio:         prof.Bio,
			PhotoURL:    "",
			AddedAt:     addedAt,
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].AddedAt.After(results[j].AddedAt)
	})

	if results == nil {
		results = []FavouriteProfileCard{}
	}
	return results, nil
}

func (m *MemoryRepository) IsFavourite(ctx context.Context, userID, targetUserID string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.favourites[userID] == nil {
		return false, nil
	}
	_, ok := m.favourites[userID][targetUserID]
	return ok, nil
}


// PostgresRepository implements production discovery and matching using PostGIS and SQL transactions.
type PostgresRepository struct {
	pool         *pgxpool.Pool
	summaryMu    sync.RWMutex
	summaryCache map[string]*cachedSummaryEntry
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{
		pool:         pool,
		summaryCache: make(map[string]*cachedSummaryEntry),
	}
}

func (p *PostgresRepository) IsBlocked(ctx context.Context, userA, userB string) (bool, error) {
	query := `
		SELECT 1 FROM user_blocks
		WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
		   OR (blocker_user_id = $2 AND blocked_user_id = $1)
		LIMIT 1
	`
	var exists int
	err := p.pool.QueryRow(ctx, query, userA, userB).Scan(&exists)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (p *PostgresRepository) BlockUser(ctx context.Context, blockerID, blockedID, reason string) error {
	if blockerID == blockedID {
		return errors.New("cannot block yourself")
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	query := `
		INSERT INTO user_blocks (blocker_user_id, blocked_user_id, reason)
		VALUES ($1, $2, $3)
		ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING
	`
	if _, err := tx.Exec(ctx, query, blockerID, blockedID, reason); err != nil {
		return err
	}

	low, high := canonicalPair(blockerID, blockedID)
	updateMatchQuery := `
		UPDATE matches
		SET status = 'BLOCKED', unmatched_at = NOW()
		WHERE user_low_id = $1 AND user_high_id = $2 AND status = 'ACTIVE'
	`
	if _, err := tx.Exec(ctx, updateMatchQuery, low, high); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (p *PostgresRepository) RecordAdReward(ctx context.Context, userID string, transactionID string, rewardAmount int) error {
	query := `
		INSERT INTO ad_reward_transactions (user_id, ad_network, transaction_id, reward_item, reward_amount, verified_at)
		VALUES ($1, 'ADMOB', $2, 'LIKES', $3, NOW())
	`
	_, err := p.pool.Exec(ctx, query, userID, transactionID, rewardAmount)
	if err != nil {
		if strings.Contains(err.Error(), "uq_ad_reward_tx") || strings.Contains(err.Error(), "duplicate key") {
			return ErrDuplicateSSVReward
		}
		return err
	}
	return nil
}

func (p *PostgresRepository) SetUserCreatedAt(userID string, createdAt time.Time) {
	_, _ = p.pool.Exec(context.Background(), "UPDATE users SET created_at = $1 WHERE id = $2", createdAt, userID)
}

func (p *PostgresRepository) GetSwipeAllowance(ctx context.Context, userID string) (int, bool, error) {
	detail, err := p.GetSwipeAllowanceDetail(ctx, userID)
	if err != nil {
		return 0, false, err
	}
	return detail.RemainingLikes, detail.IsUnlimited, nil
}

func (p *PostgresRepository) GetSwipeAllowanceDetail(ctx context.Context, userID string) (*SwipeAllowanceDetail, error) {
	now := time.Now().UTC()
	windowStart := now.Truncate(PostIntroWindowHours)
	windowEnd := windowStart.Add(PostIntroWindowHours)

	// 1. Check active entitlement
	entQuery := `
		SELECT 1 FROM user_entitlements
		WHERE user_id = $1 AND entitlement_code = 'UNLIMITED_SWIPES' AND expires_at > NOW()
		LIMIT 1
	`
	var entFound int
	if err := p.pool.QueryRow(ctx, entQuery, userID).Scan(&entFound); err == nil {
		return &SwipeAllowanceDetail{
			UserID:                userID,
			DailyQuota:            9999,
			RemainingRegularLikes: 9999,
			RemainingBonusLikes:   0,
			RemainingLikes:        9999,
			IsUnlimited:           true,
			IsIntroductory:        false,
			WindowStart:           windowStart,
			WindowResetAt:         windowEnd,
		}, nil
	}

	// 2. Check 30-day Introductory Free Period from users.created_at
	var createdAt time.Time
	userQuery := `SELECT created_at FROM users WHERE id = $1`
	if err := p.pool.QueryRow(ctx, userQuery, userID).Scan(&createdAt); err == nil {
		if !createdAt.IsZero() && now.Sub(createdAt) < IntroductoryDuration {
			return &SwipeAllowanceDetail{
				UserID:                userID,
				DailyQuota:            9999,
				RemainingRegularLikes: 9999,
				RemainingBonusLikes:   0,
				RemainingLikes:        9999,
				IsUnlimited:           true,
				IsIntroductory:        true,
				WindowStart:           windowStart,
				WindowResetAt:         windowEnd,
			}, nil
		}
	}

	// 3. Post-Introductory: 15 likes per fixed 12-hour window
	countQuery := `
		SELECT COUNT(*) FROM swipes
		WHERE actor_user_id = $1 AND direction IN ('LIKE', 'SUPER_SPARK') AND created_at >= $2
	`
	var likeCount int
	if err := p.pool.QueryRow(ctx, countQuery, userID, windowStart).Scan(&likeCount); err != nil {
		return nil, err
	}

	// 4. Fetch bonus rewarded likes earned in current 12-hour window
	bonusQuery := `
		SELECT COALESCE(SUM(reward_amount), 0) FROM ad_reward_transactions
		WHERE user_id = $1 AND verified_at >= $2 AND reward_item = 'LIKES'
	`
	var bonusLikes int
	_ = p.pool.QueryRow(ctx, bonusQuery, userID, windowStart).Scan(&bonusLikes)

	quota := PostIntroQuota
	regularRemaining := quota - likeCount
	bonusRemaining := bonusLikes
	if regularRemaining < 0 {
		bonusUsed := -regularRemaining
		bonusRemaining = bonusLikes - bonusUsed
		if bonusRemaining < 0 {
			bonusRemaining = 0
		}
		regularRemaining = 0
	}
	totalRemaining := regularRemaining + bonusRemaining

	return &SwipeAllowanceDetail{
		UserID:                userID,
		DailyQuota:            quota,
		RemainingRegularLikes: regularRemaining,
		RemainingBonusLikes:   bonusRemaining,
		RemainingLikes:        totalRemaining,
		IsUnlimited:           false,
		IsIntroductory:        false,
		WindowStart:           windowStart,
		WindowResetAt:         windowEnd,
	}, nil
}

type candidateCursor struct {
	mult      float64
	createdAt time.Time
	id        string
}

func encodeCandidateCursor(mult float64, createdAt time.Time, id string) string {
	raw := fmt.Sprintf("%.6f|%d|%s", mult, createdAt.UnixNano(), id)
	return base64.URLEncoding.EncodeToString([]byte(raw))
}

func decodeCandidateCursor(cursor string) (*candidateCursor, int, error) {
	if cursor == "" {
		return nil, 0, nil
	}
	if strings.HasPrefix(cursor, "offset:") {
		off, err := strconv.Atoi(strings.TrimPrefix(cursor, "offset:"))
		if err == nil && off >= 0 {
			return nil, off, nil
		}
	}
	if off, err := strconv.Atoi(cursor); err == nil && off >= 0 {
		return nil, off, nil
	}

	decoded, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		decoded, err = base64.StdEncoding.DecodeString(cursor)
		if err != nil {
			return nil, 0, err
		}
	}

	parts := strings.SplitN(string(decoded), "|", 3)
	if len(parts) != 3 {
		return nil, 0, fmt.Errorf("invalid cursor format")
	}

	mult, err := strconv.ParseFloat(parts[0], 64)
	if err != nil {
		return nil, 0, err
	}

	nano, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return nil, 0, err
	}

	return &candidateCursor{
		mult:      mult,
		createdAt: time.Unix(0, nano).UTC(),
		id:        parts[2],
	}, 0, nil
}

func (p *PostgresRepository) GetCandidates(ctx context.Context, actorID string, cursor string, limit int) ([]DiscoveryCandidate, string, string, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	curData, offset, _ := decodeCandidateCursor(cursor)
	fetchLimit := limit + 1

	// PostGIS Query enforcing:
	// 1. Reciprocal age preferences
	// 2. ST_DWithin radius check based on actor's max_distance_km
	// 3. Exclusion of previously swiped profiles and bi-directional blocks
	// 4. Discoverable profiles (active status, incognito disabled, age >= 18)
	// 5. Hard lifestyle dealbreakers (non-smoker, verified, monogamous)
	baseQuery := `
		WITH actor_info AS (
			SELECT
				p.user_id,
				p.birthdate,
				EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate))::INT AS age,
				p.gender_identities,
				p.sexual_orientations,
				p.relationship_intents,
				p.relationship_structure,
				p.smoking_habit,
				p.drinking_habit,
				COALESCE(dp.min_age, 18) AS min_age,
				COALESCE(dp.max_age, 100) AS max_age,
				COALESCE(dp.max_distance_km, 100) AS max_distance_km,
				dp.preferred_genders,
				dp.preferred_intents,
				dp.preferred_orientations,
				dp.min_height_cm AS pref_min_height_cm,
				dp.max_height_cm AS pref_max_height_cm,
				dp.min_weight_kg AS pref_min_weight_kg,
				dp.max_weight_kg AS pref_max_weight_kg,
				COALESCE(dp.verified_profiles_only, false) AS verified_profiles_only,
				COALESCE((dp.dealbreakers->>'non_smoker_only')::boolean, false) AS non_smoker_only,
				COALESCE((dp.dealbreakers->>'require_verified')::boolean, false) AS require_verified,
				COALESCE((dp.dealbreakers->>'require_monogamous')::boolean, false) AS require_monogamous,
				pl.coordinates AS actor_coords
			FROM profiles p
			LEFT JOIN dating_preferences dp ON dp.user_id = p.user_id
			LEFT JOIN profile_locations pl ON pl.user_id = p.user_id
			WHERE p.user_id = $1
		)
		SELECT
			u.id AS candidate_id,
			p.display_name,
			EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate))::INT AS candidate_age,
			p.bio,
			p.pronouns,
			p.gender_identities,
			p.sexual_orientations,
			p.relationship_intents,
			p.relationship_structure,
			p.visibility_settings,
			p.is_photo_verified,
			p.smoking_habit,
			p.drinking_habit,
			p.height_cm,
			p.weight_kg,
			COALESCE(
				CEIL(ST_Distance(a.actor_coords, pl.coordinates) / 1000.0)::INT,
				1
			) AS distance_km,
			COALESCE(pb.multiplier, 1.0)::float8 AS boost_multiplier,
			u.created_at AS user_created_at
		FROM users u
		JOIN profiles p ON p.user_id = u.id
		LEFT JOIN dating_preferences dp ON dp.user_id = u.id
		LEFT JOIN profile_locations pl ON pl.user_id = u.id
		LEFT JOIN profile_boosts pb ON pb.user_id = u.id AND pb.status = 'ACTIVE' AND pb.expires_at > NOW()
		CROSS JOIN actor_info a
		WHERE u.id <> a.user_id
		  AND u.status = 'ACTIVE'
		  AND p.incognito_enabled = FALSE
		  -- Must have at least 3 approved profile gallery photos
		  AND (
			  SELECT COUNT(*)
			  FROM media_assets ma
			  WHERE ma.owner_user_id = u.id
			    AND ma.purpose = 'PROFILE_GALLERY'
			    AND ma.status = 'READY'
			    AND ma.moderation_verdict = 'APPROVED'
		  ) >= 3
		  -- Age bounds
		  AND EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate)) >= 18
		  AND EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate)) BETWEEN a.min_age AND a.max_age
		  AND a.age BETWEEN COALESCE(dp.min_age, 18) AND COALESCE(dp.max_age, 100)
		  -- PostGIS Distance radius (if coordinates available)
		  AND (a.actor_coords IS NULL OR pl.coordinates IS NULL OR ST_DWithin(a.actor_coords, pl.coordinates, a.max_distance_km * 1000.0))
		  -- Height filter
		  AND (a.pref_min_height_cm IS NULL OR p.height_cm IS NULL OR p.height_cm >= a.pref_min_height_cm)
		  AND (a.pref_max_height_cm IS NULL OR p.height_cm IS NULL OR p.height_cm <= a.pref_max_height_cm)
		  -- Weight filter
		  AND (a.pref_min_weight_kg IS NULL OR p.weight_kg IS NULL OR p.weight_kg >= a.pref_min_weight_kg)
		  AND (a.pref_max_weight_kg IS NULL OR p.weight_kg IS NULL OR p.weight_kg <= a.pref_max_weight_kg)
		  -- Preferred Orientations filter
		  AND (a.preferred_orientations IS NULL OR cardinality(a.preferred_orientations) = 0 OR p.sexual_orientations && a.preferred_orientations)
		  -- Preferred Genders filter
		  AND (a.preferred_genders IS NULL OR cardinality(a.preferred_genders) = 0 OR p.gender_identities && a.preferred_genders)
		  -- Preferred Intents filter
		  AND (a.preferred_intents IS NULL OR cardinality(a.preferred_intents) = 0 OR p.relationship_intents && a.preferred_intents)
		  -- Exclude previously swiped candidates
		  AND NOT EXISTS (
			  SELECT 1 FROM swipes s
			  WHERE s.actor_user_id = a.user_id AND s.target_user_id = u.id AND s.undone_at IS NULL
		  )
		  -- Exclude bi-directional blocks
		  AND NOT EXISTS (
			  SELECT 1 FROM user_blocks b
			  WHERE (b.blocker_user_id = a.user_id AND b.blocked_user_id = u.id)
			     OR (b.blocker_user_id = u.id AND b.blocked_user_id = a.user_id)
		  )
		  -- Verified requirement
		  AND (
			  ((a.verified_profiles_only = FALSE AND a.require_verified = FALSE) OR p.is_photo_verified = TRUE)
			  AND
			  ((COALESCE(dp.verified_profiles_only, false) = FALSE AND COALESCE((dp.dealbreakers->>'require_verified')::boolean, false) = FALSE) OR (SELECT is_photo_verified FROM profiles WHERE user_id = a.user_id) = TRUE)
		  )
		  -- Non-smoker dealbreaker
		  AND (
			  (a.non_smoker_only = FALSE OR p.smoking_habit = 'NON_SMOKER' OR p.smoking_habit = '')
			  AND
			  (COALESCE((dp.dealbreakers->>'non_smoker_only')::boolean, false) = FALSE OR a.smoking_habit = 'NON_SMOKER' OR a.smoking_habit = '')
		  )
		  -- Monogamous dealbreaker
		  AND (
			  (a.require_monogamous = FALSE OR p.relationship_structure = 'MONOGAMOUS' OR p.relationship_structure = '')
			  AND
			  (COALESCE((dp.dealbreakers->>'require_monogamous')::boolean, false) = FALSE OR a.relationship_structure = 'MONOGAMOUS' OR a.relationship_structure = '')
		  )`

	var query string
	var args []any
	if curData != nil {
		query = baseQuery + `
		  AND (COALESCE(pb.multiplier, 1.0)::float8, u.created_at, u.id) < ($3::float8, $4::timestamptz, $5::uuid)
		ORDER BY COALESCE(pb.multiplier, 1.0) DESC, u.created_at DESC, u.id DESC
		LIMIT $2;`
		args = []any{actorID, fetchLimit, curData.mult, curData.createdAt, curData.id}
	} else if offset > 0 {
		query = baseQuery + `
		ORDER BY COALESCE(pb.multiplier, 1.0) DESC, u.created_at DESC, u.id DESC
		LIMIT $2 OFFSET $3;`
		args = []any{actorID, fetchLimit, offset}
	} else {
		query = baseQuery + `
		ORDER BY COALESCE(pb.multiplier, 1.0) DESC, u.created_at DESC, u.id DESC
		LIMIT $2;`
		args = []any{actorID, fetchLimit}
	}

	rows, err := p.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to query discovery candidates: %w", err)
	}
	defer rows.Close()

	type scannedCandidate struct {
		cand      DiscoveryCandidate
		boostMult float64
		createdAt time.Time
	}
	var scanned []scannedCandidate

	for rows.Next() {
		var c DiscoveryCandidate
		var visJSON []byte
		var structure *string
		var smoking, drinking string
		var heightCm, weightKg *int
		var dist int
		var boostMult float64
		var uCreatedAt time.Time

		if err := rows.Scan(
			&c.UserID, &c.DisplayName, &c.Age, &c.Bio, &c.Pronouns, &c.GenderIdentities,
			&c.SexualOrientations, &c.RelationshipIntents, &structure, &visJSON,
			&c.IsPhotoVerified, &smoking, &drinking, &heightCm, &weightKg, &dist, &boostMult, &uCreatedAt,
		); err != nil {
			return nil, "", "", err
		}

		if structure != nil {
			c.RelationshipStructure = *structure
		}
		c.SmokingHabit = smoking
		c.DrinkingHabit = drinking
		if dist < 1 {
			dist = 1
		}
		c.ApproximateDistanceKm = dist

		var vs identity.VisibilitySettings
		_ = json.Unmarshal(visJSON, &vs)
		if vs.Pronouns == identity.VisibilityHidden {
			c.Pronouns = nil
		}
		if vs.GenderIdentity == identity.VisibilityHidden {
			c.GenderIdentities = nil
		}
		if vs.SexualOrientation == identity.VisibilityHidden {
			c.SexualOrientations = nil
		}
		if vs.Height != identity.VisibilityHidden {
			c.HeightCm = heightCm
		}
		if vs.Weight != identity.VisibilityHidden {
			c.WeightKg = weightKg
		}

		c.Photos = []PhotoCard{}
		scanned = append(scanned, scannedCandidate{
			cand:      c,
			boostMult: boostMult,
			createdAt: uCreatedAt,
		})
	}

	var candidates []DiscoveryCandidate
	var nextCursor string
	if len(scanned) > limit {
		last := scanned[limit-1]
		nextCursor = encodeCandidateCursor(last.boostMult, last.createdAt, last.cand.UserID)
		for i := 0; i < limit; i++ {
			candidates = append(candidates, scanned[i].cand)
		}
	} else {
		for i := 0; i < len(scanned); i++ {
			candidates = append(candidates, scanned[i].cand)
		}
	}

	var emptyReason string
	if len(candidates) == 0 {
		if cursor == "" {
			var unswipedCount int
			_ = p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM users u WHERE u.id <> $1 AND u.status = 'ACTIVE' AND NOT EXISTS (
				SELECT 1 FROM swipes s WHERE s.actor_user_id = $1 AND s.target_user_id = u.id AND s.undone_at IS NULL
			)`, actorID).Scan(&unswipedCount)
			if unswipedCount == 0 {
				emptyReason = "ALL_CANDIDATES_SWIPED"
			} else {
				emptyReason = "DEALBREAKERS_EXCLUDED_ALL"
			}
		}
	}

	return candidates, nextCursor, emptyReason, rows.Err()
}

func (p *PostgresRepository) CountMatchingNearby(ctx context.Context, actorID string) (*MatchingSummaryResponse, error) {
	p.summaryMu.Lock()
	defer p.summaryMu.Unlock()

	now := time.Now().UTC()
	if entry, ok := p.summaryCache[actorID]; ok && now.Before(entry.expiresAt) {
		copied := *entry.summary
		return &copied, nil
	}

	query := `
		WITH actor_info AS (
			SELECT
				p.user_id,
				EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate))::INT AS age,
				p.smoking_habit,
				p.relationship_structure,
				COALESCE(dp.min_age, 18) AS min_age,
				COALESCE(dp.max_age, 100) AS max_age,
				COALESCE(dp.max_distance_km, 100) AS max_distance_km,
				dp.preferred_genders,
				COALESCE(dp.verified_profiles_only, false) AS verified_profiles_only,
				COALESCE((dp.dealbreakers->>'non_smoker_only')::boolean, false) AS non_smoker_only,
				COALESCE((dp.dealbreakers->>'require_verified')::boolean, false) AS require_verified,
				COALESCE((dp.dealbreakers->>'require_monogamous')::boolean, false) AS require_monogamous,
				pl.coordinates AS actor_coords
			FROM profiles p
			LEFT JOIN dating_preferences dp ON dp.user_id = p.user_id
			LEFT JOIN profile_locations pl ON pl.user_id = p.user_id
			WHERE p.user_id = $1
		)
		SELECT COUNT(*)
		FROM users u
		JOIN profiles p ON p.user_id = u.id
		LEFT JOIN dating_preferences dp ON dp.user_id = u.id
		LEFT JOIN profile_locations pl ON pl.user_id = u.id
		CROSS JOIN actor_info a
		WHERE u.id <> a.user_id
		  AND u.status = 'ACTIVE'
		  AND p.incognito_enabled = FALSE
		  AND EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate)) >= 18
		  AND EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate)) BETWEEN a.min_age AND a.max_age
		  AND a.age BETWEEN COALESCE(dp.min_age, 18) AND COALESCE(dp.max_age, 100)
		  AND (a.actor_coords IS NULL OR pl.coordinates IS NULL OR ST_DWithin(a.actor_coords, pl.coordinates, a.max_distance_km * 1000.0))
		  AND NOT EXISTS (
			  SELECT 1 FROM user_blocks b
			  WHERE (b.blocker_user_id = a.user_id AND b.blocked_user_id = u.id)
			     OR (b.blocker_user_id = u.id AND b.blocked_user_id = a.user_id)
		  )
		  AND (
			  ((a.verified_profiles_only = FALSE AND a.require_verified = FALSE) OR p.is_photo_verified = TRUE)
			  AND
			  ((COALESCE(dp.verified_profiles_only, false) = FALSE AND COALESCE((dp.dealbreakers->>'require_verified')::boolean, false) = FALSE) OR (SELECT is_photo_verified FROM profiles WHERE user_id = a.user_id) = TRUE)
		  )
		  AND (
			  (a.non_smoker_only = FALSE OR p.smoking_habit = 'NON_SMOKER' OR p.smoking_habit = '')
			  AND
			  (COALESCE((dp.dealbreakers->>'non_smoker_only')::boolean, false) = FALSE OR a.smoking_habit = 'NON_SMOKER' OR a.smoking_habit = '')
		  )
		  AND (
			  (a.require_monogamous = FALSE OR p.relationship_structure = 'MONOGAMOUS' OR p.relationship_structure = '')
			  AND
			  (COALESCE((dp.dealbreakers->>'require_monogamous')::boolean, false) = FALSE OR a.relationship_structure = 'MONOGAMOUS' OR a.relationship_structure = '')
		  )
	`

	var count int
	if err := p.pool.QueryRow(ctx, query, actorID).Scan(&count); err != nil {
		return nil, fmt.Errorf("failed to count matching nearby: %w", err)
	}

	resp := &MatchingSummaryResponse{
		CachedAt:  now,
		ExpiresAt: now.Add(5 * time.Minute),
	}

	if count == 0 {
		resp.Count = 0
		resp.DisplayText = "No people match your preferences nearby."
		resp.PrivacyFloorApplied = false
	} else if count < 5 {
		resp.Count = 0
		resp.DisplayText = "Fewer than 5 people match your preferences nearby."
		resp.PrivacyFloorApplied = true
	} else {
		resp.Count = count
		resp.DisplayText = fmt.Sprintf("%d people match your preferences nearby.", count)
		resp.PrivacyFloorApplied = false
	}

	p.summaryCache[actorID] = &cachedSummaryEntry{
		summary:   resp,
		expiresAt: resp.ExpiresAt,
	}

	copied := *resp
	return &copied, nil
}

func (p *PostgresRepository) CreateSwipe(ctx context.Context, actorID, targetID string, direction SwipeDirection, introNote string, correlationID string) (bool, *Match, bool, error) {
	if actorID == targetID {
		return false, nil, false, ErrSelfSwipe
	}

	// Verify target account is active
	var targetStatus string
	if err := p.pool.QueryRow(ctx, "SELECT status FROM users WHERE id = $1", targetID).Scan(&targetStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil, false, ErrCandidateInvalid
		}
		return false, nil, false, err
	}
	if targetStatus != "ACTIVE" {
		return false, nil, false, ErrCandidateInvalid
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return false, nil, false, err
	}
	defer tx.Rollback(ctx)

	// Block check within transaction
	var blockedCount int
	blockCheck := `
		SELECT COUNT(*) FROM user_blocks
		WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
		   OR (blocker_user_id = $2 AND blocked_user_id = $1)
	`
	if err := tx.QueryRow(ctx, blockCheck, actorID, targetID).Scan(&blockedCount); err != nil {
		return false, nil, false, err
	}
	if blockedCount > 0 {
		return false, nil, false, ErrCandidateBlocked
	}

	// Check if already swiped (idempotency)
	var existingDirection string
	err = tx.QueryRow(ctx, "SELECT direction FROM swipes WHERE actor_user_id = $1 AND target_user_id = $2", actorID, targetID).Scan(&existingDirection)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, nil, false, err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		// New swipe: enforce like quota atomically for LIKE and SUPER_SPARK
		if direction != SwipePass {
			now := time.Now().UTC()
			windowStart := now.Truncate(PostIntroWindowHours)

			// 1. Check active unlimited entitlement
			var entFound int
			err := tx.QueryRow(ctx, "SELECT 1 FROM user_entitlements WHERE user_id = $1 AND entitlement_code = 'UNLIMITED_SWIPES' AND expires_at > NOW() LIMIT 1", actorID).Scan(&entFound)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return false, nil, false, err
			}

			isUnlimited := (entFound == 1)
			if !isUnlimited {
				// 2. Check 30-day Introductory Free Period from users.created_at
				var createdAt time.Time
				if err := tx.QueryRow(ctx, "SELECT created_at FROM users WHERE id = $1", actorID).Scan(&createdAt); err == nil {
					if !createdAt.IsZero() && now.Sub(createdAt) < IntroductoryDuration {
						isUnlimited = true
					}
				}
			}

			// 3. Post-Introductory: 15 likes per fixed 12-hour window
			if !isUnlimited {
				var likeCount int
				if err := tx.QueryRow(ctx, "SELECT COUNT(*) FROM swipes WHERE actor_user_id = $1 AND direction IN ('LIKE', 'SUPER_SPARK') AND created_at >= $2", actorID, windowStart).Scan(&likeCount); err != nil {
					return false, nil, false, err
				}
				var bonusLikes int
				_ = tx.QueryRow(ctx, "SELECT COALESCE(SUM(reward_amount), 0) FROM ad_reward_transactions WHERE user_id = $1 AND verified_at >= $2 AND reward_item = 'LIKES'", actorID, windowStart).Scan(&bonusLikes)

				regularRemaining := PostIntroQuota - likeCount
				bonusRemaining := bonusLikes
				if regularRemaining < 0 {
					bonusUsed := -regularRemaining
					bonusRemaining = bonusLikes - bonusUsed
					if bonusRemaining < 0 {
						bonusRemaining = 0
					}
					regularRemaining = 0
				}

				if regularRemaining <= 0 {
					if bonusRemaining <= 0 {
						return false, nil, false, ErrSwipeLimitReached
					}
					// Bonus likes from rewarded ads can only be used on photo-verified profiles
					var targetVerified bool
					if err := tx.QueryRow(ctx, "SELECT is_photo_verified FROM profiles WHERE user_id = $1", targetID).Scan(&targetVerified); err != nil || !targetVerified {
						return false, nil, false, ErrBonusLikesVerifiedOnly
					}
				}
			}
		}
	}

	// Enforce Discovery messaging quota if initiating a message with an Intro Note
	if strings.TrimSpace(introNote) != "" {
		if err := p.consumeDiscoveryMessageSlotTx(ctx, tx, actorID, targetID); err != nil {
			return false, nil, false, err
		}
	}

	// Idempotent swipe insert with re-swipe after rewind support
	swipeQuery := `
		INSERT INTO swipes (actor_user_id, target_user_id, direction, intro_note)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (actor_user_id, target_user_id) DO UPDATE
		SET direction = EXCLUDED.direction, intro_note = EXCLUDED.intro_note, undone_at = NULL, created_at = NOW()
	`
	if _, err := tx.Exec(ctx, swipeQuery, actorID, targetID, string(direction), introNote); err != nil {
		return false, nil, false, fmt.Errorf("failed to persist swipe: %w", err)
	}

	if direction == SwipePass {
		return false, nil, false, tx.Commit(ctx)
	}

	// If intro note present, persist message request
	if strings.TrimSpace(introNote) != "" {
		reqQuery := `
			INSERT INTO message_requests (sender_user_id, recipient_user_id, body, status)
			VALUES ($1, $2, $3, 'PENDING')
		`
		_, _ = tx.Exec(ctx, reqQuery, actorID, targetID, strings.TrimSpace(introNote))
	}

	// Check reciprocal like
	reciprocalQuery := `
		SELECT 1 FROM swipes
		WHERE actor_user_id = $1 AND target_user_id = $2
		  AND direction IN ('LIKE', 'SUPER_SPARK')
		  AND undone_at IS NULL
	`
	var reciprocalFound int
	err = tx.QueryRow(ctx, reciprocalQuery, targetID, actorID).Scan(&reciprocalFound)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// No reciprocal like yet; commit swipe and return
			return false, nil, false, tx.Commit(ctx)
		}
		return false, nil, false, err
	}

	// Reciprocal match formed!
	low, high := canonicalPair(actorID, targetID)
	now := time.Now().UTC()

	matchQuery := `
		INSERT INTO matches (user_low_id, user_high_id, status, matched_at)
		VALUES ($1, $2, 'ACTIVE', $3)
		ON CONFLICT (user_low_id, user_high_id) DO UPDATE
			SET status = 'ACTIVE', matched_at = EXCLUDED.matched_at, unmatched_at = NULL
		RETURNING id, matched_at
	`
	var m Match
	m.UserLowID = low
	m.UserHighID = high
	m.Status = MatchActive

	if err := tx.QueryRow(ctx, matchQuery, low, high, now).Scan(&m.ID, &m.MatchedAt); err != nil {
		return false, nil, false, fmt.Errorf("failed to create mutual match: %w", err)
	}

	// Ensure conversation thread exists for the new mutual match
	convQuery := `
		INSERT INTO conversations (match_id, created_at)
		VALUES ($1, $2)
		ON CONFLICT (match_id) DO NOTHING
	`
	if _, err := tx.Exec(ctx, convQuery, m.ID, m.MatchedAt); err != nil {
		return false, nil, false, fmt.Errorf("failed to create conversation for match: %w", err)
	}

	if strings.TrimSpace(introNote) != "" {
		_, _ = tx.Exec(ctx, "UPDATE message_requests SET status = 'ACCEPTED', responded_at = NOW() WHERE sender_user_id = $1 AND recipient_user_id = $2", actorID, targetID)
		var convID string
		if err := tx.QueryRow(ctx, "SELECT id FROM conversations WHERE match_id = $1", m.ID).Scan(&convID); err == nil {
			clientMsgID := uuid.NewSHA1(uuid.NameSpaceOID, []byte(fmt.Sprintf("%s:%s", actorID, targetID))).String()
			_, _ = tx.Exec(ctx, `
				INSERT INTO messages (conversation_id, sender_user_id, client_message_id, body, message_type)
				VALUES ($1, $2, $3, $4, 'TEXT')
				ON CONFLICT DO NOTHING
			`, convID, actorID, clientMsgID, strings.TrimSpace(introNote))
			_, _ = tx.Exec(ctx, "UPDATE conversations SET last_message_at = NOW() WHERE id = $1", convID)
		}
	}

	// Emit match.created.v1 into outbox_events inside same database transaction
	payload, _ := json.Marshal(map[string]any{
		"match_id":    m.ID,
		"user_low_id": low,
		"user_high_id": high,
		"matched_at":  m.MatchedAt,
	})
	outboxQuery := `
		INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, trace_id, status)
		VALUES ('MATCH', $1, 'match.created.v1', $2, $3, 'PENDING')
	`
	if _, err := tx.Exec(ctx, outboxQuery, m.ID, payload, correlationID); err != nil {
		return false, nil, false, fmt.Errorf("failed to write match outbox event: %w", err)
	}

	// Grant match-triggered reward: 24h unlimited swipes
	rewardQuery := `
		INSERT INTO user_entitlements (user_id, entitlement_code, source, granted_at, expires_at)
		VALUES ($1, 'UNLIMITED_SWIPES', 'MATCH_REWARD', NOW(), NOW() + INTERVAL '24 hours'),
		       ($2, 'UNLIMITED_SWIPES', 'MATCH_REWARD', NOW(), NOW() + INTERVAL '24 hours')
	`
	if _, err := tx.Exec(ctx, rewardQuery, actorID, targetID); err != nil {
		return false, nil, false, fmt.Errorf("failed to grant match swipe reward: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, nil, false, err
	}

	return true, &m, true, nil
}

func (p *PostgresRepository) GetMatchByID(ctx context.Context, matchID, requesterID string) (*Match, error) {
	query := `
		SELECT id, user_low_id, user_high_id, status, matched_at, unmatched_at
		FROM matches
		WHERE id = $1 AND status = 'ACTIVE'
	`
	var m Match
	var status string
	err := p.pool.QueryRow(ctx, query, matchID).Scan(
		&m.ID, &m.UserLowID, &m.UserHighID, &status, &m.MatchedAt, &m.UnmatchedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrMatchNotFound
		}
		return nil, err
	}
	m.Status = MatchStatus(status)

	if requesterID != "" && m.UserLowID != requesterID && m.UserHighID != requesterID {
		return nil, ErrMatchNotFound
	}
	return &m, nil
}

func (p *PostgresRepository) ListMatches(ctx context.Context, userID string) ([]Match, error) {
	query := `
		SELECT id, user_low_id, user_high_id, status, matched_at, unmatched_at
		FROM matches
		WHERE (user_low_id = $1 OR user_high_id = $1) AND status = 'ACTIVE'
		ORDER BY matched_at DESC
	`
	rows, err := p.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []Match
	for rows.Next() {
		var m Match
		var status string
		if err := rows.Scan(&m.ID, &m.UserLowID, &m.UserHighID, &status, &m.MatchedAt, &m.UnmatchedAt); err != nil {
			return nil, err
		}
		m.Status = MatchStatus(status)
		results = append(results, m)
	}
	return results, rows.Err()
}

func (p *PostgresRepository) Unmatch(ctx context.Context, matchID, requesterID string) error {
	query := `
		UPDATE matches
		SET status = 'UNMATCHED', unmatched_at = NOW()
		WHERE id = $1 AND status = 'ACTIVE'
		  AND (user_low_id = $2 OR user_high_id = $2)
	`
	res, err := p.pool.Exec(ctx, query, matchID, requesterID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrMatchNotFound
	}
	return nil
}

func (p *PostgresRepository) RewindLastSwipe(ctx context.Context, actorID string) (*RewindResponse, error) {
	var entFound int
	entQuery := `
		SELECT 1 FROM user_entitlements
		WHERE user_id = $1 AND entitlement_code IN ('REWIND', 'UNLIMITED_SWIPES') AND expires_at > NOW()
		LIMIT 1
	`
	err := p.pool.QueryRow(ctx, entQuery, actorID).Scan(&entFound)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRewindNotEntitled
		}
		return nil, err
	}

	var swipeID string
	var targetUserID string
	var direction string
	findQuery := `
		SELECT id, target_user_id, direction
		FROM swipes
		WHERE actor_user_id = $1 AND undone_at IS NULL
		ORDER BY created_at DESC
		LIMIT 1
	`
	err = p.pool.QueryRow(ctx, findQuery, actorID).Scan(&swipeID, &targetUserID, &direction)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoSwipeToRewind
		}
		return nil, err
	}

	if direction != string(SwipePass) {
		return nil, ErrNoSwipeToRewind
	}

	updateQuery := `UPDATE swipes SET undone_at = NOW() WHERE id = $1`
	_, err = p.pool.Exec(ctx, updateQuery, swipeID)
	if err != nil {
		return nil, err
	}

	return &RewindResponse{
		Success:        true,
		RestoredUserID: targetUserID,
	}, nil
}

func (p *PostgresRepository) SearchProfiles(ctx context.Context, actorID string, query string, limit int) ([]DiscoveryCandidate, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	searchPattern := "%" + strings.TrimSpace(query) + "%"

	sqlQuery := `
		WITH actor_info AS (
			SELECT 
				p.user_id,
				pl.coordinates AS actor_coords
			FROM profiles p
			LEFT JOIN profile_locations pl ON pl.user_id = p.user_id
			WHERE p.user_id = $1
		)
		SELECT 
			u.id,
			p.display_name,
			EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate))::INT AS age,
			p.bio,
			p.pronouns,
			p.gender_identities,
			p.sexual_orientations,
			p.relationship_intents,
			p.relationship_structure,
			p.visibility_settings,
			p.is_photo_verified,
			p.smoking_habit,
			p.drinking_habit,
			p.height_cm,
			p.weight_kg,
			COALESCE(ROUND(ST_Distance(a.actor_coords, pl.coordinates) / 1000.0)::INT, 1) AS distance_km
		FROM users u
		JOIN profiles p ON p.user_id = u.id
		LEFT JOIN profile_locations pl ON pl.user_id = u.id
		CROSS JOIN actor_info a
		WHERE u.id <> a.user_id
		  AND u.status = 'ACTIVE'
		  AND p.incognito_enabled = FALSE
		  AND EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate)) >= 18
		  AND NOT EXISTS (
			  SELECT 1 FROM user_blocks b
			  WHERE (b.blocker_user_id = a.user_id AND b.blocked_user_id = u.id)
			     OR (b.blocker_user_id = u.id AND b.blocked_user_id = a.user_id)
		  )
		  AND (
			  $2 = '%%'
			  OR p.display_name ILIKE $2
			  OR p.bio ILIKE $2
			  OR EXISTS (SELECT 1 FROM unnest(p.gender_identities) g WHERE g ILIKE $2)
			  OR EXISTS (SELECT 1 FROM unnest(p.sexual_orientations) s WHERE s ILIKE $2)
		  )
		ORDER BY p.is_photo_verified DESC, u.created_at DESC
		LIMIT $3;
	`

	rows, err := p.pool.Query(ctx, sqlQuery, actorID, searchPattern, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to search profiles: %w", err)
	}
	defer rows.Close()

	var candidates []DiscoveryCandidate
	for rows.Next() {
		var c DiscoveryCandidate
		var visJSON []byte
		var structure *string
		var smoking, drinking string
		var heightCm, weightKg *int
		var dist int

		if err := rows.Scan(
			&c.UserID, &c.DisplayName, &c.Age, &c.Bio, &c.Pronouns, &c.GenderIdentities,
			&c.SexualOrientations, &c.RelationshipIntents, &structure, &visJSON,
			&c.IsPhotoVerified, &smoking, &drinking, &heightCm, &weightKg, &dist,
		); err != nil {
			return nil, err
		}

		if structure != nil {
			c.RelationshipStructure = *structure
		}
		c.SmokingHabit = smoking
		c.DrinkingHabit = drinking
		if dist < 1 {
			dist = 1
		}
		c.ApproximateDistanceKm = dist

		var vs identity.VisibilitySettings
		_ = json.Unmarshal(visJSON, &vs)
		if vs.Pronouns == identity.VisibilityHidden {
			c.Pronouns = nil
		}
		if vs.GenderIdentity == identity.VisibilityHidden {
			c.GenderIdentities = nil
		}
		if vs.SexualOrientation == identity.VisibilityHidden {
			c.SexualOrientations = nil
		}
		if vs.Height != identity.VisibilityHidden {
			c.HeightCm = heightCm
		}
		if vs.Weight != identity.VisibilityHidden {
			c.WeightKg = weightKg
		}

		c.Photos = []PhotoCard{}
		candidates = append(candidates, c)
	}

	return candidates, rows.Err()
}

func (p *PostgresRepository) GetIncomingLikes(ctx context.Context, userID string, limit, offset int) ([]IncomingLikeCard, int, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	countQuery := `
		SELECT COUNT(*)
		FROM swipes s
		JOIN users u ON u.id = s.actor_user_id AND u.status = 'ACTIVE'
		WHERE s.target_user_id = $1 AND s.direction IN ('LIKE', 'SUPER_SPARK') AND s.undone_at IS NULL
		  AND NOT EXISTS (
			  SELECT 1 FROM blocks b WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = s.actor_user_id)
			                            OR (b.blocker_user_id = s.actor_user_id AND b.blocked_user_id = $1)
		  )
	`
	var total int
	if err := p.pool.QueryRow(ctx, countQuery, userID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("failed to count incoming likes: %w", err)
	}

	query := `
		SELECT s.actor_user_id, p.display_name, p.birthdate,
		       COALESCE(p.bio, ''), p.is_photo_verified, s.created_at,
		       COALESCE(lr.source, ''),
		       COALESCE(ROUND(ST_Distance(pl_actor.coordinates, pl_target.coordinates) / 1000.0)::INT, 1) AS distance_km,
		       s.direction
		FROM swipes s
		JOIN profiles p ON p.user_id = s.actor_user_id
		JOIN users u ON u.id = s.actor_user_id AND u.status = 'ACTIVE'
		LEFT JOIN profile_locations pl_actor ON pl_actor.user_id = s.actor_user_id
		LEFT JOIN profile_locations pl_target ON pl_target.user_id = $1
		LEFT JOIN likes_reveals lr ON lr.user_id = $1 AND lr.liked_by_user_id = s.actor_user_id
		WHERE s.target_user_id = $1 AND s.direction IN ('LIKE', 'SUPER_SPARK') AND s.undone_at IS NULL
		  AND NOT EXISTS (
			  SELECT 1 FROM blocks b WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = s.actor_user_id)
			                            OR (b.blocker_user_id = s.actor_user_id AND b.blocked_user_id = $1)
		  )
		ORDER BY CASE WHEN s.direction = 'SUPER_SPARK' THEN 0 ELSE 1 END ASC, s.created_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := p.pool.Query(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to query incoming likes: %w", err)
	}
	defer rows.Close()

	var likes []IncomingLikeCard
	for rows.Next() {
		var actorID, displayName, bio, source, direction string
		var birthdate, createdAt time.Time
		var isVerified bool
		var dist int

		if err := rows.Scan(
			&actorID, &displayName, &birthdate, &bio, &isVerified, &createdAt, &source, &dist, &direction,
		); err != nil {
			return nil, 0, err
		}

		age := calculateAge(birthdate, time.Now().UTC())
		if dist < 1 {
			dist = 1
		}

		card := IncomingLikeCard{
			UserID:                actorID,
			DisplayName:           displayName,
			Age:                   age,
			Bio:                   bio,
			ApproximateDistanceKm: dist,
			IsPhotoVerified:       isVerified,
			IsRevealed:            source != "",
			LikedAt:               createdAt,
			Photos:                []PhotoCard{},
			InteractionType:       direction,
			IsSuperLike:           direction == "SUPER_SPARK",
		}
		likes = append(likes, card)
	}

	return likes, total, rows.Err()
}

func (p *PostgresRepository) GetRevealedLikes(ctx context.Context, userID string) (map[string]string, error) {
	query := `SELECT liked_by_user_id, source FROM likes_reveals WHERE user_id = $1`
	rows, err := p.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]string)
	for rows.Next() {
		var likedBy, src string
		if err := rows.Scan(&likedBy, &src); err != nil {
			return nil, err
		}
		out[likedBy] = src
	}
	return out, rows.Err()
}

func (p *PostgresRepository) RecordLikeReveal(ctx context.Context, userID, likedByUserID, source string) error {
	query := `
		INSERT INTO likes_reveals (user_id, liked_by_user_id, source, revealed_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (user_id, liked_by_user_id) DO NOTHING
	`
	_, err := p.pool.Exec(ctx, query, userID, likedByUserID, source)
	return err
}

func (p *PostgresRepository) GetUserLikesUnlockState(ctx context.Context, userID string) (*UserLikesUnlockState, error) {
	query := `
		SELECT user_id, free_reveals_used, ad_reveals_today, bonus_reveals_remaining, last_ad_reveal_at
		FROM user_likes_unlock_state
		WHERE user_id = $1
	`
	var st UserLikesUnlockState
	err := p.pool.QueryRow(ctx, query, userID).Scan(
		&st.UserID, &st.FreeRevealsUsed, &st.AdRevealsToday, &st.BonusRevealsRemaining, &st.LastAdRevealAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return &UserLikesUnlockState{
			UserID:                userID,
			FreeRevealsUsed:       0,
			AdRevealsToday:        0,
			BonusRevealsRemaining: 0,
		}, nil
	}
	if err != nil {
		return nil, err
	}
	return &st, nil
}

func (p *PostgresRepository) SaveUserLikesUnlockState(ctx context.Context, state *UserLikesUnlockState) error {
	query := `
		INSERT INTO user_likes_unlock_state (
			user_id, free_reveals_used, ad_reveals_today, bonus_reveals_remaining, last_ad_reveal_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			free_reveals_used = EXCLUDED.free_reveals_used,
			ad_reveals_today = EXCLUDED.ad_reveals_today,
			bonus_reveals_remaining = EXCLUDED.bonus_reveals_remaining,
			last_ad_reveal_at = EXCLUDED.last_ad_reveal_at,
			updated_at = NOW()
	`
	_, err := p.pool.Exec(ctx, query,
		state.UserID, state.FreeRevealsUsed, state.AdRevealsToday,
		state.BonusRevealsRemaining, state.LastAdRevealAt,
	)
	return err
}

func (p *PostgresRepository) GetLikesYouAdStatus(ctx context.Context, userID string) (*LikesYouAdStatus, error) {
	query := `
		SELECT COUNT(*), COALESCE(MIN(verified_at), NOW())
		FROM ad_reward_transactions
		WHERE user_id = $1 AND reward_item = 'LIKES_YOU' AND verified_at >= NOW() - INTERVAL '25 hours'
	`
	var adsCount int
	var earliestVerified time.Time
	if err := p.pool.QueryRow(ctx, query, userID).Scan(&adsCount, &earliestVerified); err != nil {
		return nil, fmt.Errorf("failed to query likes you ad status: %w", err)
	}

	canWatch := adsCount < LikesYouMaxAdsPerWindow
	resetSec := 0
	if !canWatch {
		rem := earliestVerified.Add(LikesYouAdWindowHours).Sub(time.Now().UTC())
		resetSec = int(math.Ceil(rem.Seconds()))
		if resetSec < 0 {
			resetSec = 0
		}
	}

	return &LikesYouAdStatus{
		AdsWatchedInWindow:       adsCount,
		MaxAdsPerWindow:          LikesYouMaxAdsPerWindow,
		CanWatchAd:               canWatch,
		AdResetInSeconds:         resetSec,
		ProfilesUnlockedInWindow: adsCount * LikesYouProfilesPerAd,
		MaxProfilesPerWindow:     LikesYouMaxProfilesPerWindow,
	}, nil
}

func (p *PostgresRepository) UnlockLikesYouAdReward(ctx context.Context, userID string, transactionID string) (*LikesYouAdRewardResult, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// 1. Serialize concurrent requests for this user
	lockQuery := `
		INSERT INTO user_likes_unlock_state (user_id)
		VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING
	`
	if _, err := tx.Exec(ctx, lockQuery, userID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, "SELECT 1 FROM user_likes_unlock_state WHERE user_id = $1 FOR UPDATE", userID); err != nil {
		return nil, err
	}

	// 2. Replay check
	var exists bool
	checkTxQuery := `SELECT EXISTS(SELECT 1 FROM ad_reward_transactions WHERE transaction_id = $1)`
	if err := tx.QueryRow(ctx, checkTxQuery, transactionID).Scan(&exists); err != nil {
		return nil, err
	}
	if exists {
		return nil, ErrDuplicateSSVReward
	}

	// 3. Check rolling 25-hour limit
	countQuery := `
		SELECT COUNT(*), COALESCE(MIN(verified_at), NOW())
		FROM ad_reward_transactions
		WHERE user_id = $1 AND reward_item = 'LIKES_YOU' AND verified_at >= NOW() - INTERVAL '25 hours'
	`
	var adsCount int
	var earliestVerified time.Time
	if err := tx.QueryRow(ctx, countQuery, userID).Scan(&adsCount, &earliestVerified); err != nil {
		return nil, err
	}

	if adsCount >= LikesYouMaxAdsPerWindow {
		rem := earliestVerified.Add(LikesYouAdWindowHours).Sub(time.Now().UTC())
		resetSec := int(math.Ceil(rem.Seconds()))
		if resetSec < 0 {
			resetSec = 0
		}
		return nil, ErrLikesYouAdLimitReached
	}

	// 4. Record ad transaction
	insertTxQuery := `
		INSERT INTO ad_reward_transactions (user_id, ad_network, transaction_id, reward_item, reward_amount, verified_at)
		VALUES ($1, 'ADMOB', $2, 'LIKES_YOU', $3, NOW())
	`
	if _, err := tx.Exec(ctx, insertTxQuery, userID, transactionID, LikesYouProfilesPerAd); err != nil {
		if strings.Contains(err.Error(), "uq_ad_reward_tx") || strings.Contains(err.Error(), "duplicate key") {
			return nil, ErrDuplicateSSVReward
		}
		return nil, err
	}

	// 5. Find up to 2 unrevealed incoming likes
	findQuery := `
		SELECT s.actor_user_id
		FROM swipes s
		JOIN users u ON u.id = s.actor_user_id AND u.status = 'ACTIVE'
		WHERE s.target_user_id = $1 AND s.direction IN ('LIKE', 'SUPER_SPARK') AND s.undone_at IS NULL
		  AND NOT EXISTS (
			  SELECT 1 FROM blocks b WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = s.actor_user_id)
			                            OR (b.blocker_user_id = s.actor_user_id AND b.blocked_user_id = $1)
		  )
		  AND NOT EXISTS (
			  SELECT 1 FROM likes_reveals lr WHERE lr.user_id = $1 AND lr.liked_by_user_id = s.actor_user_id
		  )
		ORDER BY CASE WHEN s.direction = 'SUPER_SPARK' THEN 0 ELSE 1 END ASC, s.created_at DESC
		LIMIT $2
	`
	rows, err := tx.Query(ctx, findQuery, userID, LikesYouProfilesPerAd)
	if err != nil {
		return nil, err
	}
	var actorIDs []string
	for rows.Next() {
		var aID string
		if err := rows.Scan(&aID); err == nil {
			actorIDs = append(actorIDs, aID)
		}
	}
	rows.Close()

	var newlyUnlocked []string
	for _, aID := range actorIDs {
		revealQuery := `
			INSERT INTO likes_reveals (user_id, liked_by_user_id, source, revealed_at)
			VALUES ($1, $2, 'REWARDED_AD', NOW())
			ON CONFLICT (user_id, liked_by_user_id) DO NOTHING
		`
		tag, err := tx.Exec(ctx, revealQuery, userID, aID)
		if err == nil && tag.RowsAffected() > 0 {
			newlyUnlocked = append(newlyUnlocked, aID)
		}
	}

	remainder := LikesYouProfilesPerAd - len(newlyUnlocked)
	if remainder < 0 {
		remainder = 0
	}

	// 6. Update user_likes_unlock_state
	updateStateQuery := `
		UPDATE user_likes_unlock_state
		SET bonus_reveals_remaining = bonus_reveals_remaining + $2,
		    ad_reveals_today = ad_reveals_today + 1,
		    last_ad_reveal_at = NOW(),
		    updated_at = NOW()
		WHERE user_id = $1
		RETURNING bonus_reveals_remaining
	`
	var bonusRemaining int
	if err := tx.QueryRow(ctx, updateStateQuery, userID, remainder).Scan(&bonusRemaining); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	newCount := adsCount + 1
	canWatch := newCount < LikesYouMaxAdsPerWindow
	resetSec := 0
	if !canWatch {
		rem := earliestVerified.Add(LikesYouAdWindowHours).Sub(time.Now().UTC())
		resetSec = int(math.Ceil(rem.Seconds()))
		if resetSec < 0 {
			resetSec = 0
		}
	}

	return &LikesYouAdRewardResult{
		AdsWatchedInWindow:    newCount,
		MaxAdsPerWindow:       LikesYouMaxAdsPerWindow,
		CanWatchAd:            canWatch,
		AdResetInSeconds:      resetSec,
		NewlyUnlockedUserIDs:  newlyUnlocked,
		BonusRevealsRemaining: bonusRemaining,
	}, nil
}

func (p *PostgresRepository) CreateMessageRequest(ctx context.Context, req *MessageRequest) error {
	query := `
		INSERT INTO message_requests (id, sender_user_id, recipient_user_id, body, status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`
	_, err := p.pool.Exec(ctx, query, req.ID, req.SenderUserID, req.RecipientUserID, req.Body, req.Status, req.CreatedAt)
	return err
}

func (p *PostgresRepository) ListMessageRequests(ctx context.Context, userID string, folder string) ([]MessageRequest, error) {
	where := "mr.recipient_user_id = $1"
	if folder == "sent" {
		where = "mr.sender_user_id = $1"
	}

	query := fmt.Sprintf(`
		SELECT mr.id, mr.sender_user_id, mr.recipient_user_id, mr.body, mr.status, mr.created_at, mr.responded_at,
		       p.display_name, p.birthdate, COALESCE(p.bio, ''), p.is_photo_verified
		FROM message_requests mr
		JOIN profiles p ON p.user_id = mr.sender_user_id
		WHERE %s
		ORDER BY mr.created_at DESC
	`, where)

	rows, err := p.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []MessageRequest
	for rows.Next() {
		var req MessageRequest
		var displayName, bio string
		var birthdate time.Time
		var isVerified bool

		if err := rows.Scan(
			&req.ID, &req.SenderUserID, &req.RecipientUserID, &req.Body, &req.Status, &req.CreatedAt, &req.RespondedAt,
			&displayName, &birthdate, &bio, &isVerified,
		); err != nil {
			return nil, err
		}

		age := calculateAge(birthdate, time.Now().UTC())
		req.SenderProfile = &DiscoveryCandidate{
			UserID:          req.SenderUserID,
			DisplayName:     displayName,
			Age:             age,
			Bio:             bio,
			IsPhotoVerified: isVerified,
			Photos:          []PhotoCard{},
		}
		results = append(results, req)
	}
	return results, rows.Err()
}

func (p *PostgresRepository) UpdateMessageRequestStatus(ctx context.Context, requestID, recipientID, status string) error {
	query := `
		UPDATE message_requests
		SET status = $3, responded_at = NOW()
		WHERE id = $1 AND recipient_user_id = $2
	`
	tag, err := p.pool.Exec(ctx, query, requestID, recipientID, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("message request not found or unauthorized")
	}
	return nil
}

func (p *PostgresRepository) consumeDiscoveryMessageSlotTx(ctx context.Context, tx pgx.Tx, actorID, targetID string) error {
	now := time.Now().UTC()

	// 1. Check if user has unlimited swipes/messages entitlement
	var entFound int
	err := tx.QueryRow(ctx, "SELECT 1 FROM user_entitlements WHERE user_id = $1 AND (entitlement_code IN ('VIP_SUBSCRIPTION', 'UNLIMITED_MESSAGING') OR (entitlement_code = 'UNLIMITED_SWIPES' AND source != 'MATCH_REWARD')) AND expires_at > NOW() LIMIT 1", actorID).Scan(&entFound)
	if err == nil && entFound == 1 {
		return nil
	}

	var trialStartedAt, trialEndsAt, updatedAt time.Time
	var cooldownExpiresAt *time.Time
	var trialDiscoveryProfileIDs []string
	var trialDiscoveryAllowed, trialDiscoveryAdsWatched, postTrialOutgoingCount, postTrialBonusOutgoingCount int
	var postTrialAdUnlocked bool

	selectQuery := `
		SELECT trial_started_at, trial_ends_at, trial_discovery_profile_ids, trial_discovery_allowed_count,
		       trial_discovery_ads_watched, post_trial_outgoing_count, post_trial_ad_unlocked,
		       post_trial_bonus_outgoing_count, cooldown_expires_at, updated_at
		FROM discovery_message_quotas
		WHERE user_id = $1
		FOR UPDATE
	`
	err = tx.QueryRow(ctx, selectQuery, actorID).Scan(
		&trialStartedAt, &trialEndsAt, &trialDiscoveryProfileIDs, &trialDiscoveryAllowed,
		&trialDiscoveryAdsWatched, &postTrialOutgoingCount, &postTrialAdUnlocked,
		&postTrialBonusOutgoingCount, &cooldownExpiresAt, &updatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			var createdAt time.Time
			_ = tx.QueryRow(ctx, "SELECT created_at FROM users WHERE id = $1", actorID).Scan(&createdAt)
			if createdAt.IsZero() {
				createdAt = now
			}
			trialStartedAt = createdAt
			trialEndsAt = createdAt.Add(TrialDuration)
			trialDiscoveryAllowed = TrialDiscoveryFreeBatchQuota

			if now.Before(trialEndsAt) {
				trialDiscoveryProfileIDs = []string{targetID}
				insertQuery := `
					INSERT INTO discovery_message_quotas (
						user_id, trial_started_at, trial_ends_at, trial_discovery_profile_ids,
						trial_discovery_allowed_count, trial_discovery_ads_watched,
						post_trial_outgoing_count, post_trial_ad_unlocked,
						post_trial_bonus_outgoing_count, cooldown_expires_at, updated_at
					) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
				`
				_, err = tx.Exec(ctx, insertQuery, actorID, trialStartedAt, trialEndsAt, trialDiscoveryProfileIDs, trialDiscoveryAllowed, 0, 0, false, 0, nil, now)
				return err
			} else {
				postTrialOutgoingCount = 1
				insertQuery := `
					INSERT INTO discovery_message_quotas (
						user_id, trial_started_at, trial_ends_at, trial_discovery_profile_ids,
						trial_discovery_allowed_count, trial_discovery_ads_watched,
						post_trial_outgoing_count, post_trial_ad_unlocked,
						post_trial_bonus_outgoing_count, cooldown_expires_at, updated_at
					) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
				`
				_, err = tx.Exec(ctx, insertQuery, actorID, trialStartedAt, trialEndsAt, []string{}, trialDiscoveryAllowed, 0, postTrialOutgoingCount, false, 0, nil, now)
				return err
			}
		}
		return fmt.Errorf("failed to query discovery message quota: %w", err)
	}

	if trialDiscoveryAllowed <= 0 {
		trialDiscoveryAllowed = TrialDiscoveryFreeBatchQuota
	}

	// 3. In trial mode
	if now.Before(trialEndsAt) {
		// A. Check 3-hour cooldown
		if cooldownExpiresAt != nil {
			if cooldownExpiresAt.After(now) {
				return ErrDiscoveryMessageUsageLimitReached
			}
			// Cooldown expired! Reset trial cycle
			trialDiscoveryProfileIDs = []string{}
			trialDiscoveryAllowed = TrialDiscoveryFreeBatchQuota
			trialDiscoveryAdsWatched = 0
			cooldownExpiresAt = nil
			updateResetQuery := `
				UPDATE discovery_message_quotas
				SET trial_discovery_profile_ids = '{}',
				    trial_discovery_allowed_count = $2,
				    trial_discovery_ads_watched = 0,
				    cooldown_expires_at = NULL,
				    updated_at = $3
				WHERE user_id = $1
			`
			if _, err := tx.Exec(ctx, updateResetQuery, actorID, TrialDiscoveryFreeBatchQuota, now); err != nil {
				return err
			}
		}

		// B. Check if targetID already contacted
		alreadyContacted := false
		for _, id := range trialDiscoveryProfileIDs {
			if id == targetID {
				alreadyContacted = true
				break
			}
		}

		if alreadyContacted {
			// One initial message per Discovery profile until they reply
			var replyFound int
			replyQuery := `
				SELECT 1 FROM (
					SELECT 1 FROM message_requests
					WHERE ((sender_user_id = $1 AND recipient_user_id = $2 AND status = 'ACCEPTED')
					    OR (sender_user_id = $2 AND recipient_user_id = $1))
					UNION ALL
					SELECT 1 FROM messages m
					JOIN conversations c ON c.id = m.conversation_id
					JOIN matches match ON match.id = c.match_id
					WHERE m.sender_user_id = $2
					  AND ((match.user_low_id = $1 AND match.user_high_id = $2)
					    OR (match.user_low_id = $2 AND match.user_high_id = $1))
				) replies LIMIT 1
			`
			err := tx.QueryRow(ctx, replyQuery, actorID, targetID).Scan(&replyFound)
			if err != nil || replyFound == 0 {
				return ErrDiscoveryMessageAwaitingReply
			}
			return nil
		}

		// C. Target is a new distinct profile
		if len(trialDiscoveryProfileIDs) < trialDiscoveryAllowed {
			trialDiscoveryProfileIDs = append(trialDiscoveryProfileIDs, targetID)
			var newCooldown *time.Time
			if len(trialDiscoveryProfileIDs) >= TrialDiscoveryMaxCycleProfiles {
				exp := now.Add(TrialDiscoveryCycleCooldown)
				newCooldown = &exp
			}
			updateQuery := `
				UPDATE discovery_message_quotas
				SET trial_discovery_profile_ids = $2,
				    cooldown_expires_at = $3,
				    updated_at = $4
				WHERE user_id = $1
			`
			_, err = tx.Exec(ctx, updateQuery, actorID, trialDiscoveryProfileIDs, newCooldown, now)
			return err
		}
		return ErrDiscoveryMessageQuotaLocked
	}

	// 4. Post-trial mode
	if postTrialOutgoingCount < PostTrialFreeQuota {
		postTrialOutgoingCount++
		updateQuery := `
			UPDATE discovery_message_quotas
			SET post_trial_outgoing_count = $2, updated_at = $3
			WHERE user_id = $1
		`
		_, err = tx.Exec(ctx, updateQuery, actorID, postTrialOutgoingCount, now)
		return err
	}

	if postTrialAdUnlocked && postTrialBonusOutgoingCount < PostTrialBonusQuota {
		postTrialBonusOutgoingCount++
		updateQuery := `
			UPDATE discovery_message_quotas
			SET post_trial_bonus_outgoing_count = $2, updated_at = $3
			WHERE user_id = $1
		`
		_, err = tx.Exec(ctx, updateQuery, actorID, postTrialBonusOutgoingCount, now)
		return err
	}

	return ErrDiscoveryMessageQuotaLocked
}

func (p *PostgresRepository) ConsumeDiscoveryMessageSlot(ctx context.Context, actorID, targetID string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := p.consumeDiscoveryMessageSlotTx(ctx, tx, actorID, targetID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (p *PostgresRepository) ConsumeChatOutgoingSlot(ctx context.Context, userID string) error {
	now := time.Now().UTC()

	var entFound int
	_ = p.pool.QueryRow(ctx, "SELECT 1 FROM user_entitlements WHERE user_id = $1 AND (entitlement_code IN ('VIP_SUBSCRIPTION', 'UNLIMITED_MESSAGING') OR (entitlement_code = 'UNLIMITED_SWIPES' AND source != 'MATCH_REWARD')) AND expires_at > NOW() LIMIT 1", userID).Scan(&entFound)
	if entFound == 1 {
		return nil
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var trialStartedAt, trialEndsAt, updatedAt time.Time
	var trialDiscoveryProfileIDs []string
	var trialDiscoveryAllowed, trialDiscoveryAdsWatched, postTrialOutgoingCount, postTrialBonusOutgoingCount int
	var postTrialAdUnlocked bool

	selectQuery := `
		SELECT trial_started_at, trial_ends_at, trial_discovery_profile_ids, trial_discovery_allowed_count,
		       trial_discovery_ads_watched, post_trial_outgoing_count, post_trial_ad_unlocked,
		       post_trial_bonus_outgoing_count, updated_at
		FROM discovery_message_quotas
		WHERE user_id = $1
		FOR UPDATE
	`
	err = tx.QueryRow(ctx, selectQuery, userID).Scan(
		&trialStartedAt, &trialEndsAt, &trialDiscoveryProfileIDs, &trialDiscoveryAllowed,
		&trialDiscoveryAdsWatched, &postTrialOutgoingCount, &postTrialAdUnlocked,
		&postTrialBonusOutgoingCount, &updatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			var createdAt time.Time
			_ = tx.QueryRow(ctx, "SELECT created_at FROM users WHERE id = $1", userID).Scan(&createdAt)
			if createdAt.IsZero() {
				createdAt = now
			}
			trialStartedAt = createdAt
			trialEndsAt = createdAt.Add(TrialDuration)
			trialDiscoveryAllowed = TrialDiscoveryFreeBatchQuota

			if now.Before(trialEndsAt) {
				insertQuery := `
					INSERT INTO discovery_message_quotas (
						user_id, trial_started_at, trial_ends_at, trial_discovery_profile_ids,
						trial_discovery_allowed_count, trial_discovery_ads_watched,
						post_trial_outgoing_count, post_trial_ad_unlocked,
						post_trial_bonus_outgoing_count, updated_at
					) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
				`
				_, err = tx.Exec(ctx, insertQuery, userID, trialStartedAt, trialEndsAt, []string{}, trialDiscoveryAllowed, 0, 0, false, 0, now)
				if err != nil {
					return err
				}
				return tx.Commit(ctx)
			} else {
				postTrialOutgoingCount = 1
				insertQuery := `
					INSERT INTO discovery_message_quotas (
						user_id, trial_started_at, trial_ends_at, trial_discovery_profile_ids,
						trial_discovery_allowed_count, trial_discovery_ads_watched,
						post_trial_outgoing_count, post_trial_ad_unlocked,
						post_trial_bonus_outgoing_count, updated_at
					) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
				`
				_, err = tx.Exec(ctx, insertQuery, userID, trialStartedAt, trialEndsAt, []string{}, trialDiscoveryAllowed, 0, postTrialOutgoingCount, false, 0, now)
				if err != nil {
					return err
				}
				return tx.Commit(ctx)
			}
		}
		return fmt.Errorf("failed to query discovery message quota: %w", err)
	}

	// During trial: all messages and replies within existing conversations are unlimited!
	if now.Before(trialEndsAt) {
		return nil
	}

	// Post-trial mode
	if postTrialOutgoingCount < PostTrialFreeQuota {
		postTrialOutgoingCount++
		updateQuery := `
			UPDATE discovery_message_quotas
			SET post_trial_outgoing_count = $2, updated_at = $3
			WHERE user_id = $1
		`
		if _, err := tx.Exec(ctx, updateQuery, userID, postTrialOutgoingCount, now); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	if postTrialAdUnlocked && postTrialBonusOutgoingCount < PostTrialBonusQuota {
		postTrialBonusOutgoingCount++
		updateQuery := `
			UPDATE discovery_message_quotas
			SET post_trial_bonus_outgoing_count = $2, updated_at = $3
			WHERE user_id = $1
		`
		if _, err := tx.Exec(ctx, updateQuery, userID, postTrialBonusOutgoingCount, now); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	return ErrDiscoveryMessageQuotaLocked
}

func (p *PostgresRepository) GetDiscoveryMessageQuota(ctx context.Context, userID string) (*DiscoveryMessagingQuota, error) {
	now := time.Now().UTC()

	var entFound int
	_ = p.pool.QueryRow(ctx, "SELECT 1 FROM user_entitlements WHERE user_id = $1 AND (entitlement_code IN ('VIP_SUBSCRIPTION', 'UNLIMITED_MESSAGING') OR (entitlement_code = 'UNLIMITED_SWIPES' AND source != 'MATCH_REWARD')) AND expires_at > NOW() LIMIT 1", userID).Scan(&entFound)
	isUnlimited := (entFound == 1)
	if isUnlimited {
		return evaluateMessageQuotaState(&DiscoveryMessageQuotaState{UserID: userID}, now, true), nil
	}

	var trialStartedAt, trialEndsAt, updatedAt time.Time
	var cooldownExpiresAt *time.Time
	var trialDiscoveryProfileIDs []string
	var trialDiscoveryAllowed, trialDiscoveryAdsWatched, postTrialOutgoingCount, postTrialBonusOutgoingCount int
	var postTrialAdUnlocked bool

	selectQuery := `
		SELECT trial_started_at, trial_ends_at, trial_discovery_profile_ids, trial_discovery_allowed_count,
		       trial_discovery_ads_watched, post_trial_outgoing_count, post_trial_ad_unlocked,
		       post_trial_bonus_outgoing_count, cooldown_expires_at, updated_at
		FROM discovery_message_quotas
		WHERE user_id = $1
	`
	err := p.pool.QueryRow(ctx, selectQuery, userID).Scan(
		&trialStartedAt, &trialEndsAt, &trialDiscoveryProfileIDs, &trialDiscoveryAllowed,
		&trialDiscoveryAdsWatched, &postTrialOutgoingCount, &postTrialAdUnlocked,
		&postTrialBonusOutgoingCount, &cooldownExpiresAt, &updatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			var createdAt time.Time
			_ = p.pool.QueryRow(ctx, "SELECT created_at FROM users WHERE id = $1", userID).Scan(&createdAt)
			if createdAt.IsZero() {
				createdAt = now
			}
			trialStartedAt = createdAt
			trialEndsAt = createdAt.Add(TrialDuration)
			trialDiscoveryAllowed = TrialDiscoveryFreeBatchQuota

			state := &DiscoveryMessageQuotaState{
				UserID:                   userID,
				TrialStartedAt:           trialStartedAt,
				TrialEndsAt:              trialEndsAt,
				TrialDiscoveryProfileIDs: []string{},
				TrialDiscoveryAllowed:    trialDiscoveryAllowed,
				TrialDiscoveryAdsWatched: 0,
				PostTrialOutgoingCount:   0,
				PostTrialAdUnlocked:      false,
				PostTrialBonusOutgoing:   0,
				CooldownExpiresAt:        nil,
				UpdatedAt:                now,
			}
			return evaluateMessageQuotaState(state, now, false), nil
		}
		return nil, fmt.Errorf("failed to query discovery message quota: %w", err)
	}

	if trialDiscoveryAllowed <= 0 {
		trialDiscoveryAllowed = TrialDiscoveryFreeBatchQuota
	}

	if now.Before(trialEndsAt) && cooldownExpiresAt != nil && !cooldownExpiresAt.After(now) {
		// Cooldown expired! Reset cycle in DB
		trialDiscoveryProfileIDs = []string{}
		trialDiscoveryAllowed = TrialDiscoveryFreeBatchQuota
		trialDiscoveryAdsWatched = 0
		cooldownExpiresAt = nil
		_, _ = p.pool.Exec(ctx, `
			UPDATE discovery_message_quotas
			SET trial_discovery_profile_ids = '{}',
			    trial_discovery_allowed_count = $2,
			    trial_discovery_ads_watched = 0,
			    cooldown_expires_at = NULL,
			    updated_at = $3
			WHERE user_id = $1
		`, userID, TrialDiscoveryFreeBatchQuota, now)
	}

	state := &DiscoveryMessageQuotaState{
		UserID:                   userID,
		TrialStartedAt:           trialStartedAt,
		TrialEndsAt:              trialEndsAt,
		TrialDiscoveryProfileIDs: trialDiscoveryProfileIDs,
		TrialDiscoveryAllowed:    trialDiscoveryAllowed,
		TrialDiscoveryAdsWatched: trialDiscoveryAdsWatched,
		PostTrialOutgoingCount:   postTrialOutgoingCount,
		PostTrialAdUnlocked:      postTrialAdUnlocked,
		PostTrialBonusOutgoing:   postTrialBonusOutgoingCount,
		CooldownExpiresAt:        cooldownExpiresAt,
		UpdatedAt:                updatedAt,
	}

	return evaluateMessageQuotaState(state, now, false), nil
}

func (p *PostgresRepository) UnlockDiscoveryMessageAdBonus(ctx context.Context, actorID string) (*DiscoveryMessagingQuota, error) {
	now := time.Now().UTC()

	var entFound int
	_ = p.pool.QueryRow(ctx, "SELECT 1 FROM user_entitlements WHERE user_id = $1 AND (entitlement_code IN ('VIP_SUBSCRIPTION', 'UNLIMITED_MESSAGING') OR (entitlement_code = 'UNLIMITED_SWIPES' AND source != 'MATCH_REWARD')) AND expires_at > NOW() LIMIT 1", actorID).Scan(&entFound)
	if entFound == 1 {
		return evaluateMessageQuotaState(&DiscoveryMessageQuotaState{UserID: actorID}, now, true), nil
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var trialStartedAt, trialEndsAt, updatedAt time.Time
	var cooldownExpiresAt *time.Time
	var trialDiscoveryProfileIDs []string
	var trialDiscoveryAllowed, trialDiscoveryAdsWatched, postTrialOutgoingCount, postTrialBonusOutgoingCount int
	var postTrialAdUnlocked bool

	selectQuery := `
		SELECT trial_started_at, trial_ends_at, trial_discovery_profile_ids, trial_discovery_allowed_count,
		       trial_discovery_ads_watched, post_trial_outgoing_count, post_trial_ad_unlocked,
		       post_trial_bonus_outgoing_count, cooldown_expires_at, updated_at
		FROM discovery_message_quotas
		WHERE user_id = $1
		FOR UPDATE
	`
	err = tx.QueryRow(ctx, selectQuery, actorID).Scan(
		&trialStartedAt, &trialEndsAt, &trialDiscoveryProfileIDs, &trialDiscoveryAllowed,
		&trialDiscoveryAdsWatched, &postTrialOutgoingCount, &postTrialAdUnlocked,
		&postTrialBonusOutgoingCount, &cooldownExpiresAt, &updatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDiscoveryMessageCooldownNotActive
		}
		return nil, fmt.Errorf("failed to query discovery message quota: %w", err)
	}

	if trialDiscoveryAllowed <= 0 {
		trialDiscoveryAllowed = TrialDiscoveryFreeBatchQuota
	}

	if now.Before(trialEndsAt) {
		if cooldownExpiresAt != nil && cooldownExpiresAt.After(now) {
			return nil, ErrDiscoveryMessageUsageLimitReached
		}
		if trialDiscoveryAdsWatched >= TrialDiscoveryMaxAdsPerCycle {
			return nil, ErrDiscoveryMessageMaxAdsReached
		}
		if len(trialDiscoveryProfileIDs) < trialDiscoveryAllowed {
			return nil, ErrDiscoveryMessageCooldownNotActive
		}
		trialDiscoveryAllowed += TrialDiscoveryAdBatchQuota
		trialDiscoveryAdsWatched++
		updateQuery := `
			UPDATE discovery_message_quotas
			SET trial_discovery_allowed_count = $2, trial_discovery_ads_watched = $3, updated_at = $4
			WHERE user_id = $1
		`
		if _, err := tx.Exec(ctx, updateQuery, actorID, trialDiscoveryAllowed, trialDiscoveryAdsWatched, now); err != nil {
			return nil, fmt.Errorf("failed to update discovery message quota: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}

		state := &DiscoveryMessageQuotaState{
			UserID:                   actorID,
			TrialStartedAt:           trialStartedAt,
			TrialEndsAt:              trialEndsAt,
			TrialDiscoveryProfileIDs: trialDiscoveryProfileIDs,
			TrialDiscoveryAllowed:    trialDiscoveryAllowed,
			TrialDiscoveryAdsWatched: trialDiscoveryAdsWatched,
			PostTrialOutgoingCount:   postTrialOutgoingCount,
			PostTrialAdUnlocked:      postTrialAdUnlocked,
			PostTrialBonusOutgoing:   postTrialBonusOutgoingCount,
			CooldownExpiresAt:        cooldownExpiresAt,
			UpdatedAt:                now,
		}
		return evaluateMessageQuotaState(state, now, false), nil
	}

	// Post-trial
	if postTrialOutgoingCount < PostTrialFreeQuota {
		return nil, ErrDiscoveryMessageCooldownNotActive
	}
	if postTrialAdUnlocked && postTrialBonusOutgoingCount < PostTrialBonusQuota {
		return nil, ErrDiscoveryMessageAdAlreadyUnlocked
	}

	postTrialAdUnlocked = true
	postTrialBonusOutgoingCount = 0
	updateQuery := `
		UPDATE discovery_message_quotas
		SET post_trial_ad_unlocked = $2, post_trial_bonus_outgoing_count = $3, updated_at = $4
		WHERE user_id = $1
	`
	if _, err := tx.Exec(ctx, updateQuery, actorID, postTrialAdUnlocked, postTrialBonusOutgoingCount, now); err != nil {
		return nil, fmt.Errorf("failed to update discovery message quota: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	state := &DiscoveryMessageQuotaState{
		UserID:                   actorID,
		TrialStartedAt:           trialStartedAt,
		TrialEndsAt:              trialEndsAt,
		TrialDiscoveryProfileIDs: trialDiscoveryProfileIDs,
		TrialDiscoveryAllowed:    trialDiscoveryAllowed,
		TrialDiscoveryAdsWatched: trialDiscoveryAdsWatched,
		PostTrialOutgoingCount:   postTrialOutgoingCount,
		PostTrialAdUnlocked:      postTrialAdUnlocked,
		PostTrialBonusOutgoing:   postTrialBonusOutgoingCount,
		CooldownExpiresAt:        nil,
		UpdatedAt:                now,
	}
	return evaluateMessageQuotaState(state, now, false), nil
}

func (p *PostgresRepository) HasRecipientReplied(ctx context.Context, senderID, recipientID string) (bool, error) {
	var replyFound int
	replyQuery := `
		SELECT 1 FROM (
			SELECT 1 FROM message_requests
			WHERE ((sender_user_id = $1 AND recipient_user_id = $2 AND status = 'ACCEPTED')
			    OR (sender_user_id = $2 AND recipient_user_id = $1))
			UNION ALL
			SELECT 1 FROM messages m
			JOIN conversations c ON c.id = m.conversation_id
			JOIN matches match ON match.id = c.match_id
			WHERE m.sender_user_id = $2
			  AND ((match.user_low_id = $1 AND match.user_high_id = $2)
			    OR (match.user_low_id = $2 AND match.user_high_id = $1))
		) replies LIMIT 1
	`
	err := p.pool.QueryRow(ctx, replyQuery, senderID, recipientID).Scan(&replyFound)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return replyFound == 1, nil
}

func (p *PostgresRepository) RecordRecipientReply(_ context.Context, _, _ string) error {
	return nil
}

func (p *PostgresRepository) CheckCanSendChat(ctx context.Context, senderID, recipientID string) error {
	now := time.Now().UTC()

	var entFound int
	_ = p.pool.QueryRow(ctx, "SELECT 1 FROM user_entitlements WHERE user_id = $1 AND (entitlement_code IN ('VIP_SUBSCRIPTION', 'UNLIMITED_MESSAGING') OR (entitlement_code = 'UNLIMITED_SWIPES' AND source != 'MATCH_REWARD')) AND expires_at > NOW() LIMIT 1", senderID).Scan(&entFound)
	if entFound == 1 {
		return nil
	}

	var trialEndsAt time.Time
	var trialDiscoveryProfileIDs []string
	query := `SELECT trial_ends_at, trial_discovery_profile_ids FROM discovery_message_quotas WHERE user_id = $1`
	err := p.pool.QueryRow(ctx, query, senderID).Scan(&trialEndsAt, &trialDiscoveryProfileIDs)
	if err != nil {
		return nil // No quota record yet
	}

	if now.Before(trialEndsAt) {
		isDiscoveryContact := false
		for _, id := range trialDiscoveryProfileIDs {
			if id == recipientID {
				isDiscoveryContact = true
				break
			}
		}
		if isDiscoveryContact {
			replied, err := p.HasRecipientReplied(ctx, senderID, recipientID)
			if err != nil || !replied {
				return ErrDiscoveryMessageAwaitingReply
			}
		}
	}

	return nil
}

func (p *PostgresRepository) AddFavourite(ctx context.Context, userID, targetUserID string) (*UserFavourite, error) {
	if userID == targetUserID {
		return nil, ErrSelfFavourite
	}

	// Check if blocked
	blocked, err := p.IsBlocked(ctx, userID, targetUserID)
	if err != nil {
		return nil, err
	}
	if blocked {
		return nil, ErrCandidateBlocked
	}

	query := `
		INSERT INTO user_favourites (id, user_id, target_user_id, created_at)
		VALUES (gen_random_uuid(), $1, $2, NOW())
		ON CONFLICT (user_id, target_user_id) DO UPDATE SET created_at = NOW()
		RETURNING id, user_id, target_user_id, created_at
	`
	var fav UserFavourite
	err = p.pool.QueryRow(ctx, query, userID, targetUserID).Scan(
		&fav.ID, &fav.UserID, &fav.TargetUserID, &fav.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to add favourite: %w", err)
	}
	return &fav, nil
}

func (p *PostgresRepository) RemoveFavourite(ctx context.Context, userID, targetUserID string) error {
	query := `DELETE FROM user_favourites WHERE user_id = $1 AND target_user_id = $2`
	_, err := p.pool.Exec(ctx, query, userID, targetUserID)
	if err != nil {
		return fmt.Errorf("failed to remove favourite: %w", err)
	}
	return nil
}

func (p *PostgresRepository) ListFavourites(ctx context.Context, userID string) ([]FavouriteProfileCard, error) {
	query := `
		SELECT uf.target_user_id, p.display_name, p.birthdate, COALESCE(p.bio, ''), uf.created_at
		FROM user_favourites uf
		JOIN profiles p ON p.user_id = uf.target_user_id
		JOIN users u ON u.id = uf.target_user_id AND u.status = 'ACTIVE'
		WHERE uf.user_id = $1
		  AND NOT EXISTS (
			  SELECT 1 FROM blocks b WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = uf.target_user_id)
			                            OR (b.blocker_user_id = uf.target_user_id AND b.blocked_user_id = $1)
		  )
		ORDER BY uf.created_at DESC
	`
	rows, err := p.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query favourites: %w", err)
	}
	defer rows.Close()

	var results []FavouriteProfileCard
	for rows.Next() {
		var targetID, displayName, bio string
		var birthdate, createdAt time.Time

		if err := rows.Scan(&targetID, &displayName, &birthdate, &bio, &createdAt); err != nil {
			return nil, err
		}

		age := calculateAge(birthdate, time.Now().UTC())
		results = append(results, FavouriteProfileCard{
			UserID:      targetID,
			DisplayName: displayName,
			Age:         age,
			Bio:         bio,
			PhotoURL:    "",
			AddedAt:     createdAt,
		})
	}
	if results == nil {
		results = []FavouriteProfileCard{}
	}
	return results, rows.Err()
}

func (p *PostgresRepository) IsFavourite(ctx context.Context, userID, targetUserID string) (bool, error) {
	query := `SELECT EXISTS(SELECT 1 FROM user_favourites WHERE user_id = $1 AND target_user_id = $2)`
	var exists bool
	err := p.pool.QueryRow(ctx, query, userID, targetUserID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}


// Helpers

func canonicalPair(u1, u2 string) (low, high string) {
	if strings.Compare(u1, u2) < 0 {
		return u1, u2
	}
	return u2, u1
}

func calculateAge(birthdate time.Time, now time.Time) int {
	years := now.Year() - birthdate.Year()
	if now.YearDay() < birthdate.YearDay() {
		years--
	}
	return years
}

func hasOverlap(sliceA, sliceB []string) bool {
	set := make(map[string]struct{}, len(sliceA))
	for _, item := range sliceA {
		norm := strings.ToLower(strings.TrimSpace(item))
		if norm == "all" || norm == "everyone" {
			return true
		}
		set[norm] = struct{}{}
		if norm == "woman" {
			set["cisgender woman"] = struct{}{}
			set["cis woman"] = struct{}{}
			set["transgender woman"] = struct{}{}
			set["trans woman"] = struct{}{}
		} else if norm == "man" {
			set["cisgender man"] = struct{}{}
			set["cis man"] = struct{}{}
			set["transgender man"] = struct{}{}
			set["trans man"] = struct{}{}
		}
	}
	for _, item := range sliceB {
		norm := strings.ToLower(strings.TrimSpace(item))
		if norm == "all" || norm == "everyone" {
			return true
		}
		if _, ok := set[norm]; ok {
			return true
		}
	}
	return false
}

func haversineDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusKm = 6371.0
	dLat := (lat2 - lat1) * (math.Pi / 180.0)
	dLon := (lon2 - lon1) * (math.Pi / 180.0)

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*(math.Pi/180.0))*math.Cos(lat2*(math.Pi/180.0))*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusKm * c
}
