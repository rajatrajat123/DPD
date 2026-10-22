package affiliate_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/affiliate"
	"github.com/auradating/platform/backend/internal/identity"
)

type mockUserVerifier struct {
	verifiedUsers map[string]struct {
		verified   bool
		maskedID   string
		verifiedAt *time.Time
		status     string
	}
}

func newMockUserVerifier() *mockUserVerifier {
	return &mockUserVerifier{
		verifiedUsers: make(map[string]struct {
			verified   bool
			maskedID   string
			verifiedAt *time.Time
			status     string
		}),
	}
}

func (m *mockUserVerifier) set(userID string, verified bool, maskedID string, verifiedAt *time.Time, status string) {
	m.verifiedUsers[userID] = struct {
		verified   bool
		maskedID   string
		verifiedAt *time.Time
		status     string
	}{
		verified:   verified,
		maskedID:   maskedID,
		verifiedAt: verifiedAt,
		status:     status,
	}
}

func (m *mockUserVerifier) IsUserVerified(_ context.Context, userID string) (bool, string, *time.Time, error) {
	entry, ok := m.verifiedUsers[userID]
	if !ok {
		return false, "Friend", nil, nil
	}
	if entry.status != "ACTIVE" {
		return false, entry.maskedID, nil, nil
	}
	return entry.verified, entry.maskedID, entry.verifiedAt, nil
}

type mockEntitlementGranter struct {
	grants  []string
	revokes []string
}

func (g *mockEntitlementGranter) GrantRewardEntitlement(_ context.Context, userID, code string, expiresAt time.Time, metadata map[string]any) error {
	g.grants = append(g.grants, userID+":"+code)
	return nil
}

func (g *mockEntitlementGranter) RevokeRewardEntitlement(_ context.Context, userID string) error {
	g.revokes = append(g.revokes, userID)
	return nil
}

type mockSubscriptionChecker struct {
	hasPaid bool
	tier    string
}

func (c *mockSubscriptionChecker) GetPaidSubscription(_ context.Context, _ string) (bool, string, error) {
	return c.hasPaid, c.tier, nil
}

func setupRewardsTestService() (*affiliate.Service, *affiliate.MemoryRepository, *mockUserVerifier, *mockEntitlementGranter, *mockSubscriptionChecker) {
	repo := affiliate.NewMemoryRepository()
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	payoutReg := affiliate.NewPayoutRegistry(
		affiliate.NewStripeConnectPayoutAdapter("sk_test"),
		affiliate.NewCryptoPayoutAdapter(false, ""),
	)
	svc := affiliate.NewService(repo, payoutReg, logger)

	verifier := newMockUserVerifier()
	granter := &mockEntitlementGranter{}
	subChecker := &mockSubscriptionChecker{}

	svc.SetUserVerificationChecker(verifier)
	svc.SetEntitlementGranter(granter)
	svc.SetSubscriptionChecker(subChecker)
	svc.SetSiteURL("https://auradating.com")

	return svc, repo, verifier, granter, subChecker
}

func TestUserReferralRewards_CodeProvisioningAndIdempotency(t *testing.T) {
	ctx := context.Background()
	svc, repo, _, _, _ := setupRewardsTestService()

	userID := "usr_alice_123"

	// 1. Get code for the first time
	code1, err := svc.GetOrCreateUserReferralCode(ctx, userID)
	if err != nil {
		t.Fatalf("unexpected error getting referral code: %v", err)
	}
	if code1 == "" {
		t.Fatalf("expected non-empty referral code")
	}

	// 2. Calling it again returns the exact same code
	code2, err := svc.GetOrCreateUserReferralCode(ctx, userID)
	if err != nil {
		t.Fatalf("unexpected error getting referral code second time: %v", err)
	}
	if code1 != code2 {
		t.Fatalf("expected same code on retry, got %s and %s", code1, code2)
	}

	// 3. Status should show the code and valid invite link
	status, err := svc.GetUserReferralStatus(ctx, userID)
	if err != nil {
		t.Fatalf("unexpected error getting referral status: %v", err)
	}
	if status.ReferralCode != code1 {
		t.Fatalf("expected status referral code to match %s, got %s", code1, status.ReferralCode)
	}
	expectedURL := "https://auradating.com/join?ref=" + code1
	if status.InviteURL != expectedURL {
		t.Fatalf("expected invite URL %s, got %s", expectedURL, status.InviteURL)
	}
	if status.VerifiedCount != 0 || status.PendingCount != 0 || status.TotalCount != 0 {
		t.Fatalf("expected 0 counts initially, got verified=%d pending=%d", status.VerifiedCount, status.PendingCount)
	}
	if status.RewardTier != 0 || status.RewardStatus != affiliate.RewardStatusNone || status.DaysGranted != 0 {
		t.Fatalf("expected no initial reward, got tier=%d status=%s days=%d", status.RewardTier, status.RewardStatus, status.DaysGranted)
	}
	if status.NextMilestone == nil || status.NextMilestone.TargetReferrals != 1 || status.NextMilestone.RemainingNeeded != 1 {
		t.Fatalf("expected next milestone for 1 referral, got %+v", status.NextMilestone)
	}

	_ = repo
}

