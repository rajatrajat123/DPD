package discovery

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/media"
)

type Service struct {
	repo               Repository
	identRepo          identity.Repository
	mediaSvc           *media.Service
	verifier           *SSVVerifier
	entitlementChecker EntitlementChecker
	ageChecker         AgeChecker
	logger             *slog.Logger
}

// AgeChecker verifies whether an actor has approved age verification.
type AgeChecker func(ctx context.Context, userID string) (bool, error)

// EntitlementChecker verifies whether a user holds a valid unexpired entitlement.
type EntitlementChecker func(ctx context.Context, userID, code string) bool

// ServiceOption configures a discovery Service instance.
type ServiceOption func(*Service)

// WithEnvironment sets the runtime environment on the discovery service and its SSV verifier.
// In production and staging, sandbox test signatures are strictly disabled and genuine ECDSA signatures
// from Google are required.
func WithEnvironment(env string) ServiceOption {
	return func(s *Service) {
		envClean := strings.TrimSpace(strings.ToLower(env))
		isSandbox := envClean == string(config.EnvLocal) || envClean == string(config.EnvDevelopment) || envClean == "test"
		s.verifier.SetEnvironment(envClean, isSandbox)
	}
}

// WithSSVVerifier overrides the default SSV verifier.
func WithSSVVerifier(v *SSVVerifier) ServiceOption {
	return func(s *Service) {
		if v != nil {
			s.verifier = v
		}
	}
}

func NewService(repo Repository, identRepo identity.Repository, mediaSvc *media.Service, logger *slog.Logger, opts ...ServiceOption) *Service {
	svc := &Service{
		repo:      repo,
		identRepo: identRepo,
		mediaSvc:  mediaSvc,
		verifier:  NewSSVVerifier(false, ""), // Fails closed by default; requires explicit environment option
		logger:    logger,
	}
	for _, opt := range opts {
		opt(svc)
	}
	return svc
}

func (s *Service) SSVVerifier() *SSVVerifier {
	return s.verifier
}

func (s *Service) SetSSVVerifier(v *SSVVerifier) {
	if v != nil {
		s.verifier = v
	}
}

func (s *Service) SetEntitlementChecker(checker EntitlementChecker) {
	s.entitlementChecker = checker
}

func (s *Service) SetAgeChecker(checker AgeChecker) {
	s.ageChecker = checker
}

func (s *Service) GetSwipeAllowance(ctx context.Context, userID string) (int, bool, error) {
	detail, err := s.GetSwipeAllowanceDetail(ctx, userID)
	if err != nil {
		return 0, false, err
	}
	return detail.RemainingLikes, detail.IsUnlimited, nil
}

func (s *Service) GetSwipeAllowanceDetail(ctx context.Context, userID string) (*SwipeAllowanceDetail, error) {
	detail, err := s.repo.GetSwipeAllowanceDetail(ctx, userID)
	if err != nil {
		rem, isUnlim, bErr := s.repo.GetSwipeAllowance(ctx, userID)
		if bErr != nil {
			return nil, bErr
		}
		detail = &SwipeAllowanceDetail{
			UserID:         userID,
			DailyQuota:     PostIntroQuota,
			RemainingLikes: rem,
			IsUnlimited:    isUnlim,
		}
	}
	if !detail.IsUnlimited && s.entitlementChecker != nil {
		if s.entitlementChecker(ctx, userID, "UNLIMITED_SWIPES") {
			detail.IsUnlimited = true
			detail.RemainingLikes = 9999
			detail.RemainingRegularLikes = 9999
		}
	}
	return detail, nil
}

func (s *Service) VerifyAndGrantAdReward(ctx context.Context, rawQuery string) (*AdMobSSVReward, error) {
	reward, err := s.verifier.VerifyCallback(rawQuery)
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("admob_ssv_verification_failed", slog.String("error", err.Error()))
		}
		return nil, err
	}

	// 1. Likes You rewarded ad separation
	if reward.CustomData == "likes_you_unlock" || reward.RewardItem == "LIKES_YOU" {
		res, err := s.repo.UnlockLikesYouAdReward(ctx, reward.UserID, reward.TransactionID)
		if err != nil {
			if s.logger != nil {
				s.logger.Warn("likes_you_unlock_reward_failed", slog.String("error", err.Error()), slog.String("transaction_id", reward.TransactionID))
			}
			return nil, err
		}
		if s.logger != nil {
			s.logger.Info("likes_you_ad_reward_granted", slog.String("user_id", reward.UserID), slog.String("transaction_id", reward.TransactionID), slog.Int("unlocked_count", len(res.NewlyUnlockedUserIDs)))
		}
		reward.RewardAmount = 2
		return reward, nil
	}

	// 2. Messaging quota rewarded ad separation
	if reward.CustomData == "messaging_quota_unlock" || reward.CustomData == "discovery_message_quota_unlock" || reward.RewardItem == "MESSAGING" {
		if err := s.repo.RecordAdReward(ctx, reward.UserID, reward.TransactionID, 2); err != nil {
			return nil, err
		}
		_, _ = s.repo.UnlockDiscoveryMessageAdBonus(ctx, reward.UserID)
		reward.RewardAmount = 2
		return reward, nil
	}

	// 3. Swipe allowance rewarded ad
	grantAmount := reward.RewardAmount
	if grantAmount <= 0 {
		grantAmount = 5
	}

	if err := s.repo.RecordAdReward(ctx, reward.UserID, reward.TransactionID, grantAmount); err != nil {
		if s.logger != nil {
			s.logger.Warn("admob_ssv_record_reward_failed", slog.String("error", err.Error()), slog.String("transaction_id", reward.TransactionID))
		}
		return nil, err
	}

	if s.logger != nil {
		s.logger.Info("admob_ssv_reward_granted", slog.String("user_id", reward.UserID), slog.String("transaction_id", reward.TransactionID), slog.Int("reward_amount", grantAmount))
	}

	reward.RewardAmount = grantAmount
	return reward, nil
}

