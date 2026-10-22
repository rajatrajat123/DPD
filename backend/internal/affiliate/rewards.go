package affiliate

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

// UserVerificationChecker allows the affiliate service to query whether a referred user is verified and active
type UserVerificationChecker interface {
	IsUserVerified(ctx context.Context, userID string) (verified bool, maskedIdentifier string, verifiedAt *time.Time, err error)
}

// EntitlementGranter allows synchronizing referral rewards with user_entitlements
type EntitlementGranter interface {
	GrantRewardEntitlement(ctx context.Context, userID string, code string, expiresAt time.Time, metadata map[string]any) error
	RevokeRewardEntitlement(ctx context.Context, userID string) error
}

// SubscriptionChecker checks whether a user has an active paid subscription (e.g. Plus, Black)
type SubscriptionChecker interface {
	GetPaidSubscription(ctx context.Context, userID string) (hasPaid bool, tier string, err error)
}

// GetOrCreateUserReferralCode retrieves the existing unique partner/referral code for an in-app user
// or provisions a new one seamlessly.
func (s *Service) GetOrCreateUserReferralCode(ctx context.Context, userID string) (string, error) {
	normUserID := strings.TrimSpace(userID)
	if normUserID == "" {
		return "", errors.New("user_id is required")
	}

	aff, err := s.repo.GetAffiliateByUserID(ctx, normUserID)
	if err == nil && aff != nil {
		return aff.PartnerCode, nil
	}

	// Generate a unique referral partner code for the user
	partnerCode := generatePartnerCode()
	for i := 0; i < 5; i++ {
		if dup, _ := s.repo.GetAffiliateByPartnerCode(ctx, partnerCode); dup == nil {
			break
		}
		partnerCode = generatePartnerCode()
	}

	now := time.Now().UTC()
	aff = &Affiliate{
		UserID:             normUserID,
		PartnerCode:        partnerCode,
		Status:             StatusActive,
		Tier:               TierStandard,
		PayoutCurrency:     "USD",
		TaxFormVerified:    false,
		TermsAcceptedAt:    &now,
		TermsVersion:       "1.0",
		PayoutMethod:       PayoutMethodStripeConnect,
		CryptoAsset:        "USDC",
		CryptoNetwork:      "POLYGON",
		MinimumPayoutCents: 5000,
	}

	if err := s.repo.CreateAffiliate(ctx, aff); err != nil {
		// If another concurrent request provisioned it simultaneously, retrieve it
		if existing, getErr := s.repo.GetAffiliateByUserID(ctx, normUserID); getErr == nil && existing != nil {
			return existing.PartnerCode, nil
		}
		return "", fmt.Errorf("failed to provision user referral code: %w", err)
	}

	return partnerCode, nil
}

// GetUserReferralStatus evaluates all attributed referrals, verifies accounts, computes rewards,
// syncs entitlements idempotently, and returns the full in-app status.
func (s *Service) GetUserReferralStatus(ctx context.Context, userID string) (*UserReferralStatus, error) {
	return s.EvaluateUserReferralReward(ctx, userID)
}

