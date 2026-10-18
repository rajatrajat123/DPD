package discovery

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/identity"
)

func TestDiscoveryMessagingQuota_30DayTrialLifecycle(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	repo := NewMemoryRepository(identRepo)

	ctx := context.Background()
	userA := "user-alice"
	userB := "user-bob"
	userC := "user-charlie"
	userD := "user-david"
	userE := "user-eve"
	userF := "user-frank"

	// 1. Initial 30-day trial quota check: 4 distinct profile initiations
	quota, err := repo.GetDiscoveryMessageQuota(ctx, userA)
	if err != nil {
		t.Fatalf("failed to get quota: %v", err)
	}
	if !quota.IsInTrial || quota.TrialDaysRemaining <= 0 || quota.TrialDaysRemaining > 30 {
		t.Fatalf("expected active trial with ~30 days remaining, got: %+v", quota)
	}
	if quota.TrialInitiationsRemaining != 4 || quota.TrialInitiationsAllowed != 4 || quota.TrialDistinctMessaged != 0 {
		t.Fatalf("unexpected trial batch limits: %+v", quota)
	}
	if quota.IsLocked || quota.CanUnlockWithAd {
		t.Fatalf("fresh trial user must not be locked: %+v", quota)
	}

	// 2. Chat in existing conversations during trial is 100% UNLIMITED
	for i := 0; i < 10; i++ {
		if err := repo.ConsumeChatOutgoingSlot(ctx, userA); err != nil {
			t.Fatalf("chat message %d during trial should be unlimited, got error: %v", i+1, err)
		}
	}
	// Verify chat did not consume discovery initiations
	qAfterChat, _ := repo.GetDiscoveryMessageQuota(ctx, userA)
	if qAfterChat.TrialInitiationsRemaining != 4 || qAfterChat.TrialDistinctMessaged != 0 {
		t.Fatalf("chat message consumed discovery initiation slots: %+v", qAfterChat)
	}

	// 3. Message 1 to userB (consumes 1 distinct initiation slot)
	if err := repo.ConsumeDiscoveryMessageSlot(ctx, userA, userB); err != nil {
		t.Fatalf("unexpected error on 1st message: %v", err)
	}
	q1, err := repo.GetDiscoveryMessageQuota(ctx, userA)
	if err != nil {
		t.Fatalf("failed to get quota: %v", err)
	}
	if q1.TrialInitiationsRemaining != 3 || q1.TrialDistinctMessaged != 1 || q1.IsLocked {
		t.Fatalf("expected 3 remaining trial initiations, got %+v", q1)
	}

	// 4. Repeated message to userB BEFORE recipient replies: MUST be rejected with ErrDiscoveryMessageAwaitingReply
	if err := repo.ConsumeDiscoveryMessageSlot(ctx, userA, userB); err != ErrDiscoveryMessageAwaitingReply {
		t.Fatalf("repeated message before recipient replies should return ErrDiscoveryMessageAwaitingReply, got: %v", err)
	}
	q1Repeat, _ := repo.GetDiscoveryMessageQuota(ctx, userA)
	if q1Repeat.TrialInitiationsRemaining != 3 || q1Repeat.TrialDistinctMessaged != 1 {
		t.Fatalf("rejected repeat attempt consumed an extra slot! %+v", q1Repeat)
	}

	// Recipient userB replies! Mark conversation established
	if err := repo.RecordRecipientReply(ctx, userA, userB); err != nil {
		t.Fatalf("failed to record recipient reply: %v", err)
	}

	// Repeated message AFTER recipient replied: MUST succeed without consuming an extra slot
	if err := repo.ConsumeDiscoveryMessageSlot(ctx, userA, userB); err != nil {
		t.Fatalf("repeated message after reply should succeed: %v", err)
	}
	q1AfterReply, _ := repo.GetDiscoveryMessageQuota(ctx, userA)
	if q1AfterReply.TrialInitiationsRemaining != 3 || q1AfterReply.TrialDistinctMessaged != 1 {
		t.Fatalf("message after reply consumed an extra slot! %+v", q1AfterReply)
	}

	// 5. Messages 2, 3, 4 to distinct profiles (userC, userD, userE)
	if err := repo.ConsumeDiscoveryMessageSlot(ctx, userA, userC); err != nil {
		t.Fatalf("failed on 2nd distinct message: %v", err)
	}
	if err := repo.ConsumeDiscoveryMessageSlot(ctx, userA, userD); err != nil {
		t.Fatalf("failed on 3rd distinct message: %v", err)
	}
	if err := repo.ConsumeDiscoveryMessageSlot(ctx, userA, userE); err != nil {
		t.Fatalf("failed on 4th distinct message: %v", err)
	}

	// 6. After 4 distinct profiles, trial discovery quota locks and ad unlock is offered
	q4, _ := repo.GetDiscoveryMessageQuota(ctx, userA)
	if q4.TrialInitiationsRemaining != 0 || q4.TrialDistinctMessaged != 4 {
		t.Fatalf("expected 0 remaining initiations and 4 distinct, got %+v", q4)
	}
	if !q4.IsLocked || !q4.CanUnlockWithAd {
		t.Fatalf("expected locked state with ad unlock available, got %+v", q4)
	}

	// 7. Attempt 5th message to new profile userF (must fail with ErrDiscoveryMessageQuotaLocked)
	err = repo.ConsumeDiscoveryMessageSlot(ctx, userA, userF)
	if err != ErrDiscoveryMessageQuotaLocked {
		t.Fatalf("expected ErrDiscoveryMessageQuotaLocked for 5th profile, got %v", err)
	}

	// UserC has replied -> message to existing contact during locked state is allowed
	if err := repo.RecordRecipientReply(ctx, userA, userC); err != nil {
		t.Fatalf("failed to record reply for userC: %v", err)
	}
	if err := repo.ConsumeDiscoveryMessageSlot(ctx, userA, userC); err != nil {
		t.Fatalf("message to existing contact after reply during locked state should be allowed: %v", err)
	}

	// Chat in existing conversations remains unlimited even when Discovery initiations are locked!
	if err := repo.ConsumeChatOutgoingSlot(ctx, userA); err != nil {
		t.Fatalf("chat messages during trial must remain unlimited even when discovery is locked: %v", err)
	}

	// 8. Watch rewarded ad #1 to unlock the NEXT 4 profiles (allowed becomes 8)
	qUnlocked1, err := repo.UnlockDiscoveryMessageAdBonus(ctx, userA)
	if err != nil {
		t.Fatalf("failed to unlock ad bonus 1 in trial: %v", err)
	}
	if qUnlocked1.IsLocked || qUnlocked1.TrialInitiationsAllowed != 8 || qUnlocked1.TrialInitiationsRemaining != 4 {
		t.Fatalf("expected 8 allowed and 4 remaining after ad 1: %+v", qUnlocked1)
	}

	// Initiation to userF now succeeds (profile #5)
	if err := repo.ConsumeDiscoveryMessageSlot(ctx, userA, userF); err != nil {
		t.Fatalf("failed to message userF after ad unlock: %v", err)
	}

	// Send to profiles 6, 7, 8
	for i := 6; i <= 8; i++ {
		target := fmt.Sprintf("user-profile-%d", i)
		if err := repo.ConsumeDiscoveryMessageSlot(ctx, userA, target); err != nil {
			t.Fatalf("failed to message %s: %v", target, err)
		}
	}
	qBatch1, _ := repo.GetDiscoveryMessageQuota(ctx, userA)
	if qBatch1.TrialDistinctMessaged != 8 || !qBatch1.IsLocked || !qBatch1.CanUnlockWithAd {
		t.Fatalf("expected batch 1 locked at 8 profiles, got %+v", qBatch1)
	}

	// Watch rewarded ad #2 (allowed becomes 12)
	qUnlocked2, err := repo.UnlockDiscoveryMessageAdBonus(ctx, userA)
	if err != nil {
		t.Fatalf("failed to unlock ad bonus 2: %v", err)
	}
	if qUnlocked2.TrialInitiationsAllowed != 12 || qUnlocked2.TrialInitiationsRemaining != 4 {
		t.Fatalf("expected 12 allowed after ad 2, got %+v", qUnlocked2)
	}

	// Send to profiles 9, 10, 11, 12
	for i := 9; i <= 12; i++ {
		target := fmt.Sprintf("user-profile-%d", i)
		if err := repo.ConsumeDiscoveryMessageSlot(ctx, userA, target); err != nil {
			t.Fatalf("failed to message %s: %v", target, err)
		}
	}

	// Watch rewarded ad #3 (allowed becomes 16)
	qUnlocked3, err := repo.UnlockDiscoveryMessageAdBonus(ctx, userA)
	if err != nil {
		t.Fatalf("failed to unlock ad bonus 3: %v", err)
	}
	if qUnlocked3.TrialInitiationsAllowed != 16 || qUnlocked3.TrialInitiationsRemaining != 4 {
		t.Fatalf("expected 16 allowed after ad 3, got %+v", qUnlocked3)
	}

	// Send to profiles 13, 14, 15, 16
	for i := 13; i <= 16; i++ {
		target := fmt.Sprintf("user-profile-%d", i)
		if err := repo.ConsumeDiscoveryMessageSlot(ctx, userA, target); err != nil {
			t.Fatalf("failed to message %s: %v", target, err)
		}
	}

	// Watch rewarded ad #4 (allowed becomes 20, max ads for cycle reached)
	qUnlocked4, err := repo.UnlockDiscoveryMessageAdBonus(ctx, userA)
	if err != nil {
		t.Fatalf("failed to unlock ad bonus 4: %v", err)
	}
	if qUnlocked4.TrialInitiationsAllowed != 20 || qUnlocked4.TrialInitiationsRemaining != 4 {
		t.Fatalf("expected 20 allowed after ad 4, got %+v", qUnlocked4)
	}

	// Send to profiles 17, 18, 19, 20
	for i := 17; i <= 20; i++ {
		target := fmt.Sprintf("user-profile-%d", i)
		if err := repo.ConsumeDiscoveryMessageSlot(ctx, userA, target); err != nil {
			t.Fatalf("failed to message %s: %v", target, err)
		}
	}

	// 9. Now 20 distinct profiles reached: must lock for exactly 3 hours!
	q20, err := repo.GetDiscoveryMessageQuota(ctx, userA)
	if err != nil {
		t.Fatalf("failed to get quota after 20 profiles: %v", err)
	}
	if !q20.IsLocked {
		t.Fatalf("expected locked state after 20 profiles: %+v", q20)
	}
	if !q20.CooldownActive || q20.CooldownExpiresAt == nil {
		t.Fatalf("expected active 3-hour cooldown after 20 profiles: %+v", q20)
	}
	if q20.CanUnlockWithAd {
		t.Fatalf("no further ad unlocks allowed during 3-hour cooldown: %+v", q20)
	}
	if q20.CooldownSecondsRemaining <= 0 || q20.CooldownSecondsRemaining > 10800 {
		t.Fatalf("expected ~10800 seconds cooldown, got %d", q20.CooldownSecondsRemaining)
	}

	// 10. Attempting 21st profile must fail with ErrDiscoveryMessageUsageLimitReached
	err = repo.ConsumeDiscoveryMessageSlot(ctx, userA, "user-profile-21")
	if err != ErrDiscoveryMessageUsageLimitReached {
		t.Fatalf("expected ErrDiscoveryMessageUsageLimitReached on 21st profile, got %v", err)
	}

	// 11. Attempting 5th ad unlock must be rejected
	_, err = repo.UnlockDiscoveryMessageAdBonus(ctx, userA)
	if err != ErrDiscoveryMessageUsageLimitReached && err != ErrDiscoveryMessageMaxAdsReached {
		t.Fatalf("expected ad unlock to be rejected during 3-hour cooldown, got %v", err)
	}

	// 12. Chat in existing conversations remains unlimited even during 3-hour cooldown
	for i := 0; i < 5; i++ {
		if err := repo.ConsumeChatOutgoingSlot(ctx, userA); err != nil {
			t.Fatalf("chat messages during 3-hour cooldown must remain unlimited: %v", err)
		}
	}

	// 13. Simulate 3-hour cooldown expiring -> cycle resets
	repo.mu.Lock()
	expiredAt := time.Now().UTC().Add(-1 * time.Minute)
	repo.messagingQuotas[userA].CooldownExpiresAt = &expiredAt
	repo.mu.Unlock()

	qReset, err := repo.GetDiscoveryMessageQuota(ctx, userA)
	if err != nil {
		t.Fatalf("failed to get quota after cooldown expiry: %v", err)
	}
	if qReset.IsLocked || qReset.CooldownActive || qReset.CooldownExpiresAt != nil {
		t.Fatalf("cycle should be fully unlocked after cooldown expiry: %+v", qReset)
	}
	if qReset.TrialDistinctMessaged != 0 || qReset.TrialInitiationsAllowed != 4 || qReset.TrialInitiationsRemaining != 4 {
		t.Fatalf("cycle should reset to 4 allowed and 0 distinct, got %+v", qReset)
	}

	// 14. First message of new cycle succeeds immediately
	if err := repo.ConsumeDiscoveryMessageSlot(ctx, userA, "user-cycle2-profile-1"); err != nil {
		t.Fatalf("failed to send message in fresh cycle after cooldown: %v", err)
	}
	qNewCycle, _ := repo.GetDiscoveryMessageQuota(ctx, userA)
	if qNewCycle.TrialDistinctMessaged != 1 || qNewCycle.TrialInitiationsRemaining != 3 {
		t.Fatalf("unexpected quota in new cycle: %+v", qNewCycle)
	}
}

