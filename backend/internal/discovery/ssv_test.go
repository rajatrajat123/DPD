package discovery

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/asn1"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/identity"
)

func generateTestECDSAKey() (*ecdsa.PrivateKey, error) {
	return ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
}

func signQueryString(priv *ecdsa.PrivateKey, queryToSign string) (string, error) {
	hash := sha256.Sum256([]byte(queryToSign))
	r, s, err := ecdsa.Sign(rand.Reader, priv, hash[:])
	if err != nil {
		return "", err
	}
	der, err := asn1.Marshal(struct{ R, S *big.Int }{R: r, S: s})
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(der), nil
}

func TestAdMobSSV_ECDSA_Verification(t *testing.T) {
	priv, err := generateTestECDSAKey()
	if err != nil {
		t.Fatalf("failed to generate ecdsa key: %v", err)
	}

	verifier := NewSSVVerifier(false)
	verifier.SetTestPublicKey(12345, &priv.PublicKey)

	nowMs := time.Now().UTC().UnixMilli()
	baseQuery := fmt.Sprintf("ad_network=54321&ad_unit=ca-app-pub-test/123&key_id=12345&reward_amount=3&reward_item=likes&timestamp=%d&transaction_id=tx_test_1001&user_id=user_alpha", nowMs)

	sig, err := signQueryString(priv, baseQuery)
	if err != nil {
		t.Fatalf("failed to sign query string: %v", err)
	}

	fullQuery := fmt.Sprintf("%s&signature=%s", baseQuery, url.QueryEscape(sig))

	// 1. Valid Signature Test
	reward, err := verifier.VerifyCallback(fullQuery)
	if err != nil {
		t.Fatalf("expected signature verification to succeed, got: %v", err)
	}
	if reward.TransactionID != "tx_test_1001" {
		t.Errorf("expected tx_test_1001, got %s", reward.TransactionID)
	}
	if reward.RewardAmount != 3 {
		t.Errorf("expected reward amount 3, got %d", reward.RewardAmount)
	}

	// 2. Tampered Message Test (Amount changed from 3 to 999)
	tamperedQuery := strings.Replace(fullQuery, "reward_amount=3", "reward_amount=999", 1)
	_, err = verifier.VerifyCallback(tamperedQuery)
	if err == nil {
		t.Fatal("expected tampered signature verification to fail, got nil")
	}

	// 3. Bad Signature Test
	badSigQuery := fmt.Sprintf("%s&signature=%s", baseQuery, url.QueryEscape("bad_invalid_signature"))
	_, err = verifier.VerifyCallback(badSigQuery)
	if err == nil {
		t.Fatal("expected bad signature to fail, got nil")
	}
}

func TestAdMobSSV_ReplayProtection(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	discoRepo := NewMemoryRepository(identRepo)

	ctx := context.Background()
	userID := "user_beta"
	txID := "tx_unique_9988"

	// First claim: should succeed
	err := discoRepo.RecordAdReward(ctx, userID, txID, 3)
	if err != nil {
		t.Fatalf("expected first reward record to succeed, got: %v", err)
	}

	// Duplicate claim (replay attack): must be rejected
	err = discoRepo.RecordAdReward(ctx, userID, txID, 3)
	if err == nil || err != ErrDuplicateSSVReward {
		t.Fatalf("expected ErrDuplicateSSVReward on duplicate transaction, got: %v", err)
	}
}

func TestAdMobSSV_ExpiredCallback(t *testing.T) {
	priv, _ := generateTestECDSAKey()
	verifier := NewSSVVerifier(false)
	verifier.SetTestPublicKey(12345, &priv.PublicKey)

	// Timestamp is 30 minutes in the past
	oldMs := time.Now().UTC().Add(-30 * time.Minute).UnixMilli()
	baseQuery := fmt.Sprintf("ad_network=test&key_id=12345&reward_amount=3&timestamp=%d&transaction_id=tx_old&user_id=user_gamma", oldMs)
	sig, _ := signQueryString(priv, baseQuery)
	fullQuery := fmt.Sprintf("%s&signature=%s", baseQuery, url.QueryEscape(sig))

	_, err := verifier.VerifyCallback(fullQuery)
	if err == nil || err != ErrExpiredSSVCallback {
		t.Fatalf("expected ErrExpiredSSVCallback for 30m old callback, got: %v", err)
	}
}

func TestSwipeQuota_DailyLimit_10(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	discoRepo := NewMemoryRepository(identRepo)
	svc := NewService(discoRepo, identRepo, nil, nil)

	ctx := context.Background()
	actorID := "actor_free_user"

	// Set daily limit to 10
	discoRepo.SetDailyLikeQuota(10)

	// PASS swipes do NOT decrement quota
	for i := 0; i < 5; i++ {
		targetID := fmt.Sprintf("target_pass_%d", i)
		_, err := svc.Swipe(ctx, actorID, SwipeRequest{TargetUserID: targetID, Direction: "PASS"}, "corr-1")
		if err != nil {
			t.Fatalf("PASS swipe should always be permitted, got error: %v", err)
		}
	}

	allowance, isUnlimited, err := svc.GetSwipeAllowance(ctx, actorID)
	if err != nil || isUnlimited || allowance != 10 {
		t.Fatalf("allowance after 5 passes should still be 10, got %d (unlimited: %v)", allowance, isUnlimited)
	}

	// Make 10 LIKE swipes
	for i := 0; i < 10; i++ {
		targetID := fmt.Sprintf("target_like_%d", i)
		_, err := svc.Swipe(ctx, actorID, SwipeRequest{TargetUserID: targetID, Direction: "LIKE"}, fmt.Sprintf("corr-%d", i))
		if err != nil {
			t.Fatalf("LIKE swipe %d should be allowed within daily quota 10, got error: %v", i+1, err)
		}
	}

	// 11th LIKE swipe should be rejected
	_, err = svc.Swipe(ctx, actorID, SwipeRequest{TargetUserID: "target_like_11", Direction: "LIKE"}, "corr-11")
	if err == nil || err != ErrSwipeLimitReached {
		t.Fatalf("expected ErrSwipeLimitReached after 10 likes, got: %v", err)
	}

	// PASS swipe is still permitted even when like quota is exhausted
	_, err = svc.Swipe(ctx, actorID, SwipeRequest{TargetUserID: "target_pass_final", Direction: "PASS"}, "corr-final")
	if err != nil {
		t.Fatalf("PASS swipe must remain permitted even when like quota is 0, got error: %v", err)
	}
}

