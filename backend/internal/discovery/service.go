package discovery

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

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
	logger             *slog.Logger
}

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
	// Actor must have at least 3 approved profile gallery photos to access discovery feed
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

	candidates, nextCursor, emptyReason, err := s.repo.GetCandidates(ctx, actorID, cursor, limit)
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
				if thumb == "" {
					thumb = card
				}
				if full == "" {
					full = card
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
		filteredCandidates = append(filteredCandidates, c)
	}

	if len(filteredCandidates) == 0 && emptyReason == "" {
		emptyReason = "NO_CANDIDATES_AVAILABLE"
	}

	return &DiscoveryFeedResponse{
		Candidates:       filteredCandidates,
		NextCursor:       nextCursor,
		Count:            len(filteredCandidates),
		EmptyStateReason: emptyReason,
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

	// Actor must have at least 3 approved profile gallery photos to swipe
	if s.mediaSvc != nil {
		gallery, err := s.mediaSvc.ListUserGallery(ctx, actorID)
		if err != nil || len(gallery) < 3 {
			return nil, ErrSwipePhotoMinimumRequired
		}
	}

	direction, err := ValidateSwipeDirection(req.Direction)
	if err != nil {
		return nil, err
	}

	// Check like quota & entitlements (PASS swipes are always free; LIKE / SUPER_SPARK consume allowance)
	if direction != SwipePass {
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
			candidate = &DiscoveryCandidate{
				UserID:                matchedID,
				DisplayName:           prof.DisplayName,
				Bio:                   prof.Bio,
				IsPhotoVerified:       prof.IsPhotoVerified,
				RelationshipStructure: string(prof.RelationshipStructure),
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
		candidate = &DiscoveryCandidate{
			UserID:          matchedID,
			DisplayName:     prof.DisplayName,
			Bio:             prof.Bio,
			IsPhotoVerified: prof.IsPhotoVerified,
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