func TestDiscoveryMessagingQuota_PostTrialTransitionAndGlobalQuota(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	repo := NewMemoryRepository(identRepo)

	ctx := context.Background()
	userX := "user-post-trial"

	// Simulate user created 31 days ago (trial expired)
	userCreatedAt := time.Now().UTC().Add(-31 * 24 * time.Hour)
	repo.SetUserCreatedAt(userX, userCreatedAt)

	quota, err := repo.GetDiscoveryMessageQuota(ctx, userX)
	if err != nil {
		t.Fatalf("failed to get quota: %v", err)
	}
	if quota.IsInTrial {
		t.Fatalf("user created 31 days ago must not be in trial: %+v", quota)
	}
	if quota.PostTrialFreeRemaining != 2 || quota.IsLocked {
		t.Fatalf("expected post-trial allowance of 2 outgoing messages, got %+v", quota)
	}

	// 1. Send 1 chat message (consumes 1 of the 2 global outgoing slots)
	if err := repo.ConsumeChatOutgoingSlot(ctx, userX); err != nil {
		t.Fatalf("failed to consume chat outgoing slot: %v", err)
	}
	q1, _ := repo.GetDiscoveryMessageQuota(ctx, userX)
	if q1.PostTrialFreeRemaining != 1 || q1.IsLocked {
		t.Fatalf("expected 1 remaining post-trial slot, got %+v", q1)
	}

	// 2. Send 1 discovery message (consumes the 2nd global outgoing slot)
	if err := repo.ConsumeDiscoveryMessageSlot(ctx, userX, "user-target-1"); err != nil {
		t.Fatalf("failed to consume discovery slot: %v", err)
	}
	q2, _ := repo.GetDiscoveryMessageQuota(ctx, userX)
	if q2.PostTrialFreeRemaining != 0 || !q2.IsLocked || !q2.CanUnlockWithAd {
		t.Fatalf("expected post-trial locked with ad unlock available, got %+v", q2)
	}

	// 3. Attempt 3rd message across chat or discovery (must fail)
	if err := repo.ConsumeChatOutgoingSlot(ctx, userX); err != ErrDiscoveryMessageQuotaLocked {
		t.Fatalf("expected chat to be locked post-trial after 2 messages, got %v", err)
	}
	if err := repo.ConsumeDiscoveryMessageSlot(ctx, userX, "user-target-2"); err != ErrDiscoveryMessageQuotaLocked {
		t.Fatalf("expected discovery to be locked post-trial after 2 messages, got %v", err)
	}

	// 4. Watch rewarded ad to unlock 2 additional outgoing messages
	qUnlocked, err := repo.UnlockDiscoveryMessageAdBonus(ctx, userX)
	if err != nil {
		t.Fatalf("failed to unlock ad bonus post-trial: %v", err)
	}
	if !qUnlocked.AdUnlocked || qUnlocked.PostTrialBonusRemaining != 2 || qUnlocked.IsLocked {
		t.Fatalf("expected 2 post-trial bonus messages unlocked, got %+v", qUnlocked)
	}

	// 5. Consume 2 bonus messages
	if err := repo.ConsumeChatOutgoingSlot(ctx, userX); err != nil {
		t.Fatalf("failed on 1st bonus message: %v", err)
	}
	if err := repo.ConsumeDiscoveryMessageSlot(ctx, userX, "user-target-3"); err != nil {
		t.Fatalf("failed on 2nd bonus message: %v", err)
	}

	// Now locked again
	qExhausted, _ := repo.GetDiscoveryMessageQuota(ctx, userX)
	if !qExhausted.IsLocked || qExhausted.PostTrialBonusRemaining != 0 {
		t.Fatalf("expected locked after bonus consumed, got %+v", qExhausted)
	}
}

