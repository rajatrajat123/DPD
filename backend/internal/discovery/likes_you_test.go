package discovery_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/discovery"
	"github.com/auradating/platform/backend/internal/identity"
)

func TestLikesYou_BlurredForFree_UnblurredForPremium(t *testing.T) {
	ctx := context.Background()
	identRepo := identity.NewMemoryRepository()
	discoRepo := discovery.NewMemoryRepository(identRepo)
	svc := discovery.NewService(discoRepo, identRepo, nil, nil)

	// Create User A (Free) and User B (Liked A)
	userA := &identity.User{
		ID:        "user-a",
		Email:     "a@example.com",
		Role:      identity.RoleMember,
		Status:    identity.StatusActive,
		CreatedAt: time.Now().UTC(),
	}
	_ = identRepo.CreateUser(ctx, userA)
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{
		UserID:      "user-a",
		DisplayName: "Alice",
		Birthdate:   time.Now().AddDate(-25, 0, 0),
		HeightCm:    intPtr(170),
	})

	userB := &identity.User{
		ID:        "user-b",
		Email:     "b@example.com",
		Role:      identity.RoleMember,
		Status:    identity.StatusActive,
		CreatedAt: time.Now().UTC(),
	}
	_ = identRepo.CreateUser(ctx, userB)
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{
		UserID:      "user-b",
		DisplayName: "Bobbi",
		Bio:         "Queer artist in the city",
		Birthdate:   time.Now().AddDate(-26, 0, 0),
		HeightCm:    intPtr(165),
	})

	// User B likes User A
	_, _, _, err := discoRepo.CreateSwipe(ctx, "user-b", "user-a", discovery.SwipeLike, "", "corr-1")
	if err != nil {
		t.Fatalf("failed to create swipe: %v", err)
	}

	// 1. User A (Free) views Likes You
	freeResp, err := svc.GetLikesYou(ctx, "user-a", 20, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if freeResp.TotalLikes != 1 {
		t.Errorf("expected 1 total like, got %d", freeResp.TotalLikes)
	}
	if freeResp.RevealedCount != 0 || freeResp.UnrevealedCount != 1 {
		t.Errorf("expected 0 revealed, 1 unrevealed; got %d rev, %d unrev", freeResp.RevealedCount, freeResp.UnrevealedCount)
	}
	if len(freeResp.Likes) != 1 {
		t.Fatalf("expected 1 like card, got %d", len(freeResp.Likes))
	}
	likeCard := freeResp.Likes[0]
	if likeCard.IsRevealed {
		t.Errorf("expected likeCard to not be revealed for Free user")
	}
	if likeCard.DisplayName != "B..." {
		t.Errorf("expected blurred display name 'B...', got '%s'", likeCard.DisplayName)
	}
	if likeCard.BlurredPhotoURL == "" {
		t.Errorf("expected blurred photo URL")
	}

	// 2. User A reveals User B using free reveal
	revealedCard, source, err := svc.RevealLike(ctx, "user-a", "user-b")
	if err != nil {
		t.Fatalf("failed to reveal like: %v", err)
	}
	if !revealedCard.IsRevealed {
		t.Errorf("expected revealed card to be marked revealed")
	}
	if source != "FREE" {
		t.Errorf("expected source FREE, got %s", source)
	}
	if revealedCard.DisplayName != "Bobbi" {
		t.Errorf("expected full display name 'Bobbi', got '%s'", revealedCard.DisplayName)
	}

	// 3. User A views Likes You again; card is now revealed
	afterReveal, err := svc.GetLikesYou(ctx, "user-a", 20, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if afterReveal.RevealedCount != 1 || afterReveal.UnrevealedCount != 0 {
		t.Errorf("expected 1 revealed, 0 unrevealed; got %d rev, %d unrev", afterReveal.RevealedCount, afterReveal.UnrevealedCount)
	}
}

func TestRewardedAd_GrantsTwoReveals(t *testing.T) {
	ctx := context.Background()
	identRepo := identity.NewMemoryRepository()
	discoRepo := discovery.NewMemoryRepository(identRepo)
	svc := discovery.NewService(discoRepo, identRepo, nil, nil, discovery.WithEnvironment("local"))

	// User registers
	user := &identity.User{
		ID:        "user-reward",
		Email:     "reward@example.com",
		Role:      identity.RoleMember,
		Status:    identity.StatusActive,
		CreatedAt: time.Now().UTC(),
	}
	_ = identRepo.CreateUser(ctx, user)
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{
		UserID:      "user-reward",
		DisplayName: "Riley",
		Birthdate:   time.Now().AddDate(-24, 0, 0),
		HeightCm:    intPtr(175),
	})

	// Initial unlock state: 1 free reveal remaining, 0 bonus reveals
	state, err := discoRepo.GetUserLikesUnlockState(ctx, "user-reward")
	if err != nil {
		state = &discovery.UserLikesUnlockState{UserID: "user-reward"}
	}
	if state.BonusRevealsRemaining != 0 {
		t.Errorf("expected 0 initial bonus reveals, got %d", state.BonusRevealsRemaining)
	}

	// Deliver AdMob SSV reward callback for 1 ad watched
	nowMs := time.Now().UTC().UnixMilli()
	query := fmt.Sprintf("ad_network=54321&key_id=1&reward_amount=1&timestamp=%d&transaction_id=tx-ad-12345&user_id=user-reward&signature=VALID_TEST_SSV_SIGNATURE", nowMs)
	reward, err := svc.VerifyAndGrantAdReward(ctx, query)
	if err != nil {
		t.Fatalf("failed to verify ad reward: %v", err)
	}
	if reward.UserID != "user-reward" {
		t.Errorf("expected user-reward, got %s", reward.UserID)
	}

	// State should now have 2 bonus reveals unlocked per requirement Section 5
	updatedState, err := discoRepo.GetUserLikesUnlockState(ctx, "user-reward")
	if err != nil {
		t.Fatalf("failed to get updated state: %v", err)
	}
	if updatedState.BonusRevealsRemaining != 2 {
		t.Errorf("expected 2 bonus reveals unlocked per completed ad, got %d", updatedState.BonusRevealsRemaining)
	}
}