func TestUserReferralRewards_UnverifiedAndModerationRules(t *testing.T) {
	ctx := context.Background()
	svc, repo, verifier, granter, _ := setupRewardsTestService()

	referrerID := "usr_referrer_1"
	code, err := svc.GetOrCreateUserReferralCode(ctx, referrerID)
	if err != nil {
		t.Fatalf("failed to get referral code: %v", err)
	}

	// Friend 1: signed up, but not verified yet
	friend1ID := "usr_friend_unverified"
	verifier.set(friend1ID, false, "u***@gmail.com", nil, "ACTIVE")
	_, err = svc.AttributeRegistration(ctx, friend1ID, code, "")
	if err != nil {
		t.Fatalf("failed to attribute friend1: %v", err)
	}

	// Friend 2: verified email, but account is BANNED / SUSPENDED for safety violations
	friend2ID := "usr_friend_banned"
	now := time.Now().UTC()
	verifier.set(friend2ID, true, "b***@gmail.com", &now, "BANNED")
	_, err = svc.AttributeRegistration(ctx, friend2ID, code, "")
	if err != nil {
		t.Fatalf("failed to attribute friend2: %v", err)
	}

	// Evaluate status
	status, err := svc.GetUserReferralStatus(ctx, referrerID)
	if err != nil {
		t.Fatalf("failed to get status: %v", err)
	}

	// Neither friend 1 (unverified) nor friend 2 (banned) should count as verified
	if status.VerifiedCount != 0 {
		t.Fatalf("expected 0 verified referrals, got %d", status.VerifiedCount)
	}
	if status.PendingCount != 2 {
		t.Fatalf("expected 2 pending referrals, got %d", status.PendingCount)
	}
	if status.RewardStatus != affiliate.RewardStatusNone || status.DaysGranted != 0 {
		t.Fatalf("expected no reward granted for unverified/banned users, got %s / %d days", status.RewardStatus, status.DaysGranted)
	}
	if len(granter.grants) != 0 {
		t.Fatalf("expected 0 entitlement grants, got %d", len(granter.grants))
	}

	_ = repo
}

func TestUserReferralRewards_Tier1Threshold_30Days(t *testing.T) {
	ctx := context.Background()
	svc, _, verifier, granter, _ := setupRewardsTestService()

	referrerID := "usr_referrer_tier1"
	code, err := svc.GetOrCreateUserReferralCode(ctx, referrerID)
	if err != nil {
		t.Fatalf("failed to create code: %v", err)
	}

	// Friend 1 signs up and genuinely completes email verification
	friend1ID := "usr_friend_verified_1"
	vAt := time.Now().UTC()
	verifier.set(friend1ID, true, "f1***@gmail.com", &vAt, "ACTIVE")
	_, err = svc.AttributeRegistration(ctx, friend1ID, code, "")
	if err != nil {
		t.Fatalf("failed to attribute registration: %v", err)
	}

	status, err := svc.GetUserReferralStatus(ctx, referrerID)
	if err != nil {
		t.Fatalf("failed to get referral status: %v", err)
	}

	// Check 1 referral -> 30 days granted
	if status.VerifiedCount != 1 {
		t.Fatalf("expected 1 verified referral, got %d", status.VerifiedCount)
	}
	if status.RewardTier != 1 {
		t.Fatalf("expected RewardTier 1, got %d", status.RewardTier)
	}
	if status.RewardStatus != affiliate.RewardStatusActive {
		t.Fatalf("expected RewardStatus ACTIVE, got %s", status.RewardStatus)
	}
	if status.DaysGranted != 30 {
		t.Fatalf("expected 30 days granted, got %d", status.DaysGranted)
	}
	if status.DaysRemaining < 29 || status.DaysRemaining > 30 {
		t.Fatalf("expected ~30 days remaining, got %d", status.DaysRemaining)
	}
	if status.NextMilestone == nil || status.NextMilestone.TargetReferrals != 3 || status.NextMilestone.RemainingNeeded != 2 {
		t.Fatalf("expected next milestone for 3 referrals (2 remaining), got %+v", status.NextMilestone)
	}

	// Verify entitlement was granted
	if len(granter.grants) == 0 {
		t.Fatalf("expected entitlement grant, got none")
	}
	if granter.grants[0] != referrerID+":"+affiliate.EntitlementAdSupportedAccess {
		t.Fatalf("expected grant of %s, got %s", affiliate.EntitlementAdSupportedAccess, granter.grants[0])
	}
}