func (s *Service) GetDiscoveryFeed(ctx context.Context, actorID string, cursor string, limit int) (*DiscoveryFeedResponse, error) {
	// Enforce 18+ adult validation: birthdate must confirm 18+.
	if s.identRepo != nil {
		profile, err := s.identRepo.GetProfile(ctx, actorID)
		if err == nil && profile != nil {
			if profile.Birthdate.IsZero() {
				return nil, ErrBirthdateRequired
			}
			if time.Now().UTC().Before(profile.Birthdate.AddDate(18, 0, 0)) {
				return nil, ErrUnderageProhibited
			}
		}
	}

	if s.mediaSvc != nil {
		actorGallery, err := s.mediaSvc.ListUserGallery(ctx, actorID)
		if err != nil || len(actorGallery) < 3 {
			return &DiscoveryFeedResponse{
				Candidates:       []DiscoveryCandidate{},
				NextCursor:       "",
				Count:            0,
				EmptyStateReason: "PHOTO_MINIMUM_REQUIRED",
			}, nil
		}
	}

	effectiveLimit := limit
	if effectiveLimit <= 0 || effectiveLimit > 50 {
		effectiveLimit = 20
	}

	candidates, nextCursor, emptyReason, err := s.repo.GetCandidates(ctx, actorID, cursor, effectiveLimit)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch candidates: %w", err)
	}

	// Filter and populate candidates with at least 3 approved profile photos
	filteredCandidates := make([]DiscoveryCandidate, 0, len(candidates))
	for i := range candidates {
		c := candidates[i]
		if s.mediaSvc != nil {
			gallery, err := s.mediaSvc.ListUserGallery(ctx, c.UserID)
			if err != nil || len(gallery) < 3 {
				continue // Candidate does not meet 3 approved photos minimum
			}
			cards := make([]PhotoCard, 0, len(gallery))
			for _, g := range gallery {
				var thumb, card, full string
				for _, d := range g.Derivatives {
					switch d.Variant {
					case media.VariantThumbWebP:
						thumb = d.URL
					case media.VariantCardWebP, media.VariantCardAVIF:
						card = d.URL
					case media.VariantFullWebP, media.VariantFullAVIF:
						full = d.URL
					}
				}
				if card == "" && len(g.Derivatives) > 0 {
					card = g.Derivatives[0].URL
				}
				if full == "" {
					full = card
				}
				if thumb == "" {
					thumb = card
				}
				cards = append(cards, PhotoCard{
					AssetID:  g.ID,
					ThumbURL: thumb,
					CardURL:  card,
					FullURL:  full,
				})
			}
			c.Photos = cards
		}

		if c.ApproximateDistanceKm < 1 {
			c.ApproximateDistanceKm = 1
		}

		filteredCandidates = append(filteredCandidates, c)
	}

	// Insert sponsored native card after every 11 candidate profiles (Section 5)
	finalCandidates := make([]DiscoveryCandidate, 0, len(filteredCandidates)+len(filteredCandidates)/11)
	for idx, cand := range filteredCandidates {
		finalCandidates = append(finalCandidates, cand)
		if (idx+1)%11 == 0 {
			finalCandidates = append(finalCandidates, DiscoveryCandidate{
				UserID:                "sponsored_ndp_partner",
				DisplayName:           "NDP Community Spotlight",
				Age:                   0,
				Bio:                   "Discover inclusive events, community spaces, and partner offers curated for our LGBTQ+ sanctuary.",
				ApproximateDistanceKm: 1,
				IsSponsored:           true,
				SponsoredTitle:        "Curated LGBTQ+ Spaces",
				SponsoredCTA:          "Explore Offers",
				SponsoredURL:          "/features",
				Photos: []PhotoCard{{
					AssetID:  "ad_asset_ndp",
					ThumbURL: "/images/sponsored-card.jpg",
					CardURL:  "/images/sponsored-card.jpg",
					FullURL:  "/images/sponsored-card.jpg",
				}},
			})
		}
	}

	if len(finalCandidates) == 0 && emptyReason == "" && cursor == "" {
		emptyReason = "NO_CANDIDATES_AVAILABLE"
	}

	return &DiscoveryFeedResponse{
		Candidates:       finalCandidates,
		NextCursor:       nextCursor,
		Count:            len(finalCandidates),
		EmptyStateReason: emptyReason,
	}, nil
}