func TestSwipeQuota_BonusLikesFromAd(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	discoRepo := NewMemoryRepository(identRepo)
	svc := NewService(discoRepo, identRepo, nil, nil, WithEnvironment("local"))

	ctx := context.Background()
	actorID := "actor_rewarded_user"
	discoRepo.SetDailyLikeQuota(10)

	// Exhaust 10 likes
	for i := 0; i < 10; i++ {
		targetID := fmt.Sprintf("target_%d", i)
		_, _ = svc.Swipe(ctx, actorID, SwipeRequest{TargetUserID: targetID, Direction: "LIKE"}, "c")
	}

	allowance, _, _ := svc.GetSwipeAllowance(ctx, actorID)
	if allowance != 0 {
		t.Fatalf("expected allowance 0, got %d", allowance)
	}

	// Watch rewarded ad: verify callback with test signature granting 1 bonus like
	nowMs := time.Now().UTC().UnixMilli()
	query := fmt.Sprintf("ad_network=54321&key_id=1&reward_amount=1&timestamp=%d&transaction_id=tx_ad_reward_55&user_id=%s&signature=VALID_TEST_SSV_SIGNATURE", nowMs, actorID)

	reward, err := svc.VerifyAndGrantAdReward(ctx, query)
	if err != nil {
		t.Fatalf("expected reward grant to succeed, got error: %v", err)
	}
	if reward.RewardAmount != 1 {
		t.Errorf("expected reward amount 1, got %d", reward.RewardAmount)
	}

	// Allowance should now be exactly 1
	newAllowance, _, _ := svc.GetSwipeAllowance(ctx, actorID)
	if newAllowance != 1 {
		t.Fatalf("expected allowance 1 after rewarded ad, got %d", newAllowance)
	}

	// Can now perform 1 bonus like on a photo-verified profile
	targetID := "target_bonus_1"
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{
		UserID:          targetID,
		DisplayName:     "Verified Target",
		IsPhotoVerified: true,
	})
	_, err = svc.Swipe(ctx, actorID, SwipeRequest{TargetUserID: targetID, Direction: "LIKE"}, "c")
	if err != nil {
		t.Fatalf("expected bonus like 1 to succeed, got %v", err)
	}

	// 2nd bonus like should fail because quota is exhausted
	_, err = svc.Swipe(ctx, actorID, SwipeRequest{TargetUserID: "target_bonus_fail", Direction: "LIKE"}, "c")
	if err != ErrSwipeLimitReached {
		t.Fatalf("expected quota exhausted after 1 bonus like, got: %v", err)
	}
}

func TestSwipeQuota_PremiumEntitlement(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	discoRepo := NewMemoryRepository(identRepo)
	svc := NewService(discoRepo, identRepo, nil, nil)

	ctx := context.Background()
	actorID := "actor_premium_user"

	// Grant UNLIMITED_SWIPES entitlement
	discoRepo.entitlements[actorID] = []entitlementRecord{
		{Code: "UNLIMITED_SWIPES", ExpiresAt: time.Now().UTC().Add(30 * 24 * time.Hour), Source: "VIP_SUBSCRIPTION"},
	}

	// Allowance should report unlimited
	_, isUnlimited, err := svc.GetSwipeAllowance(ctx, actorID)
	if err != nil || !isUnlimited {
		t.Fatalf("expected unlimited swipes for premium user, got: isUnlimited=%v", isUnlimited)
	}

	// Perform 25 likes without quota error
	for i := 0; i < 25; i++ {
		targetID := fmt.Sprintf("target_prem_%d", i)
		_, err := svc.Swipe(ctx, actorID, SwipeRequest{TargetUserID: targetID, Direction: "LIKE"}, "c")
		if err != nil {
			t.Fatalf("premium user swipe %d failed: %v", i+1, err)
		}
	}
}

func TestSwipeQuota_ParallelLikes_Atomic(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	discoRepo := NewMemoryRepository(identRepo)
	svc := NewService(discoRepo, identRepo, nil, nil)

	ctx := context.Background()
	actorID := "actor_concurrency_user"
	discoRepo.SetDailyLikeQuota(10)

	var wg sync.WaitGroup
	var successCount int
	var failCount int
	var mu sync.Mutex

	// Fire 30 concurrent likes simultaneously
	for i := 0; i < 30; i++ {
		wg.Add(1)
		targetID := fmt.Sprintf("target_conc_%d", i)
		go func(tID string) {
			defer wg.Done()
			_, err := svc.Swipe(ctx, actorID, SwipeRequest{TargetUserID: tID, Direction: "LIKE"}, "c")
			mu.Lock()
			if err == nil {
				successCount++
			} else if err == ErrSwipeLimitReached {
				failCount++
			}
			mu.Unlock()
		}(targetID)
	}

	wg.Wait()

	if successCount != 10 {
		t.Fatalf("expected exactly 10 successful likes under concurrency, got %d", successCount)
	}
	if failCount != 20 {
		t.Fatalf("expected exactly 20 failed likes due to quota, got %d", failCount)
	}
}

func TestAdMobSSV_ProductionRejectsSyntheticTestSignature(t *testing.T) {
	nowMs := time.Now().UTC().UnixMilli()
	query := fmt.Sprintf("ad_network=54321&key_id=1&reward_amount=1&timestamp=%d&transaction_id=tx_prod_synth_1&user_id=usr_test&signature=VALID_TEST_SSV_SIGNATURE", nowMs)

	// 1. Verifier with isSandbox=false in production
	prodVerifier := NewSSVVerifier(false, "production")
	_, err := prodVerifier.VerifyCallback(query)
	if err == nil || err != ErrInvalidSSVSignature {
		t.Fatalf("production verifier must strictly reject VALID_TEST_SSV_SIGNATURE, got: %v", err)
	}

	// 2. Even if isSandbox was mistakenly set to true, production environment MUST fail closed
	maliciousProdVerifier := NewSSVVerifier(true, "production")
	_, err = maliciousProdVerifier.VerifyCallback(query)
	if err == nil || err != ErrInvalidSSVSignature {
		t.Fatalf("production environment must override isSandbox=true and reject test signature, got: %v", err)
	}
}