func TestDiscoveryMessagingQuota_UnlimitedEntitlementImmunity(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	repo := NewMemoryRepository(identRepo)
	ctx := context.Background()
	userVIP := "user-vip"

	// Simulate expired trial but active premium subscription
	repo.SetUserCreatedAt(userVIP, time.Now().UTC().Add(-60*24*time.Hour))
	repo.GrantTestEntitlement(userVIP, "UNLIMITED_SWIPES", time.Now().UTC().Add(30*24*time.Hour))

	quota, err := repo.GetDiscoveryMessageQuota(ctx, userVIP)
	if err != nil {
		t.Fatalf("failed to get quota: %v", err)
	}
	if !quota.IsUnlimited || quota.IsLocked {
		t.Fatalf("expected VIP to have unlimited messaging: %+v", quota)
	}

	// VIP sends many chat and discovery messages without restrictions
	for i := 0; i < 20; i++ {
		target := "cand-" + string(rune('a'+i))
		if err := repo.ConsumeDiscoveryMessageSlot(ctx, userVIP, target); err != nil {
			t.Fatalf("VIP failed to consume discovery slot %d: %v", i, err)
		}
		if err := repo.ConsumeChatOutgoingSlot(ctx, userVIP); err != nil {
			t.Fatalf("VIP failed to consume chat slot %d: %v", i, err)
		}
	}
}