// EvaluateUserReferralReward is the authoritative, idempotent server-side reward evaluator.
func (s *Service) EvaluateUserReferralReward(ctx context.Context, userID string) (*UserReferralStatus, error) {
	normUserID := strings.TrimSpace(userID)
	if normUserID == "" {
		return nil, errors.New("user_id is required")
	}

	// 1. Ensure the user has an active referral partner code
	code, err := s.GetOrCreateUserReferralCode(ctx, normUserID)
	if err != nil {
		return nil, err
	}

	aff, err := s.repo.GetAffiliateByUserID(ctx, normUserID)
	if err != nil || aff == nil {
		return nil, ErrAffiliateNotFound
	}

	// 2. Fetch all referrals attributed to this user's partner code
	attributions, err := s.repo.ListAttributionsByAffiliate(ctx, aff.ID, 100)
	if err != nil {
		attributions = nil
	}

	var verifiedCount int
	var pendingCount int
	recentReferrals := make([]ReferredUserSummary, 0, len(attributions))

	for _, attr := range attributions {
		// Fraud Prevention: strictly prohibit self-referrals
		if attr.ReferredUserID == normUserID {
			continue
		}

		isVerified := false
		maskedID := "Friend"
		var verifiedAt *time.Time

		if s.userVerifier != nil {
			v, masked, vAt, vErr := s.userVerifier.IsUserVerified(ctx, attr.ReferredUserID)
			if vErr == nil {
				isVerified = v
				if masked != "" {
					maskedID = masked
				}
				verifiedAt = vAt
			}
		}

		statusStr := "PENDING_VERIFICATION"
		if isVerified {
			verifiedCount++
			statusStr = "VERIFIED"
		} else {
			pendingCount++
		}

		recentReferrals = append(recentReferrals, ReferredUserSummary{
			MaskedIdentifier: maskedID,
			Status:           statusStr,
			AttributedAt:     attr.AttributedAt,
			VerifiedAt:       verifiedAt,
		})
	}

	// 3. Evaluate Configurable Reward Rules
	cfg := s.rewardConfig
	if cfg.Tier1Threshold <= 0 {
		cfg = DefaultUserReferralRewardConfig()
	}

	rewardTier := 0
	daysGranted := 0
	var nextMilestone *ReferralNextMilestone

	if verifiedCount < cfg.Tier1Threshold {
		rewardTier = 0
		daysGranted = 0
		needed := cfg.Tier1Threshold - verifiedCount
		desc := fmt.Sprintf("Invite %d friend who joins and verifies to unlock %d days of ad-supported free access.", needed, cfg.Tier1RewardDays)
		nextMilestone = &ReferralNextMilestone{
			TargetReferrals: cfg.Tier1Threshold,
			RemainingNeeded: needed,
			RewardDays:      cfg.Tier1RewardDays,
			Description:     desc,
		}
	} else if verifiedCount < cfg.Tier2Threshold {
		// Rule: After one genuinely successful, verified referral, grant 30 days of ad-supported free access
		rewardTier = 1
		daysGranted = cfg.Tier1RewardDays
		needed := cfg.Tier2Threshold - verifiedCount
		desc := fmt.Sprintf("Invite %d more friends to reach %d verified referrals and unlock %d days total free access.", needed, cfg.Tier2Threshold, cfg.Tier2RewardDays)
		nextMilestone = &ReferralNextMilestone{
			TargetReferrals: cfg.Tier2Threshold,
			RemainingNeeded: needed,
			RewardDays:      cfg.Tier2RewardDays,
			Description:     desc,
		}
	} else {
		// Rule: After three genuinely successful referrals, grant 60 days total of ad-supported free access.
		// Treat this as the total reward for reaching three referrals, not 30 + 60 days.
		rewardTier = 2
		daysGranted = cfg.Tier2RewardDays
		nextMilestone = nil // Highest milestone achieved
	}

	// 4. Calculate ActivatedAt, ExpiresAt, DaysRemaining & Expiry Status
	existingReward, _ := s.repo.GetUserReferralReward(ctx, normUserID)

	now := time.Now().UTC()
	var activatedAt *time.Time
	var expiresAt *time.Time
	rewardStatus := RewardStatusNone
	daysRemaining := 0

	if rewardTier > 0 {
		if existingReward != nil && existingReward.ActivatedAt != nil {
			activatedAt = existingReward.ActivatedAt
		} else {
			activatedAt = &now
		}

		var targetExpiry time.Time
		if rewardTier == 1 {
			targetExpiry = activatedAt.Add(time.Duration(cfg.Tier1RewardDays) * 24 * time.Hour)
		} else {
			// Tier 2: 60 days total from initial activation date
			targetExpiry = activatedAt.Add(time.Duration(cfg.Tier2RewardDays) * 24 * time.Hour)
			// If already past activatedAt + 60 days, ensure user gets the delta duration from now
			if targetExpiry.Before(now) && existingReward != nil && existingReward.RewardTier < 2 {
				targetExpiry = now.Add(time.Duration(cfg.Tier2RewardDays-cfg.Tier1RewardDays) * 24 * time.Hour)
			}
		}
		expiresAt = &targetExpiry

		if now.After(*expiresAt) {
			rewardStatus = RewardStatusExpired
			daysRemaining = 0
		} else {
			rewardStatus = RewardStatusActive
			hrs := expiresAt.Sub(now).Hours()
			daysRemaining = int(math.Ceil(hrs / 24.0))
			if daysRemaining < 1 {
				daysRemaining = 1
			}
		}
	}

	// 5. Idempotent Reward Persistence
	rewardRecord := &UserReferralReward{
		UserID:        normUserID,
		PartnerCode:   code,
		VerifiedCount: verifiedCount,
		RewardTier:    rewardTier,
		RewardStatus:  rewardStatus,
		ActivatedAt:   activatedAt,
		ExpiresAt:     expiresAt,
	}
	if existingReward != nil && existingReward.ID != "" {
		rewardRecord.ID = existingReward.ID
	}
	_ = s.repo.UpsertUserReferralReward(ctx, rewardRecord)

	// 6. Synchronize Entitlements (Idempotent)
	if s.entitlementGranter != nil {
		if rewardStatus == RewardStatusActive && expiresAt != nil {
			_ = s.entitlementGranter.GrantRewardEntitlement(ctx, normUserID, EntitlementAdSupportedAccess, *expiresAt, map[string]any{
				"reward_tier":    rewardTier,
				"verified_count": verifiedCount,
				"days_total":     daysGranted,
				"source":         SourceReferralReward,
			})
		} else if rewardStatus == RewardStatusExpired {
			_ = s.entitlementGranter.RevokeRewardEntitlement(ctx, normUserID)
		}
	}

	// 7. Check Existing Paid Subscriptions
	hasPaid := false
	paidTier := ""
	if s.subChecker != nil {
		has, tier, _ := s.subChecker.GetPaidSubscription(ctx, normUserID)
		hasPaid = has
		paidTier = tier
	}

	siteURL := s.siteURL
	if siteURL == "" {
		siteURL = "https://auradating.com"
	}
	inviteURL := fmt.Sprintf("%s/join?ref=%s", siteURL, code)

	return &UserReferralStatus{
		ReferralCode:         code,
		InviteURL:            inviteURL,
		VerifiedCount:        verifiedCount,
		PendingCount:         pendingCount,
		TotalCount:           verifiedCount + pendingCount,
		RewardTier:           rewardTier,
		RewardStatus:         rewardStatus,
		DaysGranted:          daysGranted,
		DaysRemaining:        daysRemaining,
		ActivatedAt:          activatedAt,
		ExpiresAt:            expiresAt,
		HasPaidSubscription:  hasPaid,
		PaidSubscriptionTier: paidTier,
		NextMilestone:        nextMilestone,
		RecentReferrals:      recentReferrals,
	}, nil
}