func TestAdMobSSV_StagingRejectsSyntheticTestSignature(t *testing.T) {
	nowMs := time.Now().UTC().UnixMilli()
	query := fmt.Sprintf("ad_network=54321&key_id=1&reward_amount=1&timestamp=%d&transaction_id=tx_staging_synth_1&user_id=usr_test&signature=VALID_TEST_SSV_SIGNATURE", nowMs)

	stagingVerifier := NewSSVVerifier(false, "staging")
	_, err := stagingVerifier.VerifyCallback(query)
	if err == nil || err != ErrInvalidSSVSignature {
		t.Fatalf("staging verifier must reject test signature, got: %v", err)
	}

	maliciousStaging := NewSSVVerifier(true, "staging")
	_, err = maliciousStaging.VerifyCallback(query)
	if err == nil || err != ErrInvalidSSVSignature {
		t.Fatalf("staging environment must reject test signature even if isSandbox=true, got: %v", err)
	}
}

func TestAdMobSSV_UnconfiguredEnvironmentFailsClosed(t *testing.T) {
	nowMs := time.Now().UTC().UnixMilli()
	query := fmt.Sprintf("ad_network=54321&key_id=1&reward_amount=1&timestamp=%d&transaction_id=tx_unconf_1&user_id=usr_test&signature=VALID_TEST_SSV_SIGNATURE", nowMs)

	// Default unconfigured verifier (empty environment, sandbox false)
	unconfVerifier := NewSSVVerifier(false)
	_, err := unconfVerifier.VerifyCallback(query)
	if err == nil || err != ErrInvalidSSVSignature {
		t.Fatalf("unconfigured verifier must reject test signature, got: %v", err)
	}

	// Sandbox true without valid environment must fail closed
	sandboxUnconf := NewSSVVerifier(true, "")
	_, err = sandboxUnconf.VerifyCallback(query)
	if err == nil || err != ErrInvalidSSVSignature {
		t.Fatalf("unconfigured environment with isSandbox=true must fail closed, got: %v", err)
	}

	// Unknown environment string must fail closed
	unknownEnv := NewSSVVerifier(true, "unknown_cloud_env")
	_, err = unknownEnv.VerifyCallback(query)
	if err == nil || err != ErrInvalidSSVSignature {
		t.Fatalf("unknown environment must fail closed, got: %v", err)
	}
}

func TestAdMobSSV_MissingRequiredParameters(t *testing.T) {
	v := NewSSVVerifier(false, "production")
	nowMs := time.Now().UTC().UnixMilli()

	// Missing transaction_id
	q1 := fmt.Sprintf("ad_network=54321&key_id=1&reward_amount=1&timestamp=%d&user_id=usr_test&signature=somesig", nowMs)
	if _, err := v.VerifyCallback(q1); err != ErrMissingSSVParam {
		t.Fatalf("expected ErrMissingSSVParam for missing transaction_id, got: %v", err)
	}

	// Missing user_id
	q2 := fmt.Sprintf("ad_network=54321&key_id=1&reward_amount=1&timestamp=%d&transaction_id=tx_123&signature=somesig", nowMs)
	if _, err := v.VerifyCallback(q2); err != ErrMissingSSVParam {
		t.Fatalf("expected ErrMissingSSVParam for missing user_id, got: %v", err)
	}

	// Missing key_id
	q3 := fmt.Sprintf("ad_network=54321&reward_amount=1&timestamp=%d&transaction_id=tx_123&user_id=usr_test&signature=somesig", nowMs)
	if _, err := v.VerifyCallback(q3); err != ErrMissingSSVParam {
		t.Fatalf("expected ErrMissingSSVParam for missing key_id, got: %v", err)
	}

	// Missing signature
	q4 := fmt.Sprintf("ad_network=54321&key_id=1&reward_amount=1&timestamp=%d&transaction_id=tx_123&user_id=usr_test", nowMs)
	if _, err := v.VerifyCallback(q4); err != ErrMissingSSVParam {
		t.Fatalf("expected ErrMissingSSVParam for missing signature, got: %v", err)
	}
}

func TestAdMobSSV_ProductionGenuineECDSAVerification(t *testing.T) {
	priv, err := generateTestECDSAKey()
	if err != nil {
		t.Fatalf("failed to generate test key: %v", err)
	}

	keyID := int64(777888)
	v := NewSSVVerifier(false, "production")
	v.SetTestPublicKey(keyID, &priv.PublicKey)

	nowMs := time.Now().UTC().UnixMilli()
	baseQuery := fmt.Sprintf("ad_network=54321&ad_unit=ca-app-pub-prod/999&key_id=%d&reward_amount=1&reward_item=BONUS_LIKE&timestamp=%d&transaction_id=tx_prod_genuine_1&user_id=usr_prod_1", keyID, nowMs)

	sig, err := signQueryString(priv, baseQuery)
	if err != nil {
		t.Fatalf("failed to sign query: %v", err)
	}
	validQuery := fmt.Sprintf("%s&signature=%s", baseQuery, url.QueryEscape(sig))

	// 1. Genuine signature passes in production
	reward, err := v.VerifyCallback(validQuery)
	if err != nil {
		t.Fatalf("genuine ECDSA signature must pass in production, got: %v", err)
	}
	if reward.TransactionID != "tx_prod_genuine_1" {
		t.Fatalf("expected tx_prod_genuine_1, got: %s", reward.TransactionID)
	}
	if reward.RewardAmount != 1 {
		t.Fatalf("expected reward 1, got: %d", reward.RewardAmount)
	}

	// 2. Forged signature fails in production
	forgedQuery := fmt.Sprintf("%s&signature=%s", baseQuery, url.QueryEscape("forged_bogus_signature_data"))
	_, err = v.VerifyCallback(forgedQuery)
	if err == nil || err != ErrInvalidSSVSignature {
		t.Fatalf("forged signature must fail with ErrInvalidSSVSignature, got: %v", err)
	}

	// 3. Tampered payload (reward_amount modified from 1 to 50) fails
	tamperedQuery := strings.Replace(validQuery, "reward_amount=1", "reward_amount=50", 1)
	_, err = v.VerifyCallback(tamperedQuery)
	if err == nil || err != ErrInvalidSSVSignature {
		t.Fatalf("tampered payload must fail with ErrInvalidSSVSignature, got: %v", err)
	}
}