func (s *Service) SearchProfiles(ctx context.Context, actorID string, query string, limit int) (*DiscoverySearchResponse, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	trimmedQuery := strings.TrimSpace(query)
	if len(trimmedQuery) < 2 {
		return &DiscoverySearchResponse{
			Query:      query,
			Count:      0,
			Candidates: []DiscoveryCandidate{},
		}, nil
	}

	candidates, err := s.repo.SearchProfiles(ctx, actorID, trimmedQuery, limit)
	if err != nil {
		return nil, fmt.Errorf("search failed: %w", err)
	}

	filteredCandidates := make([]DiscoveryCandidate, 0, len(candidates))
	for i := range candidates {
		c := candidates[i]
		if s.mediaSvc != nil {
			gallery, err := s.mediaSvc.ListUserGallery(ctx, c.UserID)
			if err == nil {
				cards := make([]PhotoCard, 0, len(gallery))
				for _, g := range gallery {
					var thumb, card, full string
					for _, d := range g.Derivatives {
						switch d.Variant {
						case media.VariantThumbWebP:
							thumb = d.URL
						case media.VariantCardWebP, media.VariantCardAVIF:
							card = d.URL
						case media.VariantFullWebP, media.VariantFullAVIF:
							full = d.URL
						}
					}
					if card == "" && len(g.Derivatives) > 0 {
						card = g.Derivatives[0].URL
					}
					if full == "" {
						full = card
					}
					if thumb == "" {
						thumb = card
					}
					cards = append(cards, PhotoCard{
						AssetID:  g.ID,
						ThumbURL: thumb,
						CardURL:  card,
						FullURL:  full,
					})
				}
				c.Photos = cards
			}
		}

		if c.ApproximateDistanceKm < 1 {
			c.ApproximateDistanceKm = 1
		}

		filteredCandidates = append(filteredCandidates, c)
	}

	return &DiscoverySearchResponse{
		Query:      query,
		Count:      len(filteredCandidates),
		Candidates: filteredCandidates,
	}, nil
}

func (s *Service) GetPublicProfile(ctx context.Context, actorID, targetID string) (*DiscoveryCandidate, error) {
	if targetID == "" {
		return nil, ErrCandidateInvalid
	}

	// If target is another user, check bi-directional block
	if actorID != targetID {
		isBlocked, err := s.repo.IsBlocked(ctx, actorID, targetID)
		if err == nil && isBlocked {
			return nil, ErrCandidateBlocked
		}
	}

	prof, err := s.identRepo.GetProfile(ctx, targetID)
	if err != nil || prof == nil {
		return nil, ErrCandidateInvalid
	}
	if prof.IncognitoEnabled && actorID != targetID {
		return nil, ErrCandidateInvalid
	}

	age := calculateAge(prof.Birthdate, time.Now().UTC())
	if age < 18 {
		return nil, ErrUnderageProhibited
	}

	distKm := 1
	actorLoc, _ := s.identRepo.GetLocation(ctx, actorID)
	targetLoc, _ := s.identRepo.GetLocation(ctx, targetID)
	if actorLoc != nil && targetLoc != nil && (actorLoc.Latitude != 0 || actorLoc.Longitude != 0) && (targetLoc.Latitude != 0 || targetLoc.Longitude != 0) {
		calculated := int(math.Ceil(haversineDistance(actorLoc.Latitude, actorLoc.Longitude, targetLoc.Latitude, targetLoc.Longitude)))
		if calculated > 0 {
			distKm = calculated
		}
	}

	pronouns := prof.Pronouns
	if prof.VisibilitySettings.Pronouns == identity.VisibilityHidden {
		pronouns = nil
	}
	genders := prof.GenderIdentities
	if prof.VisibilitySettings.GenderIdentity == identity.VisibilityHidden {
		genders = nil
	}
	orientations := prof.SexualOrientations
	if prof.VisibilitySettings.SexualOrientation == identity.VisibilityHidden {
		orientations = nil
	}

	photos := []PhotoCard{}
	if s.mediaSvc != nil {
		gallery, err := s.mediaSvc.ListUserGallery(ctx, targetID)
		if err == nil {
			for _, g := range gallery {
				var thumb, card, full string
				for _, d := range g.Derivatives {
					switch d.Variant {
					case media.VariantThumbWebP:
						thumb = d.URL
					case media.VariantCardWebP, media.VariantCardAVIF:
						card = d.URL
					case media.VariantFullWebP, media.VariantFullAVIF:
						full = d.URL
					}
				}
				if card == "" && len(g.Derivatives) > 0 {
					card = g.Derivatives[0].URL
				}
				if full == "" {
					full = card
				}
				if thumb == "" {
					thumb = card
				}
				photos = append(photos, PhotoCard{
					AssetID:  g.ID,
					ThumbURL: thumb,
					CardURL:  card,
					FullURL:  full,
				})
			}
		}
	}

	return &DiscoveryCandidate{
		UserID:                targetID,
		DisplayName:           prof.DisplayName,
		Age:                   age,
		Bio:                   prof.Bio,
		Pronouns:              pronouns,
		GenderIdentities:      genders,
		SexualOrientations:    orientations,
		RelationshipIntents:   prof.RelationshipIntents,
		RelationshipStructure: string(prof.RelationshipStructure),
		SmokingHabit:          string(prof.SmokingHabit),
		DrinkingHabit:         string(prof.DrinkingHabit),
		ApproximateDistanceKm: distKm,
		IsPhotoVerified:       prof.IsPhotoVerified,
		Photos:                photos,
	}, nil
}