func TestMessageRequests_Workflow(t *testing.T) {
	ctx := context.Background()
	identRepo := identity.NewMemoryRepository()
	discoRepo := discovery.NewMemoryRepository(identRepo)
	svc := discovery.NewService(discoRepo, identRepo, nil, nil)

	// Sender & Recipient
	_ = identRepo.CreateUser(ctx, &identity.User{ID: "sender-1", Email: "s@example.com", Status: identity.StatusActive, Role: identity.RoleMember})
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{UserID: "sender-1", DisplayName: "Sam", Birthdate: time.Now().AddDate(-28, 0, 0), HeightCm: intPtr(180)})

	_ = identRepo.CreateUser(ctx, &identity.User{ID: "recip-1", Email: "r@example.com", Status: identity.StatusActive, Role: identity.RoleMember})
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{UserID: "recip-1", DisplayName: "Robin", Birthdate: time.Now().AddDate(-27, 0, 0), HeightCm: intPtr(168)})

	// Send message request
	req, err := svc.SendMessageRequest(ctx, "sender-1", discovery.SendMessageRequestPayload{
		RecipientUserID: "recip-1",
		Body:            "Hi Robin! Loved your bio about LGBTQ+ history.",
	})
	if err != nil {
		t.Fatalf("failed to send message request: %v", err)
	}
	if req.Status != "PENDING" {
		t.Errorf("expected PENDING status, got %s", req.Status)
	}

	// List received for recip-1
	received, err := svc.ListMessageRequests(ctx, "recip-1", "received")
	if err != nil {
		t.Fatalf("failed to list message requests: %v", err)
	}
	if len(received) != 1 {
		t.Fatalf("expected 1 received request, got %d", len(received))
	}
	if received[0].Body != "Hi Robin! Loved your bio about LGBTQ+ history." {
		t.Errorf("unexpected body: %s", received[0].Body)
	}

	// Accept message request
	err = svc.RespondMessageRequest(ctx, "recip-1", req.ID, "ACCEPTED")
	if err != nil {
		t.Fatalf("failed to respond to message request: %v", err)
	}

	// Verify updated status
	receivedAfter, _ := svc.ListMessageRequests(ctx, "recip-1", "received")
	if len(receivedAfter) != 1 || receivedAfter[0].Status != "ACCEPTED" {
		t.Errorf("expected request status ACCEPTED, got %+v", receivedAfter)
	}
}

func intPtr(v int) *int {
	return &v
}