func TestAdMobSSV_Service_ProductionRejectsSyntheticAndAcceptsGenuineECDSA(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	discoRepo := NewMemoryRepository(identRepo)
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))

	// Instantiate discovery service with PRODUCTION environment
	svc := NewService(discoRepo, identRepo, nil, logger, WithEnvironment("production"))
	ctx := context.Background()
	actorID := "actor_prod_user"
	discoRepo.SetDailyLikeQuota(10)

	// Exhaust quota
	for i := 0; i < 10; i++ {
		_, _ = svc.Swipe(ctx, actorID, SwipeRequest{TargetUserID: fmt.Sprintf("target_%d", i), Direction: "LIKE"}, "c")
	}

	allowance, _, _ := svc.GetSwipeAllowance(ctx, actorID)
	if allowance != 0 {
		t.Fatalf("expected allowance 0, got %d", allowance)
	}

	// Attempt 1: Client tries synthetic callback in production -> REJECTED
	nowMs := time.Now().UTC().UnixMilli()
	syntheticQuery := fmt.Sprintf("ad_network=54321&key_id=1&reward_amount=1&timestamp=%d&transaction_id=tx_hacked_1&user_id=%s&signature=VALID_TEST_SSV_SIGNATURE", nowMs, actorID)
	_, err := svc.VerifyAndGrantAdReward(ctx, syntheticQuery)
	if err == nil || err != ErrInvalidSSVSignature {
		t.Fatalf("production service must reject synthetic test signature, got: %v", err)
	}

	// Quota remains 0 after rejected synthetic attack
	allowanceAfterAttack, _, _ := svc.GetSwipeAllowance(ctx, actorID)
	if allowanceAfterAttack != 0 {
		t.Fatalf("allowance must remain 0 after rejected synthetic attempt, got: %d", allowanceAfterAttack)
	}

	// Attempt 2: Genuine AdMob server callback signed with genuine ECDSA private key -> ACCEPTED
	priv, err := generateTestECDSAKey()
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	keyID := int64(888999)
	svc.SSVVerifier().SetTestPublicKey(keyID, &priv.PublicKey)

	genuineBase := fmt.Sprintf("ad_network=54321&ad_unit=ca-app-pub-prod/123&key_id=%d&reward_amount=1&reward_item=BONUS_LIKE&timestamp=%d&transaction_id=tx_genuine_admob_reward&user_id=%s", keyID, nowMs, actorID)
	sig, err := signQueryString(priv, genuineBase)
	if err != nil {
		t.Fatalf("failed to sign genuine callback: %v", err)
	}
	genuineQuery := fmt.Sprintf("%s&signature=%s", genuineBase, url.QueryEscape(sig))

	reward, err := svc.VerifyAndGrantAdReward(ctx, genuineQuery)
	if err != nil {
		t.Fatalf("genuine signed SSV callback must be accepted in production, got: %v", err)
	}
	if reward.RewardAmount != 1 {
		t.Fatalf("expected reward 1, got %d", reward.RewardAmount)
	}

	// Allowance must now be 1
	allowanceAfterReward, _, _ := svc.GetSwipeAllowance(ctx, actorID)
	if allowanceAfterReward != 1 {
		t.Fatalf("expected allowance 1 after genuine reward, got: %d", allowanceAfterReward)
	}

	// Attempt 3: Replay attack with same genuine transaction ID -> REJECTED
	_, err = svc.VerifyAndGrantAdReward(ctx, genuineQuery)
	if err == nil || err != ErrDuplicateSSVReward {
		t.Fatalf("replay of genuine transaction must be rejected with ErrDuplicateSSVReward, got: %v", err)
	}

	// Allowance still 1 (not double-credited)
	allowanceAfterReplay, _, _ := svc.GetSwipeAllowance(ctx, actorID)
	if allowanceAfterReplay != 1 {
		t.Fatalf("allowance must not increment on replay, expected 1, got: %d", allowanceAfterReplay)
	}
}

func TestIntroductoryPeriod_30DayBoundary(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	discoRepo := NewMemoryRepository(identRepo)
	svc := NewService(discoRepo, identRepo, nil, nil)
	ctx := context.Background()

	now := time.Now().UTC()

	// User 1: Created 10 days ago -> comfortably within 30-day intro
	user1 := "user_intro_10d"
	discoRepo.SetUserCreatedAt(user1, now.Add(-10*24*time.Hour))
	detail1, err := svc.GetSwipeAllowanceDetail(ctx, user1)
	if err != nil {
		t.Fatalf("failed to get allowance for user1: %v", err)
	}
	if !detail1.IsUnlimited || !detail1.IsIntroductory {
		t.Fatalf("expected user created 10d ago to have unlimited intro period, got: %+v", detail1)
	}

	// User 2: Created 29 days, 23 hours ago -> still within 30-day intro
	user2 := "user_intro_29d23h"
	discoRepo.SetUserCreatedAt(user2, now.Add(-29*24*time.Hour-23*time.Hour))
	detail2, err := svc.GetSwipeAllowanceDetail(ctx, user2)
	if err != nil {
		t.Fatalf("failed to get allowance for user2: %v", err)
	}
	if !detail2.IsUnlimited || !detail2.IsIntroductory {
		t.Fatalf("expected user created 29d23h ago to be within intro, got: %+v", detail2)
	}

	// User 3: Created 30 days, 1 minute ago -> introductory expired
	user3 := "user_intro_expired"
	discoRepo.SetUserCreatedAt(user3, now.Add(-30*24*time.Hour-1*time.Minute))
	detail3, err := svc.GetSwipeAllowanceDetail(ctx, user3)
	if err != nil {
		t.Fatalf("failed to get allowance for user3: %v", err)
	}
	if detail3.IsUnlimited || detail3.IsIntroductory {
		t.Fatalf("expected user created 30d1m ago to be expired from intro, got: %+v", detail3)
	}
	if detail3.RemainingRegularLikes != 15 || detail3.DailyQuota != 15 {
		t.Fatalf("expected 15 regular likes in fixed 12h window, got: %+v", detail3)
	}

	// User 3 exhausts their 15 likes
	for i := 0; i < 15; i++ {
		_, err := svc.Swipe(ctx, user3, SwipeRequest{TargetUserID: fmt.Sprintf("target_u3_%d", i), Direction: "LIKE"}, "c")
		if err != nil {
			t.Fatalf("expected swipe %d to succeed, got %v", i+1, err)
		}
	}

	// 16th like must fail with ErrSwipeLimitReached
	_, err = svc.Swipe(ctx, user3, SwipeRequest{TargetUserID: "target_u3_16", Direction: "LIKE"}, "c")
	if err == nil || err != ErrSwipeLimitReached {
		t.Fatalf("expected ErrSwipeLimitReached after 15 likes, got %v", err)
	}
}