func (s *Service) GetMatchingSummary(ctx context.Context, actorID string) (*MatchingSummaryResponse, error) {
	return s.repo.CountMatchingNearby(ctx, actorID)
}

func (s *Service) Swipe(ctx context.Context, actorID string, req SwipeRequest, correlationID string) (*SwipeResponse, error) {
	targetID := strings.TrimSpace(req.TargetUserID)
	if targetID == "" {
		return nil, errors.New("target_user_id is required")
	}
	if actorID == targetID {
		return nil, ErrSelfSwipe
	}

	direction, err := ValidateSwipeDirection(req.Direction)
	if err != nil {
		return nil, err
	}

	// Enforce 18+ adult age validation: birthdate must confirm 18+.
	// Third-party age assurance review is not required to swipe/like/match/chat for confirmed adults.
	if s.identRepo != nil {
		profile, err := s.identRepo.GetProfile(ctx, actorID)
		if err == nil && profile != nil {
			if profile.Birthdate.IsZero() {
				return nil, ErrBirthdateRequired
			}
			if time.Now().UTC().Before(profile.Birthdate.AddDate(18, 0, 0)) {
				return nil, ErrUnderageProhibited
			}
		}
	}

	if direction != SwipePass {
		// Actor must have at least 3 approved profile gallery photos to like
		if s.mediaSvc != nil {
			gallery, err := s.mediaSvc.ListUserGallery(ctx, actorID)
			if err != nil || len(gallery) < 3 {
				return nil, ErrSwipePhotoMinimumRequired
			}
		}

		allowance, err := s.GetSwipeAllowanceDetail(ctx, actorID)
		if err == nil && !allowance.IsUnlimited {
			if allowance.RemainingRegularLikes <= 0 {
				if allowance.RemainingBonusLikes <= 0 {
					return nil, ErrSwipeLimitReached
				}
				// Bonus likes from rewarded ads are only for liking photo-verified profiles
				targetProf, err := s.identRepo.GetProfile(ctx, targetID)
				if err != nil || targetProf == nil || !targetProf.IsPhotoVerified {
					return nil, ErrBonusLikesVerifiedOnly
				}
			}
		}
	}

	isMatch, match, rewardGranted, err := s.repo.CreateSwipe(ctx, actorID, targetID, direction, req.IntroNote, correlationID)
	if err != nil {
		return nil, err
	}

	var matchResp *MatchResponse
	if isMatch && match != nil {
		// Fetch target profile for match display
		targetProf, _ := s.identRepo.GetProfile(ctx, targetID)
		var cand *DiscoveryCandidate
		if targetProf != nil {
			cand = &DiscoveryCandidate{
				UserID:                targetID,
				DisplayName:           targetProf.DisplayName,
				Bio:                   targetProf.Bio,
				IsPhotoVerified:       targetProf.IsPhotoVerified,
				RelationshipStructure: string(targetProf.RelationshipStructure),
				Photos:                []PhotoCard{},
			}
			if s.mediaSvc != nil {
				if gallery, err := s.mediaSvc.ListUserGallery(ctx, targetID); err == nil && len(gallery) > 0 {
					for _, g := range gallery {
						var cardURL string
						if len(g.Derivatives) > 0 {
							cardURL = g.Derivatives[0].URL
						}
						cand.Photos = append(cand.Photos, PhotoCard{
							AssetID:  g.ID,
							ThumbURL: cardURL,
							CardURL:  cardURL,
							FullURL:  cardURL,
						})
					}
				}
			}
		}

		matchResp = &MatchResponse{
			ID:             match.ID,
			MatchedUserID:  targetID,
			MatchedProfile: cand,
			Status:         match.Status,
			MatchedAt:      match.MatchedAt,
		}
	}

	remaining, isUnlimited, _ := s.GetSwipeAllowance(ctx, actorID)
	var remainingPtr *int
	if !isUnlimited {
		remainingPtr = &remaining
	}

	rewardMsg := ""
	if rewardGranted {
		rewardMsg = "You matched! 24 hours of unlimited swipes have been unlocked."
	}

	return &SwipeResponse{
		Matched:                isMatch,
		Match:                  matchResp,
		DailySwipesRemaining:   remainingPtr,
		UnlimitedSwipesGranted: rewardGranted,
		RewardDetails:          rewardMsg,
	}, nil
}