func TestUserReferralRewards_Tier2Threshold_Total60DaysNotSum(t *testing.T) {
	ctx := context.Background()
	svc, _, verifier, _, _ := setupRewardsTestService()

	referrerID := "usr_referrer_tier2"
	code, err := svc.GetOrCreateUserReferralCode(ctx, referrerID)
	if err != nil {
		t.Fatalf("failed to create code: %v", err)
	}

	now := time.Now().UTC()

	// 1st verified referral: grants 30 days
	friend1 := "usr_f1"
	verifier.set(friend1, true, "f1***@gmail.com", &now, "ACTIVE")
	_, _ = svc.AttributeRegistration(ctx, friend1, code, "")
	status1, _ := svc.GetUserReferralStatus(ctx, referrerID)
	if status1.DaysGranted != 30 || status1.RewardTier != 1 {
		t.Fatalf("expected 30 days at tier 1, got %d", status1.DaysGranted)
	}
	t1Activation := status1.ActivatedAt

	// 2nd verified referral: still tier 1 (30 days total)
	friend2 := "usr_f2"
	verifier.set(friend2, true, "f2***@gmail.com", &now, "ACTIVE")
	_, _ = svc.AttributeRegistration(ctx, friend2, code, "")
	status2, _ := svc.GetUserReferralStatus(ctx, referrerID)
	if status2.DaysGranted != 30 || status2.RewardTier != 1 {
		t.Fatalf("expected still 30 days with 2 referrals, got %d", status2.DaysGranted)
	}
	if status2.NextMilestone == nil || status2.NextMilestone.RemainingNeeded != 1 {
		t.Fatalf("expected 1 remaining for next milestone, got %+v", status2.NextMilestone)
	}

	// 3rd verified referral: reaches Tier 2!
	// Rule: After three genuinely successful referrals, grant the referring user 60 days total
	// of ad-supported free access. Treat this as the total reward for reaching three referrals, not 30 + 60 days.
	friend3 := "usr_f3"
	verifier.set(friend3, true, "f3***@gmail.com", &now, "ACTIVE")
	_, _ = svc.AttributeRegistration(ctx, friend3, code, "")
	status3, _ := svc.GetUserReferralStatus(ctx, referrerID)

	if status3.VerifiedCount != 3 {
		t.Fatalf("expected 3 verified referrals, got %d", status3.VerifiedCount)
	}
	if status3.RewardTier != 2 {
		t.Fatalf("expected RewardTier 2, got %d", status3.RewardTier)
	}
	if status3.DaysGranted != 60 {
		t.Fatalf("expected 60 days total granted, got %d", status3.DaysGranted)
	}
	if status3.NextMilestone != nil {
		t.Fatalf("expected no next milestone after reaching maximum tier, got %+v", status3.NextMilestone)
	}

	// Check that ActivatedAt was preserved from Tier 1
	if status3.ActivatedAt.Sub(*t1Activation).Abs() > time.Second {
		t.Fatalf("expected ActivatedAt to be preserved from initial activation")
	}

	// Check total expiry duration is 60 days from initial activation (not 90 days / 30+60)
	totalSpanDays := int(status3.ExpiresAt.Sub(*status3.ActivatedAt).Hours() / 24.0)
	if totalSpanDays != 60 {
		t.Fatalf("expected total span from activation to expiry to be 60 days, got %d days", totalSpanDays)
	}
}

func TestUserReferralRewards_SelfReferralBlocked(t *testing.T) {
	ctx := context.Background()
	svc, _, verifier, _, _ := setupRewardsTestService()

	userID := "usr_self_ref"
	code, _ := svc.GetOrCreateUserReferralCode(ctx, userID)

	// Attempting to attribute oneself to own referral code
	vAt := time.Now().UTC()
	verifier.set(userID, true, "self***@gmail.com", &vAt, "ACTIVE")

	_, err := svc.AttributeRegistration(ctx, userID, code, "")
	if err != affiliate.ErrSelfReferralBlocked {
		t.Fatalf("expected ErrSelfReferralBlocked, got %v", err)
	}

	status, _ := svc.GetUserReferralStatus(ctx, userID)
	if status.VerifiedCount != 0 || status.TotalCount != 0 {
		t.Fatalf("expected 0 referrals recorded after self referral attempt, got verified=%d", status.VerifiedCount)
	}
}