func TestPostIntro_Fixed12HourWindowReset(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	discoRepo := NewMemoryRepository(identRepo)
	svc := NewService(discoRepo, identRepo, nil, nil)
	ctx := context.Background()

	now := time.Now().UTC()
	user := "user_window_test"
	discoRepo.SetUserCreatedAt(user, now.Add(-45*24*time.Hour))

	// Swipes that occurred in the PREVIOUS 12h window should not count against current window
	prevWindowTime := now.Truncate(12 * time.Hour).Add(-2 * time.Hour)
	for i := 0; i < 15; i++ {
		_ = discoRepo.RecordSwipeWithTime(ctx, user, fmt.Sprintf("old_target_%d", i), "LIKE", prevWindowTime)
	}

	// In current 12h window, user should still have full 15 likes
	detail, err := svc.GetSwipeAllowanceDetail(ctx, user)
	if err != nil {
		t.Fatalf("failed to get allowance: %v", err)
	}
	if detail.RemainingRegularLikes != 15 {
		t.Fatalf("expected 15 likes remaining in current window despite 15 likes in previous window, got %d", detail.RemainingRegularLikes)
	}

	// Exhaust 15 likes in CURRENT window
	for i := 0; i < 15; i++ {
		_, err := svc.Swipe(ctx, user, SwipeRequest{TargetUserID: fmt.Sprintf("curr_target_%d", i), Direction: "LIKE"}, "c")
		if err != nil {
			t.Fatalf("expected swipe %d in current window to succeed, got %v", i+1, err)
		}
	}

	// 16th like in current window should fail
	_, err = svc.Swipe(ctx, user, SwipeRequest{TargetUserID: "curr_target_16", Direction: "LIKE"}, "c")
	if err != ErrSwipeLimitReached {
		t.Fatalf("expected ErrSwipeLimitReached on 16th swipe, got %v", err)
	}
}

func TestBonusLikes_VerifiedOnlyRestriction(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	discoRepo := NewMemoryRepository(identRepo)
	svc := NewService(discoRepo, identRepo, nil, nil, WithEnvironment("local"))
	ctx := context.Background()

	now := time.Now().UTC()
	user := "user_bonus_verified_test"
	discoRepo.SetUserCreatedAt(user, now.Add(-40*24*time.Hour))

	// Exhaust all 15 regular likes
	for i := 0; i < 15; i++ {
		_, _ = svc.Swipe(ctx, user, SwipeRequest{TargetUserID: fmt.Sprintf("reg_target_%d", i), Direction: "LIKE"}, "c")
	}

	detail, _ := svc.GetSwipeAllowanceDetail(ctx, user)
	if detail.RemainingRegularLikes != 0 || detail.RemainingLikes != 0 {
		t.Fatalf("expected 0 likes remaining, got: %+v", detail)
	}

	// Grant 5 bonus likes from rewarded ad
	err := discoRepo.RecordAdReward(ctx, user, "tx_bonus_5_verified", 5)
	if err != nil {
		t.Fatalf("failed to record ad reward: %v", err)
	}

	detailAfterReward, _ := svc.GetSwipeAllowanceDetail(ctx, user)
	if detailAfterReward.RemainingBonusLikes != 5 || detailAfterReward.RemainingLikes != 5 {
		t.Fatalf("expected 5 bonus likes, got: %+v", detailAfterReward)
	}

	// 1. Try to like an UNVERIFIED target (no profile or IsPhotoVerified = false) -> MUST FAIL with ErrBonusLikesVerifiedOnly
	unverifiedTarget := "unverified_target_user"
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{
		UserID:          unverifiedTarget,
		DisplayName:     "Unverified Alex",
		IsPhotoVerified: false,
	})

	_, err = svc.Swipe(ctx, user, SwipeRequest{TargetUserID: unverifiedTarget, Direction: "LIKE"}, "c")
	if err != ErrBonusLikesVerifiedOnly {
		t.Fatalf("expected ErrBonusLikesVerifiedOnly when liking unverified profile with bonus likes, got: %v", err)
	}

	// Quota must NOT have been deducted on rejected swipe
	detailAfterFail, _ := svc.GetSwipeAllowanceDetail(ctx, user)
	if detailAfterFail.RemainingBonusLikes != 5 {
		t.Fatalf("bonus likes should not decrement on failed swipe, got: %d", detailAfterFail.RemainingBonusLikes)
	}

	// 2. PASS swipe on unverified target -> MUST SUCCEED and NOT decrement bonus likes
	_, err = svc.Swipe(ctx, user, SwipeRequest{TargetUserID: unverifiedTarget, Direction: "PASS"}, "c")
	if err != nil {
		t.Fatalf("PASS swipe must succeed, got %v", err)
	}
	detailAfterPass, _ := svc.GetSwipeAllowanceDetail(ctx, user)
	if detailAfterPass.RemainingBonusLikes != 5 {
		t.Fatalf("PASS swipe must not consume bonus likes, got: %d", detailAfterPass.RemainingBonusLikes)
	}

	// 3. Like a PHOTO-VERIFIED target -> MUST SUCCEED
	verifiedTarget := "verified_target_user"
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{
		UserID:          verifiedTarget,
		DisplayName:     "Verified Jordan",
		IsPhotoVerified: true,
	})

	_, err = svc.Swipe(ctx, user, SwipeRequest{TargetUserID: verifiedTarget, Direction: "LIKE"}, "c")
	if err != nil {
		t.Fatalf("expected LIKE on photo-verified target to succeed with bonus like, got: %v", err)
	}

	// Bonus likes decremented to 4
	detailAfterSuccess, _ := svc.GetSwipeAllowanceDetail(ctx, user)
	if detailAfterSuccess.RemainingBonusLikes != 4 || detailAfterSuccess.RemainingLikes != 4 {
		t.Fatalf("expected 4 remaining bonus likes, got: %+v", detailAfterSuccess)
	}
}