func (s *Service) ListMatches(ctx context.Context, userID string) ([]MatchResponse, error) {
	matches, err := s.repo.ListMatches(ctx, userID)
	if err != nil {
		return nil, err
	}

	results := make([]MatchResponse, 0, len(matches))
	for _, m := range matches {
		matchedID := m.UserHighID
		if matchedID == userID {
			matchedID = m.UserLowID
		}

		var candidate *DiscoveryCandidate
		prof, err := s.identRepo.GetProfile(ctx, matchedID)
		if err == nil && prof != nil {
			var h *int
			if prof.VisibilitySettings.Height != identity.VisibilityHidden {
				h = prof.HeightCm
			}
			var w *int
			if prof.VisibilitySettings.Weight != identity.VisibilityHidden {
				w = prof.WeightKg
			}
			candidate = &DiscoveryCandidate{
				UserID:                matchedID,
				DisplayName:           prof.DisplayName,
				Bio:                   prof.Bio,
				IsPhotoVerified:       prof.IsPhotoVerified,
				RelationshipStructure: string(prof.RelationshipStructure),
				HeightCm:              h,
				WeightKg:              w,
				Photos:                []PhotoCard{},
			}
			if s.mediaSvc != nil {
				if gallery, err := s.mediaSvc.ListUserGallery(ctx, matchedID); err == nil && len(gallery) > 0 {
					for _, g := range gallery {
						var cardURL string
						if len(g.Derivatives) > 0 {
							cardURL = g.Derivatives[0].URL
						}
						candidate.Photos = append(candidate.Photos, PhotoCard{
							AssetID:  g.ID,
							ThumbURL: cardURL,
							CardURL:  cardURL,
							FullURL:  cardURL,
						})
					}
				}
			}
		}

		results = append(results, MatchResponse{
			ID:             m.ID,
			MatchedUserID:  matchedID,
			MatchedProfile: candidate,
			Status:         m.Status,
			MatchedAt:      m.MatchedAt,
		})
	}

	return results, nil
}

func (s *Service) GetMatch(ctx context.Context, matchID, requesterID string) (*MatchResponse, error) {
	m, err := s.repo.GetMatchByID(ctx, matchID, requesterID)
	if err != nil {
		return nil, err
	}

	matchedID := m.UserHighID
	if matchedID == requesterID {
		matchedID = m.UserLowID
	}

	var candidate *DiscoveryCandidate
	prof, err := s.identRepo.GetProfile(ctx, matchedID)
	if err == nil && prof != nil {
		var h *int
		if prof.VisibilitySettings.Height != identity.VisibilityHidden {
			h = prof.HeightCm
		}
		var w *int
		if prof.VisibilitySettings.Weight != identity.VisibilityHidden {
			w = prof.WeightKg
		}
		candidate = &DiscoveryCandidate{
			UserID:          matchedID,
			DisplayName:     prof.DisplayName,
			Bio:             prof.Bio,
			IsPhotoVerified: prof.IsPhotoVerified,
			HeightCm:        h,
			WeightKg:        w,
			Photos:          []PhotoCard{},
		}
	}

	return &MatchResponse{
		ID:             m.ID,
		MatchedUserID:  matchedID,
		MatchedProfile: candidate,
		Status:         m.Status,
		MatchedAt:      m.MatchedAt,
	}, nil
}

func (s *Service) Unmatch(ctx context.Context, matchID, requesterID string) error {
	return s.repo.Unmatch(ctx, matchID, requesterID)
}

func (s *Service) BlockUser(ctx context.Context, blockerID, blockedID, reason string) error {
	if reason == "" {
		reason = "USER_INITIATED"
	}
	return s.repo.BlockUser(ctx, blockerID, blockedID, reason)
}

func (s *Service) Rewind(ctx context.Context, actorID string) (*RewindResponse, error) {
	if strings.TrimSpace(actorID) == "" {
		return nil, errors.New("actor_user_id is required")
	}
	return s.repo.RewindLastSwipe(ctx, actorID)
}