func TestUserReferralRewards_DuplicateAttributionBlocked(t *testing.T) {
	ctx := context.Background()
	svc, _, _, _, _ := setupRewardsTestService()

	user1 := "usr_user_1"
	code1, _ := svc.GetOrCreateUserReferralCode(ctx, user1)

	user2 := "usr_user_2"
	code2, _ := svc.GetOrCreateUserReferralCode(ctx, user2)

	referredFriend := "usr_friend_common"

	// First attribution to user 1 succeeds
	_, err := svc.AttributeRegistration(ctx, referredFriend, code1, "")
	if err != nil {
		t.Fatalf("expected first attribution to succeed, got %v", err)
	}

	// Attempting to attribute same friend to user 2 must fail with duplicate attribution
	_, err = svc.AttributeRegistration(ctx, referredFriend, code2, "")
	if err != affiliate.ErrDuplicateAttribution {
		t.Fatalf("expected ErrDuplicateAttribution, got %v", err)
	}
}

func TestUserReferralRewards_PaidSubscriptionSeparation(t *testing.T) {
	ctx := context.Background()
	svc, _, verifier, _, subChecker := setupRewardsTestService()

	referrerID := "usr_vip_subscriber"
	code, _ := svc.GetOrCreateUserReferralCode(ctx, referrerID)

	// User has paid VIP subscription (e.g. Aura Black)
	subChecker.hasPaid = true
	subChecker.tier = "BLACK"

	// 1 verified referral
	friend := "usr_vip_friend"
	now := time.Now().UTC()
	verifier.set(friend, true, "f***@vip.com", &now, "ACTIVE")
	_, _ = svc.AttributeRegistration(ctx, friend, code, "")

	status, err := svc.GetUserReferralStatus(ctx, referrerID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify both exist clearly without collision
	if !status.HasPaidSubscription || status.PaidSubscriptionTier != "BLACK" {
		t.Fatalf("expected active paid BLACK subscription flag, got hasPaid=%v tier=%s", status.HasPaidSubscription, status.PaidSubscriptionTier)
	}
	if status.RewardTier != 1 || status.DaysGranted != 30 {
		t.Fatalf("expected referral ad-supported reward of 30 days preserved alongside paid subscription, got tier=%d days=%d", status.RewardTier, status.DaysGranted)
	}
}

func TestUserReferralRewards_HTTPHandlerEndToEnd(t *testing.T) {
	svc, _, verifier, _, _ := setupRewardsTestService()
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	handler := affiliate.NewHandler(svc, logger)

	userID := "usr_http_test_1"
	vAt := time.Now().UTC()

	// 1. Unauthenticated request rejected
	req := httptest.NewRequest(http.MethodGet, "/api/v1/referrals/me", nil)
	rr := httptest.NewRecorder()
	handler.UserReferralMe(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized without auth context, got %d", rr.Code)
	}

	// 2. Authenticated request
	authCtx := identity.ContextWithAuthUser(req.Context(), &identity.AuthUser{ID: userID, Role: "MEMBER"})
	req = req.WithContext(authCtx)
	rr = httptest.NewRecorder()
	handler.UserReferralMe(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rr.Code, rr.Body.String())
	}

	var status affiliate.UserReferralStatus
	if err := json.NewDecoder(rr.Body).Decode(&status); err != nil {
		t.Fatalf("failed to decode status response: %v", err)
	}
	if status.ReferralCode == "" {
		t.Fatalf("expected non-empty referral code in response")
	}

	// 3. Friend signs up
	friendID := "usr_http_friend_1"
	verifier.set(friendID, true, "h***@test.com", &vAt, "ACTIVE")
	_, err := svc.AttributeRegistration(context.Background(), friendID, status.ReferralCode, "")
	if err != nil {
		t.Fatalf("failed to attribute registration: %v", err)
	}

	// 4. Call POST /api/v1/referrals/refresh
	refreshReq := httptest.NewRequest(http.MethodPost, "/api/v1/referrals/refresh", nil).WithContext(authCtx)
	refreshRR := httptest.NewRecorder()
	handler.UserReferralRefresh(refreshRR, refreshReq)

	if refreshRR.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on refresh, got %d: %s", refreshRR.Code, refreshRR.Body.String())
	}

	var refreshedStatus affiliate.UserReferralStatus
	if err := json.NewDecoder(refreshRR.Body).Decode(&refreshedStatus); err != nil {
		t.Fatalf("failed to decode refresh response: %v", err)
	}

	if refreshedStatus.VerifiedCount != 1 || refreshedStatus.DaysGranted != 30 || refreshedStatus.RewardStatus != affiliate.RewardStatusActive {
		t.Fatalf("expected refreshed status to reflect 1 verified referral and 30 days, got verified=%d days=%d status=%s", refreshedStatus.VerifiedCount, refreshedStatus.DaysGranted, refreshedStatus.RewardStatus)
	}
}