func TestUnlockDiscoveryMessageAdBonus_VerificationEnforcement(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	discoRepo := NewMemoryRepository(identRepo)
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))

	ctx := context.Background()
	actorID := "user_msg_ad_verify"
	_ = identRepo.CreateUser(ctx, &identity.User{
		ID:        actorID,
		Email:     "msg_ad@test.local",
		Status:    identity.StatusActive,
		CreatedAt: time.Now().UTC(),
	})

	// Set user in trial state with 4 messages sent (eligible for ad unlock)
	for i := 1; i <= 4; i++ {
		_ = discoRepo.ConsumeDiscoveryMessageSlot(ctx, actorID, fmt.Sprintf("target_%d", i))
	}

	// 1. In production, client-supplied transaction_id without cryptographic SSV MUST FAIL
	prodSvc := NewService(discoRepo, identRepo, nil, logger, WithEnvironment("production"))
	_, err := prodSvc.UnlockDiscoveryMessageAdBonus(ctx, actorID, "", "test_client_tx_123")
	if err == nil || !strings.Contains(err.Error(), "cryptographic SSV callback is required in production") {
		t.Fatalf("expected rejection of client transaction ID in production, got: %v", err)
	}

	// 2. Empty rawQuery and empty transactionID MUST FAIL in all environments
	_, err = prodSvc.UnlockDiscoveryMessageAdBonus(ctx, actorID, "", "")
	if err == nil || !strings.Contains(err.Error(), "valid cryptographic SSV callback or test transaction is required") {
		t.Fatalf("expected rejection of empty verification parameters, got: %v", err)
	}

	// Also in dev verifier:
	devSvc := NewService(discoRepo, identRepo, nil, logger, WithEnvironment("development"))
	_, err = devSvc.UnlockDiscoveryMessageAdBonus(ctx, actorID, "", "")
	if err == nil || !strings.Contains(err.Error(), "valid cryptographic SSV callback or test transaction is required") {
		t.Fatalf("expected rejection of empty parameters in dev verifier, got: %v", err)
	}

	// 3. Genuine cryptographic ECDSA verification in production MUST SUCCEED
	priv, err := generateTestECDSAKey()
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	keyID := int64(999111)
	prodSvc.SSVVerifier().SetTestPublicKey(keyID, &priv.PublicKey)

	nowMs := time.Now().UTC().UnixMilli()
	baseQuery := fmt.Sprintf("ad_network=54321&ad_unit=ca-app-pub-prod/123&custom_data=discovery_message_quota_unlock&key_id=%d&reward_amount=2&reward_item=MESSAGING&timestamp=%d&transaction_id=tx_genuine_msg_unlock&user_id=%s", keyID, nowMs, actorID)
	sig, err := signQueryString(priv, baseQuery)
	if err != nil {
		t.Fatalf("failed to sign query: %v", err)
	}
	fullQuery := fmt.Sprintf("%s&signature=%s", baseQuery, url.QueryEscape(sig))

	quota, err := prodSvc.UnlockDiscoveryMessageAdBonus(ctx, actorID, fullQuery, "")
	if err != nil {
		t.Fatalf("expected genuine SSV to unlock messaging quota in production, got: %v", err)
	}
	if quota.TrialInitiationsAllowed != 8 {
		t.Fatalf("expected 8 trial initiations allowed after ad unlock, got: %d", quota.TrialInitiationsAllowed)
	}

	// 4. Replay of same transaction MUST FAIL with ErrDuplicateSSVReward
	_, err = prodSvc.UnlockDiscoveryMessageAdBonus(ctx, actorID, fullQuery, "")
	if err == nil || err != ErrDuplicateSSVReward {
		t.Fatalf("expected ErrDuplicateSSVReward on replay, got: %v", err)
	}
}

func TestUnlockLikesYouWithAd_VerificationEnforcement(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	discoRepo := NewMemoryRepository(identRepo)
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))

	ctx := context.Background()
	actorID := "user_likes_ad_verify"
	_ = identRepo.CreateUser(ctx, &identity.User{
		ID:        actorID,
		Email:     "likes_ad@test.local",
		Status:    identity.StatusActive,
		CreatedAt: time.Now().UTC(),
	})

	prodSvc := NewService(discoRepo, identRepo, nil, logger, WithEnvironment("production"))

	// 1. Client-supplied transaction_id in production MUST FAIL
	_, err := prodSvc.UnlockLikesYouWithAd(ctx, actorID, "", "test_tx_fake_999")
	if err == nil || !strings.Contains(err.Error(), "cryptographic SSV callback is required in production") {
		t.Fatalf("expected rejection of client-supplied transaction ID in production, got: %v", err)
	}

	// 2. Empty parameters MUST FAIL
	_, err = prodSvc.UnlockLikesYouWithAd(ctx, actorID, "", "")
	if err == nil || !strings.Contains(err.Error(), "valid cryptographic SSV callback or test transaction is required") {
		t.Fatalf("expected rejection of empty verification parameters, got: %v", err)
	}

	// 3. Genuine ECDSA verification in production MUST SUCCEED
	priv, err := generateTestECDSAKey()
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	keyID := int64(999222)
	prodSvc.SSVVerifier().SetTestPublicKey(keyID, &priv.PublicKey)

	nowMs := time.Now().UTC().UnixMilli()
	baseQuery := fmt.Sprintf("ad_network=54321&ad_unit=ca-app-pub-prod/123&custom_data=likes_you_unlock&key_id=%d&reward_amount=2&reward_item=LIKES_YOU&timestamp=%d&transaction_id=tx_genuine_likes_unlock&user_id=%s", keyID, nowMs, actorID)
	sig, err := signQueryString(priv, baseQuery)
	if err != nil {
		t.Fatalf("failed to sign query: %v", err)
	}
	fullQuery := fmt.Sprintf("%s&signature=%s", baseQuery, url.QueryEscape(sig))

	res, err := prodSvc.UnlockLikesYouWithAd(ctx, actorID, fullQuery, "")
	if err != nil {
		t.Fatalf("expected genuine SSV to unlock likes in production, got: %v", err)
	}
	if !res.Success {
		t.Fatalf("expected success true, got false")
	}

	// 4. Replay MUST FAIL
	_, err = prodSvc.UnlockLikesYouWithAd(ctx, actorID, fullQuery, "")
	if err == nil || err != ErrDuplicateSSVReward {
		t.Fatalf("expected ErrDuplicateSSVReward on replay, got: %v", err)
	}
}

// --- Comprehensive Behavioral SSV Tests ---