func (s *Service) GetLikesYou(ctx context.Context, actorID string, limit, offset int) (*LikesYouResponse, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	// 1. Check if user is premium
	isPremium := false
	if s.entitlementChecker != nil {
		isPremium = s.entitlementChecker(ctx, actorID, "SEE_WHO_LIKED_YOU")
	}

	// 2. Fetch incoming likes
	likes, total, err := s.repo.GetIncomingLikes(ctx, actorID, limit, offset)
	if err != nil {
		return nil, err
	}

	// 3. Fetch unlock state and ad status
	state, err := s.repo.GetUserLikesUnlockState(ctx, actorID)
	if err != nil {
		state = &UserLikesUnlockState{UserID: actorID}
	}

	adStatus, err := s.repo.GetLikesYouAdStatus(ctx, actorID)
	if err != nil {
		adStatus = &LikesYouAdStatus{
			AdsWatchedInWindow:       0,
			MaxAdsPerWindow:          LikesYouMaxAdsPerWindow,
			CanWatchAd:               true,
			AdResetInSeconds:         0,
			ProfilesUnlockedInWindow: 0,
			MaxProfilesPerWindow:     LikesYouMaxProfilesPerWindow,
		}
	}

	freeLimit := 1
	freeRemaining := freeLimit - state.FreeRevealsUsed
	if freeRemaining < 0 {
		freeRemaining = 0
	}

	cooldownActive := !adStatus.CanWatchAd
	cooldownRemainingSec := adStatus.AdResetInSeconds
	canWatchAd := adStatus.CanWatchAd

	if isPremium {
		cooldownActive = false
		cooldownRemainingSec = 0
		canWatchAd = true
	}

	revealedCount := 0
	unrevealedCount := 0

	for i := range likes {
		like := &likes[i]
		if isPremium || like.IsRevealed {
			like.IsRevealed = true
			revealedCount++
			if s.mediaSvc != nil {
				gallery, err := s.mediaSvc.ListUserGallery(ctx, like.UserID)
				if err == nil {
					for _, g := range gallery {
						cardURL := ""
						if len(g.Derivatives) > 0 {
							cardURL = g.Derivatives[0].URL
						}
						like.Photos = append(like.Photos, PhotoCard{
							AssetID:  g.ID,
							ThumbURL: cardURL,
							CardURL:  cardURL,
							FullURL:  cardURL,
						})
					}
				}
			}
		} else {
			like.IsRevealed = false
			unrevealedCount++
			runes := []rune(like.DisplayName)
			if len(runes) > 0 {
				like.DisplayName = string(runes[0]) + "..."
			} else {
				like.DisplayName = "Someone"
			}
			like.Bio = "Profile details revealed upon unlock"
			like.BlurredPhotoURL = "/placeholder-blur.jpg"
			like.Photos = []PhotoCard{}
		}
	}

	return &LikesYouResponse{
		TotalLikes:               total,
		RevealedCount:            revealedCount,
		UnrevealedCount:          unrevealedCount,
		FreeRevealsRemaining:     freeRemaining,
		BonusRevealsRemaining:    state.BonusRevealsRemaining,
		CooldownActive:           cooldownActive,
		CooldownRemainingSeconds: cooldownRemainingSec,
		RewardedAdEnabled:        true,
		Likes:                    likes,
		AdsWatchedInWindow:       adStatus.AdsWatchedInWindow,
		MaxAdsPerWindow:          adStatus.MaxAdsPerWindow,
		CanWatchAd:               canWatchAd,
		AdResetInSeconds:         adStatus.AdResetInSeconds,
		ProfilesUnlockedInWindow: adStatus.ProfilesUnlockedInWindow,
		MaxProfilesPerWindow:     adStatus.MaxProfilesPerWindow,
	}, nil
}

func (s *Service) UnlockLikesYouWithAd(ctx context.Context, userID, rawQuery, transactionID string) (*LikesYouUnlockAdResponse, error) {
	rawQuery = strings.TrimSpace(rawQuery)
	transactionID = strings.TrimSpace(transactionID)

	var txID string
	if rawQuery != "" {
		reward, err := s.verifier.VerifyCallback(rawQuery)
		if err != nil {
			return nil, err
		}
		if reward.UserID != "" && reward.UserID != userID {
			return nil, errors.New("reward user_id does not match authenticated user")
		}
		txID = reward.TransactionID
	} else if transactionID != "" {
		if !s.verifier.isTestSignatureAllowed() {
			return nil, errors.New("raw_query cryptographic SSV callback is required in production; client transaction ID not accepted")
		}
		txID = transactionID
	} else {
		return nil, errors.New("ad verification required: valid cryptographic SSV callback or test transaction is required")
	}

	result, err := s.repo.UnlockLikesYouAdReward(ctx, userID, txID)
	if err != nil {
		return nil, err
	}

	likesYou, _ := s.GetLikesYou(ctx, userID, 20, 0)

	return &LikesYouUnlockAdResponse{
		Success:               true,
		AdsWatchedInWindow:    result.AdsWatchedInWindow,
		MaxAdsPerWindow:       result.MaxAdsPerWindow,
		CanWatchAd:            result.CanWatchAd,
		AdResetInSeconds:      result.AdResetInSeconds,
		BonusRevealsRemaining: result.BonusRevealsRemaining,
		NewlyUnlockedUserIDs:  result.NewlyUnlockedUserIDs,
		UnlockedCount:         len(result.NewlyUnlockedUserIDs),
		LikesYou:              likesYou,
	}, nil
}

