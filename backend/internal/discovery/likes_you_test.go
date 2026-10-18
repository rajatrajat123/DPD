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

func TestSuperLike_PrioritizedAndDistinguishedInIncomingLikes(t *testing.T) {
	ctx := context.Background()
	identRepo := identity.NewMemoryRepository()
	discoRepo := discovery.NewMemoryRepository(identRepo)
	svc := discovery.NewService(discoRepo, identRepo, nil, nil)

	// Recipient
	_ = identRepo.CreateUser(ctx, &identity.User{ID: "target-user", Email: "target@example.com", Status: identity.StatusActive, Role: identity.RoleMember})
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{UserID: "target-user", DisplayName: "Target", Birthdate: time.Now().AddDate(-25, 0, 0), HeightCm: intPtr(170)})

	// User B: Regular Like (earliest: t - 2h)
	_ = identRepo.CreateUser(ctx, &identity.User{ID: "user-b", Email: "b@example.com", Status: identity.StatusActive, Role: identity.RoleMember})
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{UserID: "user-b", DisplayName: "Regular Early", Birthdate: time.Now().AddDate(-26, 0, 0), HeightCm: intPtr(165)})
	_ = discoRepo.RecordSwipeWithTime(ctx, "user-b", "target-user", discovery.SwipeLike, time.Now().Add(-2*time.Hour))

	// User D: Regular Like (later: t - 30m)
	_ = identRepo.CreateUser(ctx, &identity.User{ID: "user-d", Email: "d@example.com", Status: identity.StatusActive, Role: identity.RoleMember})
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{UserID: "user-d", DisplayName: "Regular Late", Birthdate: time.Now().AddDate(-27, 0, 0), HeightCm: intPtr(172)})
	_ = discoRepo.RecordSwipeWithTime(ctx, "user-d", "target-user", discovery.SwipeLike, time.Now().Add(-30*time.Minute))

	// User C: SUPER_SPARK (t - 1h)
	_ = identRepo.CreateUser(ctx, &identity.User{ID: "user-c", Email: "c@example.com", Status: identity.StatusActive, Role: identity.RoleMember})
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{UserID: "user-c", DisplayName: "Super Star", Birthdate: time.Now().AddDate(-28, 0, 0), HeightCm: intPtr(178)})
	_ = discoRepo.RecordSwipeWithTime(ctx, "user-c", "target-user", discovery.SwipeSuperSpark, time.Now().Add(-1*time.Hour))

	// User E: Another SUPER_SPARK (t - 10m, newest)
	_ = identRepo.CreateUser(ctx, &identity.User{ID: "user-e", Email: "e@example.com", Status: identity.StatusActive, Role: identity.RoleMember})
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{UserID: "user-e", DisplayName: "Super Star 2", Birthdate: time.Now().AddDate(-24, 0, 0), HeightCm: intPtr(180)})
	_ = discoRepo.RecordSwipeWithTime(ctx, "user-e", "target-user", discovery.SwipeSuperSpark, time.Now().Add(-10*time.Minute))

	// Query incoming likes for target-user
	resp, err := svc.GetLikesYou(ctx, "target-user", 20, 0)
	if err != nil {
		t.Fatalf("unexpected error fetching likes-you: %v", err)
	}

	if resp.TotalLikes != 4 {
		t.Fatalf("expected 4 total likes, got %d", resp.TotalLikes)
	}

	// Super Likes must be prioritized first, sorted newest first!
	// 1st: user-e (Super Like, -10m)
	if resp.Likes[0].UserID != "user-e" || !resp.Likes[0].IsSuperLike || resp.Likes[0].InteractionType != "SUPER_SPARK" {
		t.Errorf("expected 1st like to be user-e (SUPER_SPARK), got %+v", resp.Likes[0])
	}
	// 2nd: user-c (Super Like, -1h)
	if resp.Likes[1].UserID != "user-c" || !resp.Likes[1].IsSuperLike || resp.Likes[1].InteractionType != "SUPER_SPARK" {
		t.Errorf("expected 2nd like to be user-c (SUPER_SPARK), got %+v", resp.Likes[1])
	}
	// 3rd: user-d (Regular Like, -30m)
	if resp.Likes[2].UserID != "user-d" || resp.Likes[2].IsSuperLike || resp.Likes[2].InteractionType != "LIKE" {
		t.Errorf("expected 3rd like to be user-d (LIKE), got %+v", resp.Likes[2])
	}
	// 4th: user-b (Regular Like, -2h)
	if resp.Likes[3].UserID != "user-b" || resp.Likes[3].IsSuperLike || resp.Likes[3].InteractionType != "LIKE" {
		t.Errorf("expected 4th like to be user-b (LIKE), got %+v", resp.Likes[3])
	}

	// Block user-e -> user-e should now be excluded completely
	_ = discoRepo.BlockUser(ctx, "target-user", "user-e", "BLOCK")
	respAfterBlock, err := svc.GetLikesYou(ctx, "target-user", 20, 0)
	if err != nil {
		t.Fatalf("unexpected error after block: %v", err)
	}
	if respAfterBlock.TotalLikes != 3 {
		t.Fatalf("expected 3 total likes after block, got %d", respAfterBlock.TotalLikes)
	}
	if respAfterBlock.Likes[0].UserID != "user-c" {
		t.Errorf("expected user-c to become top like after blocking user-e, got %s", respAfterBlock.Likes[0].UserID)
	}
}