// 1. Valid SSV callback with genuine ECDSA signature grants exactly 5 bonus likes in production
func TestAdMobSSV_Behavioral_ValidCallback(t *testing.T) {
	ctx := context.Background()
	priv, err := generateTestECDSAKey()
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	keyID := int64(112233)

	repo := NewMemoryRepository(nil)
	svc := NewService(repo, nil, nil, nil, WithEnvironment("production"))
	svc.SSVVerifier().SetTestPublicKey(keyID, &priv.PublicKey)

	userID := "usr_valid_ssv_101"
	nowMs := time.Now().UTC().UnixMilli()
	baseQuery := fmt.Sprintf("ad_network=54321&ad_unit=ca-app-pub-prod/555&custom_data=swipe_cadence_reward&key_id=%d&reward_amount=1&reward_item=BONUS_LIKE&timestamp=%d&transaction_id=tx_valid_ssv_101&user_id=%s", keyID, nowMs, userID)
	sig, err := signQueryString(priv, baseQuery)
	if err != nil {
		t.Fatalf("failed to sign query: %v", err)
	}
	fullQuery := fmt.Sprintf("%s&signature=%s", baseQuery, url.QueryEscape(sig))

	// Claim with valid cryptographic query
	detail, err := svc.ClaimSwipeAdReward(ctx, userID, fullQuery, "")
	if err != nil {
		t.Fatalf("expected valid SSV claim to succeed, got: %v", err)
	}
	if detail.RemainingBonusLikes != 5 {
		t.Fatalf("expected exactly 5 bonus likes per Aura policy, got: %d", detail.RemainingBonusLikes)
	}
}

// 2. Invalid signatures (tampered or forged) are strictly rejected
func TestAdMobSSV_Behavioral_InvalidSignature(t *testing.T) {
	ctx := context.Background()
	priv, err := generateTestECDSAKey()
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	keyID := int64(445566)

	repo := NewMemoryRepository(nil)
	svc := NewService(repo, nil, nil, nil, WithEnvironment("production"))
	svc.SSVVerifier().SetTestPublicKey(keyID, &priv.PublicKey)

	userID := "usr_invalid_sig_102"
	nowMs := time.Now().UTC().UnixMilli()
	baseQuery := fmt.Sprintf("ad_network=54321&ad_unit=ca-app-pub-prod/555&custom_data=swipe_cadence_reward&key_id=%d&reward_amount=5&reward_item=BONUS_LIKE&timestamp=%d&transaction_id=tx_forged_102&user_id=%s", keyID, nowMs, userID)
	forgedQuery := fmt.Sprintf("%s&signature=%s", baseQuery, url.QueryEscape("bogus_forged_sig"))

	_, err = svc.ClaimSwipeAdReward(ctx, userID, forgedQuery, "")
	if err == nil || !errors.Is(err, ErrInvalidSSVSignature) {
		t.Fatalf("expected ErrInvalidSSVSignature, got: %v", err)
	}
}

// 3. Expired callbacks (> 15 min old) are rejected
func TestAdMobSSV_Behavioral_ExpiredCallback(t *testing.T) {
	ctx := context.Background()
	priv, err := generateTestECDSAKey()
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	keyID := int64(778899)

	repo := NewMemoryRepository(nil)
	svc := NewService(repo, nil, nil, nil, WithEnvironment("production"))
	svc.SSVVerifier().SetTestPublicKey(keyID, &priv.PublicKey)

	userID := "usr_expired_103"
	oldMs := time.Now().UTC().Add(-20 * time.Minute).UnixMilli()
	baseQuery := fmt.Sprintf("ad_network=54321&ad_unit=ca-app-pub-prod/555&custom_data=swipe_cadence_reward&key_id=%d&reward_amount=5&reward_item=BONUS_LIKE&timestamp=%d&transaction_id=tx_expired_103&user_id=%s", keyID, oldMs, userID)
	sig, _ := signQueryString(priv, baseQuery)
	fullQuery := fmt.Sprintf("%s&signature=%s", baseQuery, url.QueryEscape(sig))

	_, err = svc.ClaimSwipeAdReward(ctx, userID, fullQuery, "")
	if err == nil || !errors.Is(err, ErrExpiredSSVCallback) {
		t.Fatalf("expected ErrExpiredSSVCallback, got: %v", err)
	}
}

// 4. Duplicate transaction IDs are idempotent and preserve replay protection
func TestAdMobSSV_Behavioral_DuplicateTransactionID(t *testing.T) {
	ctx := context.Background()
	priv, err := generateTestECDSAKey()
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	keyID := int64(123789)

	repo := NewMemoryRepository(nil)
	svc := NewService(repo, nil, nil, nil, WithEnvironment("production"))
	svc.SSVVerifier().SetTestPublicKey(keyID, &priv.PublicKey)

	userID := "usr_dup_104"
	nowMs := time.Now().UTC().UnixMilli()
	baseQuery := fmt.Sprintf("ad_network=54321&ad_unit=ca-app-pub-prod/555&custom_data=swipe_cadence_reward&key_id=%d&reward_amount=5&reward_item=BONUS_LIKE&timestamp=%d&transaction_id=tx_dup_104&user_id=%s", keyID, nowMs, userID)
	sig, _ := signQueryString(priv, baseQuery)
	fullQuery := fmt.Sprintf("%s&signature=%s", baseQuery, url.QueryEscape(sig))

	// Direct Google SSV callback arrives first
	reward, err := svc.VerifyAndGrantAdReward(ctx, fullQuery)
	if err != nil {
		t.Fatalf("initial SSV callback failed: %v", err)
	}
	if reward.RewardAmount != 5 {
		t.Fatalf("expected 5 bonus likes, got: %d", reward.RewardAmount)
	}

	// Replay attempt to VerifyAndGrantAdReward returns ErrDuplicateSSVReward
	_, err = svc.VerifyAndGrantAdReward(ctx, fullQuery)
	if err == nil || !errors.Is(err, ErrDuplicateSSVReward) {
		t.Fatalf("expected ErrDuplicateSSVReward on direct replay, got: %v", err)
	}

	// Client claim with same transaction ID succeeds idempotently without double-crediting
	detail, err := svc.ClaimSwipeAdReward(ctx, userID, fullQuery, "")
	if err != nil {
		t.Fatalf("expected idempotent claim to succeed, got: %v", err)
	}
	if detail.RemainingBonusLikes != 5 {
		t.Fatalf("replay must not double credit bonus likes, expected 5, got: %d", detail.RemainingBonusLikes)
	}
}