func (s *Service) RevealLike(ctx context.Context, actorID, targetUserID string) (*IncomingLikeCard, string, error) {
	likes, _, err := s.repo.GetIncomingLikes(ctx, actorID, 100, 0)
	if err != nil {
		return nil, "", err
	}

	var targetLike *IncomingLikeCard
	for i := range likes {
		if likes[i].UserID == targetUserID {
			targetLike = &likes[i]
			break
		}
	}
	if targetLike == nil {
		return nil, "", fmt.Errorf("no incoming like from user %s", targetUserID)
	}

	if targetLike.IsRevealed {
		return targetLike, "ALREADY_REVEALED", nil
	}

	state, err := s.repo.GetUserLikesUnlockState(ctx, actorID)
	if err != nil {
		state = &UserLikesUnlockState{UserID: actorID}
	}

	source := ""
	if state.FreeRevealsUsed < 1 {
		source = "FREE"
		state.FreeRevealsUsed++
	} else if state.BonusRevealsRemaining > 0 {
		source = "REWARDED_AD"
		state.BonusRevealsRemaining--
	} else {
		if s.entitlementChecker != nil && s.entitlementChecker(ctx, actorID, "SEE_WHO_LIKED_YOU") {
			source = "PREMIUM"
		} else {
			return nil, "", errors.New("no reveal credits available; complete a rewarded ad to unlock 2 likes or upgrade to NDP Plus")
		}
	}

	if err := s.repo.RecordLikeReveal(ctx, actorID, targetUserID, source); err != nil {
		return nil, "", err
	}
	_ = s.repo.SaveUserLikesUnlockState(ctx, state)

	targetLike.IsRevealed = true
	prof, err := s.identRepo.GetProfile(ctx, targetUserID)
	if err == nil && prof != nil {
		targetLike.DisplayName = prof.DisplayName
		targetLike.Bio = prof.Bio
		targetLike.IsPhotoVerified = prof.IsPhotoVerified
		if s.mediaSvc != nil {
			if gallery, err := s.mediaSvc.ListUserGallery(ctx, targetUserID); err == nil {
				for _, g := range gallery {
					cardURL := ""
					if len(g.Derivatives) > 0 {
						cardURL = g.Derivatives[0].URL
					}
					targetLike.Photos = append(targetLike.Photos, PhotoCard{
						AssetID:  g.ID,
						ThumbURL: cardURL,
						CardURL:  cardURL,
						FullURL:  cardURL,
					})
				}
			}
		}
	}

	return targetLike, source, nil
}

func (s *Service) SendMessageRequest(ctx context.Context, senderID string, req SendMessageRequestPayload) (*MessageRequest, error) {
	if strings.TrimSpace(req.RecipientUserID) == "" || strings.TrimSpace(req.Body) == "" {
		return nil, errors.New("recipient_user_id and body are required")
	}
	if senderID == req.RecipientUserID {
		return nil, errors.New("cannot send message request to yourself")
	}

	if err := s.repo.ConsumeDiscoveryMessageSlot(ctx, senderID, req.RecipientUserID); err != nil {
		return nil, err
	}

	mr := &MessageRequest{
		ID:              generateUUIDv4(),
		SenderUserID:    senderID,
		RecipientUserID: req.RecipientUserID,
		Body:            req.Body,
		Status:          "PENDING",
		CreatedAt:       time.Now().UTC(),
	}

	if err := s.repo.CreateMessageRequest(ctx, mr); err != nil {
		return nil, err
	}
	return mr, nil
}