func TestFavourites_CRUD_Deduplication_Ownership(t *testing.T) {
	ctx := context.Background()
	identRepo := identity.NewMemoryRepository()
	discoRepo := discovery.NewMemoryRepository(identRepo)
	svc := discovery.NewService(discoRepo, identRepo, nil, nil)

	// User A, User B, User C
	_ = identRepo.CreateUser(ctx, &identity.User{ID: "fav-user-a", Email: "fa@example.com", Status: identity.StatusActive, Role: identity.RoleMember})
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{UserID: "fav-user-a", DisplayName: "Alice", Birthdate: time.Now().AddDate(-25, 0, 0), HeightCm: intPtr(170)})

	_ = identRepo.CreateUser(ctx, &identity.User{ID: "fav-user-b", Email: "fb@example.com", Status: identity.StatusActive, Role: identity.RoleMember})
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{UserID: "fav-user-b", DisplayName: "Bobbi", Birthdate: time.Now().AddDate(-26, 0, 0), HeightCm: intPtr(165)})

	_ = identRepo.CreateUser(ctx, &identity.User{ID: "fav-user-c", Email: "fc@example.com", Status: identity.StatusActive, Role: identity.RoleMember})
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{UserID: "fav-user-c", DisplayName: "Charlie", Birthdate: time.Now().AddDate(-27, 0, 0), HeightCm: intPtr(175)})

	// 1. Self favourite rejected
	_, err := svc.AddFavourite(ctx, "fav-user-a", "fav-user-a")
	if err == nil {
		t.Fatal("expected error when favouriting self, got nil")
	}

	// 2. Add User B
	resB, err := svc.AddFavourite(ctx, "fav-user-a", "fav-user-b")
	if err != nil {
		t.Fatalf("failed to add favourite: %v", err)
	}
	if !resB.Success || resB.TargetUserID != "fav-user-b" {
		t.Fatalf("unexpected add favourite response: %+v", resB)
	}

	// 3. Duplicate add User B (deduplicated)
	_, err = svc.AddFavourite(ctx, "fav-user-a", "fav-user-b")
	if err != nil {
		t.Fatalf("duplicate add favourite should succeed idempotently: %v", err)
	}

	// 4. Add User C
	_, err = svc.AddFavourite(ctx, "fav-user-a", "fav-user-c")
	if err != nil {
		t.Fatalf("failed to add second favourite: %v", err)
	}

	// 5. Check IsFavourite
	isFavB, err := svc.IsFavourite(ctx, "fav-user-a", "fav-user-b")
	if err != nil || !isFavB {
		t.Fatalf("expected isFavB true, got %v, err=%v", isFavB, err)
	}
	isFavNone, err := svc.IsFavourite(ctx, "fav-user-a", "unknown-user")
	if err != nil || isFavNone {
		t.Fatalf("expected unknown user false, got %v", isFavNone)
	}

	// 6. List favourites for User A
	listA, err := svc.ListFavourites(ctx, "fav-user-a")
	if err != nil {
		t.Fatalf("failed to list favourites: %v", err)
	}
	if listA.Count != 2 || len(listA.Favourites) != 2 {
		t.Fatalf("expected 2 favourites for user A, got count=%d, len=%d", listA.Count, len(listA.Favourites))
	}

	// 7. Ownership isolation: User B has 0 favourites
	listB, err := svc.ListFavourites(ctx, "fav-user-b")
	if err != nil {
		t.Fatalf("failed to list favourites for user B: %v", err)
	}
	if listB.Count != 0 {
		t.Fatalf("expected 0 favourites for user B, got %d", listB.Count)
	}

	// 8. Remove User B
	remB, err := svc.RemoveFavourite(ctx, "fav-user-a", "fav-user-b")
	if err != nil || !remB.Success {
		t.Fatalf("failed to remove favourite: %v", err)
	}

	listAAfterRemove, err := svc.ListFavourites(ctx, "fav-user-a")
	if err != nil {
		t.Fatalf("failed to list after remove: %v", err)
	}
	if listAAfterRemove.Count != 1 || listAAfterRemove.Favourites[0].UserID != "fav-user-c" {
		t.Fatalf("expected only fav-user-c remaining, got %+v", listAAfterRemove.Favourites)
	}

	// 9. Block User C -> filtered from favourites
	_ = discoRepo.BlockUser(ctx, "fav-user-a", "fav-user-c", "BLOCK")
	listAAfterBlock, err := svc.ListFavourites(ctx, "fav-user-a")
	if err != nil {
		t.Fatalf("failed to list after block: %v", err)
	}
	if listAAfterBlock.Count != 0 {
		t.Fatalf("expected 0 favourites after blocking User C, got %d", listAAfterBlock.Count)
	}
}