func TestDiscoveryMessagingQuota_HTTPHandler(t *testing.T) {
	identRepo := identity.NewMemoryRepository()
	repo := NewMemoryRepository(identRepo)
	svc := NewService(repo, identRepo, nil, nil, WithEnvironment("development"))
	handler := NewHandler(svc)

	jwtSecret := "test-secret-key-that-is-at-least-32-bytes-long"
	authMw := identity.RequireAuth(jwtSecret)

	actor := &identity.User{
		ID:    "http-actor",
		Email: "actor@aura.dating",
		Role:  identity.RoleMember,
	}
	token, _ := identity.GenerateAccessToken(jwtSecret, actor, time.Hour)

	mux := http.NewServeMux()
	mux.Handle("/api/v1/discovery/messaging-quota", authMw(http.HandlerFunc(handler.MessagingQuota)))
	mux.Handle("/api/v1/discovery/messaging-quota/unlock-ad", authMw(http.HandlerFunc(handler.UnlockMessagingQuotaAd)))
	mux.Handle("/api/v1/discovery/message-requests", authMw(http.HandlerFunc(handler.MessageRequests)))

	// 1. GET initial quota -> 200 OK with trial_initiations_remaining = 4
	req1 := httptest.NewRequest(http.MethodGet, "/api/v1/discovery/messaging-quota", nil)
	req1.Header.Set("Authorization", "Bearer "+token)
	rec1 := httptest.NewRecorder()
	mux.ServeHTTP(rec1, req1)

	if rec1.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec1.Code, rec1.Body.String())
	}
	var qResp DiscoveryMessagingQuota
	if err := json.Unmarshal(rec1.Body.Bytes(), &qResp); err != nil {
		t.Fatalf("failed to decode json: %v", err)
	}
	if !qResp.IsInTrial || qResp.TrialInitiationsRemaining != 4 || qResp.IsLocked {
		t.Fatalf("unexpected quota response: %+v", qResp)
	}

	// 2. Send messages to 4 distinct profiles -> all 201 Created
	for i := 1; i <= 4; i++ {
		payload := map[string]string{
			"recipient_user_id": "recipient-" + string(rune('0'+i)),
			"body":              "Hello!",
		}
		bodyBytes, _ := json.Marshal(payload)
		postReq := httptest.NewRequest(http.MethodPost, "/api/v1/discovery/message-requests", bytes.NewReader(bodyBytes))
		postReq.Header.Set("Content-Type", "application/json")
		postReq.Header.Set("Authorization", "Bearer "+token)
		postRec := httptest.NewRecorder()
		mux.ServeHTTP(postRec, postReq)
		if postRec.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created for message %d, got %d: %s", i, postRec.Code, postRec.Body.String())
		}
	}

	// 2b. Repeated message to recipient-1 before reply -> 403 Forbidden with code AWAITING_REPLY
	repeatPayload := map[string]string{
		"recipient_user_id": "recipient-1",
		"body":              "Second message before reply",
	}
	repeatBytes, _ := json.Marshal(repeatPayload)
	repeatReq := httptest.NewRequest(http.MethodPost, "/api/v1/discovery/message-requests", bytes.NewReader(repeatBytes))
	repeatReq.Header.Set("Content-Type", "application/json")
	repeatReq.Header.Set("Authorization", "Bearer "+token)
	repeatRec := httptest.NewRecorder()
	mux.ServeHTTP(repeatRec, repeatReq)
	if repeatRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for repeated message before reply, got %d: %s", repeatRec.Code, repeatRec.Body.String())
	}

	// 3. 5th distinct message -> 429 Too Many Requests (locked)
	payload5 := `{"recipient_user_id":"recipient-5","body":"Should lock!"}`
	postReq5 := httptest.NewRequest(http.MethodPost, "/api/v1/discovery/message-requests", bytes.NewReader([]byte(payload5)))
	postReq5.Header.Set("Content-Type", "application/json")
	postReq5.Header.Set("Authorization", "Bearer "+token)
	postRec5 := httptest.NewRecorder()
	mux.ServeHTTP(postRec5, postReq5)
	if postRec5.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 Too Many Requests, got %d: %s", postRec5.Code, postRec5.Body.String())
	}

	// 4. Unlock with ad -> 200 OK with trial_initiations_allowed = 8, trial_initiations_remaining = 4
	unlockPayload := `{"transaction_id":"tx-test-12345"}`
	unlockReq := httptest.NewRequest(http.MethodPost, "/api/v1/discovery/messaging-quota/unlock-ad", bytes.NewReader([]byte(unlockPayload)))
	unlockReq.Header.Set("Content-Type", "application/json")
	unlockReq.Header.Set("Authorization", "Bearer "+token)
	unlockRec := httptest.NewRecorder()
	mux.ServeHTTP(unlockRec, unlockReq)
	if unlockRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", unlockRec.Code, unlockRec.Body.String())
	}
	var qUnlocked DiscoveryMessagingQuota
	if err := json.Unmarshal(unlockRec.Body.Bytes(), &qUnlocked); err != nil {
		t.Fatalf("failed to decode json: %v", err)
	}
	if qUnlocked.TrialInitiationsAllowed != 8 || qUnlocked.TrialInitiationsRemaining != 4 || qUnlocked.IsLocked {
		t.Fatalf("expected 4 remaining slots after ad unlock: %+v", qUnlocked)
	}

	// 5. Send 5th message again -> now 201 Created!
	postReq5Retry := httptest.NewRequest(http.MethodPost, "/api/v1/discovery/message-requests", bytes.NewReader([]byte(payload5)))
	postReq5Retry.Header.Set("Content-Type", "application/json")
	postReq5Retry.Header.Set("Authorization", "Bearer "+token)
	postRec5Retry := httptest.NewRecorder()
	mux.ServeHTTP(postRec5Retry, postReq5Retry)
	if postRec5Retry.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created after ad unlock, got %d: %s", postRec5Retry.Code, postRec5Retry.Body.String())
	}
}