func (s *Service) GetDiscoveryMessageQuota(ctx context.Context, userID string) (*DiscoveryMessagingQuota, error) {
	quota, err := s.repo.GetDiscoveryMessageQuota(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !quota.IsUnlimited && s.entitlementChecker != nil {
		if s.entitlementChecker(ctx, userID, "VIP_SUBSCRIPTION") || s.entitlementChecker(ctx, userID, "UNLIMITED_MESSAGING") {
			quota.IsUnlimited = true
			quota.IsInTrial = false
			quota.IsLocked = false
			quota.CooldownActive = false
			quota.CanUnlockWithAd = false
			quota.TrialInitiationsRemaining = 0
			quota.TrialInitiationsAllowed = 0
			quota.FreeQuota = 0
			quota.FreeSlotsRemaining = 0
		}
	}
	return quota, nil
}

func (s *Service) UnlockDiscoveryMessageAdBonus(ctx context.Context, userID string, rawQuery string, transactionID string) (*DiscoveryMessagingQuota, error) {
	rawQuery = strings.TrimSpace(rawQuery)
	transactionID = strings.TrimSpace(transactionID)

	if rawQuery != "" {
		reward, err := s.verifier.VerifyCallback(rawQuery)
		if err != nil {
			return nil, err
		}
		if reward.UserID != "" && reward.UserID != userID {
			return nil, errors.New("reward user_id does not match authenticated user")
		}
		if err := s.repo.RecordAdReward(ctx, userID, reward.TransactionID, 2); err != nil {
			return nil, err
		}
	} else if transactionID != "" {
		if !s.verifier.isTestSignatureAllowed() {
			return nil, errors.New("raw_query cryptographic SSV callback is required in production; client transaction ID not accepted")
		}
		if err := s.repo.RecordAdReward(ctx, userID, transactionID, 2); err != nil {
			return nil, err
		}
	} else {
		return nil, errors.New("ad verification required: valid cryptographic SSV callback or test transaction is required")
	}

	return s.repo.UnlockDiscoveryMessageAdBonus(ctx, userID)
}

// ClaimSwipeAdReward verifies the rewarded ad completion and grants 5 bonus likes for photo-verified profiles.
func (s *Service) ClaimSwipeAdReward(ctx context.Context, userID, rawQuery, transactionID string) (*SwipeAllowanceDetail, error) {
	rawQuery = strings.TrimSpace(rawQuery)
	transactionID = strings.TrimSpace(transactionID)

	var txID string
	if rawQuery != "" {
		reward, err := s.verifier.VerifyCallback(rawQuery)
		if err != nil {
			return nil, err
		}
		if reward.UserID != "" && reward.UserID != userID {
			return nil, errors.New("reward user_id does not match authenticated user")
		}
		txID = reward.TransactionID
	} else if transactionID != "" {
		if !s.verifier.isTestSignatureAllowed() {
			return nil, errors.New("raw_query cryptographic SSV callback is required in production; client transaction ID not accepted")
		}
		txID = transactionID
	} else {
		return nil, errors.New("ad verification required: valid cryptographic SSV callback or test transaction is required")
	}

	if err := s.repo.RecordAdReward(ctx, userID, txID, 5); err != nil {
		return nil, err
	}

	return s.repo.GetSwipeAllowanceDetail(ctx, userID)
}

func (s *Service) ListMessageRequests(ctx context.Context, userID, folder string) ([]MessageRequest, error) {
	return s.repo.ListMessageRequests(ctx, userID, folder)
}

func (s *Service) RespondMessageRequest(ctx context.Context, recipientID, requestID, action string) error {
	action = strings.ToUpper(strings.TrimSpace(action))
	if action != "ACCEPTED" && action != "DECLINED" && action != "BLOCKED" {
		return errors.New("action must be ACCEPTED, DECLINED, or BLOCKED")
	}
	return s.repo.UpdateMessageRequestStatus(ctx, requestID, recipientID, action)
}

func (s *Service) AddFavourite(ctx context.Context, userID, targetUserID string) (*AddFavouriteResponse, error) {
	targetUserID = strings.TrimSpace(targetUserID)
	if targetUserID == "" {
		return nil, errors.New("target user ID is required")
	}
	if userID == targetUserID {
		return nil, ErrSelfFavourite
	}

	fav, err := s.repo.AddFavourite(ctx, userID, targetUserID)
	if err != nil {
		return nil, err
	}

	return &AddFavouriteResponse{
		Success:      true,
		TargetUserID: fav.TargetUserID,
		AddedAt:      fav.CreatedAt,
	}, nil
}

func (s *Service) RemoveFavourite(ctx context.Context, userID, targetUserID string) (*RemoveFavouriteResponse, error) {
	targetUserID = strings.TrimSpace(targetUserID)
	if targetUserID == "" {
		return nil, errors.New("target user ID is required")
	}

	if err := s.repo.RemoveFavourite(ctx, userID, targetUserID); err != nil {
		return nil, err
	}

	return &RemoveFavouriteResponse{
		Success:      true,
		TargetUserID: targetUserID,
	}, nil
}

func (s *Service) ListFavourites(ctx context.Context, userID string) (*ListFavouritesResponse, error) {
	favs, err := s.repo.ListFavourites(ctx, userID)
	if err != nil {
		return nil, err
	}

	if s.mediaSvc != nil {
		for i := range favs {
			if favs[i].PhotoURL != "" {
				continue
			}
			gallery, err := s.mediaSvc.ListUserGallery(ctx, favs[i].UserID)
			if err != nil || len(gallery) == 0 {
				continue
			}
			favs[i].PhotoURL = firstApprovedCardPhotoURL(gallery)
		}
	}

	return &ListFavouritesResponse{
		Count:      len(favs),
		Favourites: favs,
	}, nil
}

func (s *Service) IsFavourite(ctx context.Context, userID, targetUserID string) (bool, error) {
	targetUserID = strings.TrimSpace(targetUserID)
	if targetUserID == "" {
		return false, nil
	}
	return s.repo.IsFavourite(ctx, userID, targetUserID)
}

func firstApprovedCardPhotoURL(gallery []media.MediaAssetResponse) string {
	if len(gallery) == 0 {
		return ""
	}
	g := gallery[0]
	var thumb, card, full string
	for _, d := range g.Derivatives {
		switch d.Variant {
		case media.VariantThumbWebP:
			thumb = d.URL
		case media.VariantCardWebP, media.VariantCardAVIF:
			card = d.URL
		case media.VariantFullWebP, media.VariantFullAVIF:
			full = d.URL
		}
	}
	if card != "" {
		return card
	}
	if thumb != "" {
		return thumb
	}
	if full != "" {
		return full
	}
	if len(g.Derivatives) > 0 {
		return g.Derivatives[0].URL
	}
	return ""
}

func generateUUIDv4() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