// 5. User mismatch between callback and authenticated user is rejected
func TestAdMobSSV_Behavioral_UserMismatch(t *testing.T) {
	ctx := context.Background()
	priv, err := generateTestECDSAKey()
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	keyID := int64(987654)

	repo := NewMemoryRepository(nil)
	svc := NewService(repo, nil, nil, nil, WithEnvironment("production"))
	svc.SSVVerifier().SetTestPublicKey(keyID, &priv.PublicKey)

	ssvUserID := "usr_victim_105"
	attackerUserID := "usr_attacker_999"

	nowMs := time.Now().UTC().UnixMilli()
	baseQuery := fmt.Sprintf("ad_network=54321&ad_unit=ca-app-pub-prod/555&custom_data=swipe_cadence_reward&key_id=%d&reward_amount=5&reward_item=BONUS_LIKE&timestamp=%d&transaction_id=tx_mismatch_105&user_id=%s", keyID, nowMs, ssvUserID)
	sig, _ := signQueryString(priv, baseQuery)
	fullQuery := fmt.Sprintf("%s&signature=%s", baseQuery, url.QueryEscape(sig))

	// Attacker tries to claim callback issued for ssvUserID
	_, err = svc.ClaimSwipeAdReward(ctx, attackerUserID, fullQuery, "")
	if err == nil || !strings.Contains(err.Error(), "user/placement mismatch") {
		t.Fatalf("expected user mismatch error, got: %v", err)
	}
}

// 6. Delayed callbacks return ErrPendingSSVReward until Google callback arrives
func TestAdMobSSV_Behavioral_DelayedCallback(t *testing.T) {
	ctx := context.Background()
	priv, err := generateTestECDSAKey()
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	keyID := int64(556677)

	repo := NewMemoryRepository(nil)
	svc := NewService(repo, nil, nil, nil, WithEnvironment("production"))
	svc.SSVVerifier().SetTestPublicKey(keyID, &priv.PublicKey)

	userID := "usr_delayed_106"
	txID := "tx_delayed_106"

	// 1. Client calls claim before Google's SSV arrives -> ErrPendingSSVReward
	_, err = svc.ClaimSwipeAdReward(ctx, userID, "", txID)
	if err == nil || !errors.Is(err, ErrPendingSSVReward) {
		t.Fatalf("expected ErrPendingSSVReward when callback has not arrived, got: %v", err)
	}

	// 2. Google SSV callback arrives in the background
	nowMs := time.Now().UTC().UnixMilli()
	baseQuery := fmt.Sprintf("ad_network=54321&ad_unit=ca-app-pub-prod/555&custom_data=swipe_cadence_reward&key_id=%d&reward_amount=5&reward_item=BONUS_LIKE&timestamp=%d&transaction_id=%s&user_id=%s", keyID, nowMs, txID, userID)
	sig, _ := signQueryString(priv, baseQuery)
	fullQuery := fmt.Sprintf("%s&signature=%s", baseQuery, url.QueryEscape(sig))

	_, err = svc.VerifyAndGrantAdReward(ctx, fullQuery)
	if err != nil {
		t.Fatalf("Google SSV callback failed: %v", err)
	}

	// 3. Client retries claim -> succeeds now that SSV was confirmed
	detail, err := svc.ClaimSwipeAdReward(ctx, userID, "", txID)
	if err != nil {
		t.Fatalf("expected claim to succeed after SSV callback arrived, got: %v", err)
	}
	if detail.RemainingBonusLikes != 5 {
		t.Fatalf("expected 5 bonus likes, got: %d", detail.RemainingBonusLikes)
	}
}

// 7. Synthetic test-admob-* IDs are rejected in production
func TestAdMobSSV_Behavioral_ProductionRejectsSyntheticTestID(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository(nil)
	svc := NewService(repo, nil, nil, nil, WithEnvironment("production"))

	userID := "usr_prod_fake_107"
	fakeTxID := "test-admob-1729661234-abc1234"

	_, err := svc.ClaimSwipeAdReward(ctx, userID, "", fakeTxID)
	if err == nil || !strings.Contains(err.Error(), "client-generated test transaction IDs are rejected in production") {
		t.Fatalf("expected rejection of synthetic test-admob-* ID in production, got: %v", err)
	}
}

// 8. Controlled development environment accepts test transactions
func TestAdMobSSV_Behavioral_ControlledDevMode(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository(nil)
	svc := NewService(repo, nil, nil, nil, WithEnvironment("development"))

	userID := "usr_dev_108"
	devTxID := "test-admob-dev-local-108"

	detail, err := svc.ClaimSwipeAdReward(ctx, userID, "", devTxID)
	if err != nil {
		t.Fatalf("expected development mode to accept test transaction, got: %v", err)
	}
	if detail.RemainingBonusLikes != 5 {
		t.Fatalf("expected 5 bonus likes in dev mode, got: %d", detail.RemainingBonusLikes)
	}
}
type failingAdRepo struct {
	*MemoryRepository
}

func (f *failingAdRepo) RecordAdReward(ctx context.Context, userID string, transactionID string, rewardAmount int) error {
	return errors.New("database connection pool exhausted")
}

// 9. Database failure fails closed without granting unverified rewards
func TestAdMobSSV_Behavioral_DatabaseFailure(t *testing.T) {
	ctx := context.Background()
	priv, err := generateTestECDSAKey()
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	keyID := int64(999111)

	baseRepo := NewMemoryRepository(nil)
	failingRepo := &failingAdRepo{MemoryRepository: baseRepo}
	svc := NewService(failingRepo, nil, nil, nil, WithEnvironment("production"))
	svc.SSVVerifier().SetTestPublicKey(keyID, &priv.PublicKey)

	userID := "usr_db_fail_109"
	nowMs := time.Now().UTC().UnixMilli()
	baseQuery := fmt.Sprintf("ad_network=54321&ad_unit=ca-app-pub-prod/555&custom_data=swipe_cadence_reward&key_id=%d&reward_amount=5&reward_item=BONUS_LIKE&timestamp=%d&transaction_id=tx_db_fail_109&user_id=%s", keyID, nowMs, userID)
	sig, _ := signQueryString(priv, baseQuery)
	fullQuery := fmt.Sprintf("%s&signature=%s", baseQuery, url.QueryEscape(sig))

	// When database fails, reward must NOT be granted and error must be returned
	_, err = svc.ClaimSwipeAdReward(ctx, userID, fullQuery, "")
	if err == nil || !strings.Contains(err.Error(), "database connection pool exhausted") {
		t.Fatalf("expected database error, got: %v", err)
	}
}

