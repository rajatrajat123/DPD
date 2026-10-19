package discovery_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/discovery"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/media"
)

func setupTestDiscovery(t *testing.T) (*discovery.Service, *discovery.MemoryRepository, *identity.MemoryRepository) {
	t.Helper()
	identRepo := identity.NewMemoryRepository()
	discoRepo := discovery.NewMemoryRepository(identRepo)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	discoSvc := discovery.NewService(discoRepo, identRepo, nil, logger)
	return discoSvc, discoRepo, identRepo
}

func createTestUser(t *testing.T, identRepo *identity.MemoryRepository, id, email, name string, birthdate time.Time, genders, orientations []string, lat, lon float64, maxDistKm int) {
	t.Helper()
	ctx := context.Background()

	u := &identity.User{
		ID:        id,
		Email:     email,
		Status:    identity.StatusActive,
		Role:      identity.RoleMember,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	if err := identRepo.CreateUser(ctx, u); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	p := &identity.Profile{
		UserID:              id,
		DisplayName:         name,
		Birthdate:           birthdate,
		Bio:                 "Hello from " + name,
		Pronouns:            []string{"they/them"},
		GenderIdentities:    genders,
		SexualOrientations:  orientations,
		RelationshipIntents: []string{"serious dating"},
		VisibilitySettings:  identity.DefaultVisibilitySettings(),
		CreatedAt:           time.Now().UTC(),
		UpdatedAt:           time.Now().UTC(),
	}
	if err := identRepo.UpsertProfile(ctx, p); err != nil {
		t.Fatalf("failed to upsert profile: %v", err)
	}

	pref := identity.DatingPreferences{
		UserID:           id,
		MinAge:           20,
		MaxAge:           35,
		MaxDistanceKm:    maxDistKm,
		PreferredGenders: genders,
		UpdatedAt:        time.Now().UTC(),
	}
	if err := identRepo.UpsertPreferences(ctx, &pref); err != nil {
		t.Fatalf("failed to upsert preferences: %v", err)
	}

	loc := identity.ProfileLocation{
		UserID:      id,
		Latitude:    lat,
		Longitude:   lon,
		CityName:    "Berlin",
		CountryCode: "DE",
		UpdatedAt:   time.Now().UTC(),
	}
	if err := identRepo.UpsertLocation(ctx, &loc); err != nil {
		t.Fatalf("failed to upsert location: %v", err)
	}
}

func TestDiscovery_ReciprocalFilteringAndPrivacy(t *testing.T) {
	discoSvc, _, identRepo := setupTestDiscovery(t)
	ctx := context.Background()

	// Actor: 25 years old in Berlin
	actorDOB := time.Now().AddDate(-25, 0, 0)
	createTestUser(t, identRepo, "actor-1", "actor@aura.dating", "Alex", actorDOB, []string{"non-binary"}, []string{"queer"}, 52.5200, 13.4050, 50)

	// Compatible Candidate: 26 years old in Berlin (approx 3 km away)
	cand1DOB := time.Now().AddDate(-26, 0, 0)
	createTestUser(t, identRepo, "cand-1", "c1@aura.dating", "Sam", cand1DOB, []string{"non-binary"}, []string{"queer"}, 52.5000, 13.4200, 50)

	// Incompatible Candidate: Too far away (150 km)
	cand2DOB := time.Now().AddDate(-24, 0, 0)
	createTestUser(t, identRepo, "cand-2", "c2@aura.dating", "Taylor", cand2DOB, []string{"non-binary"}, []string{"queer"}, 53.5511, 9.9937, 50) // Hamburg

	// Incompatible Candidate: Outside age preference (45 years old)
	cand3DOB := time.Now().AddDate(-45, 0, 0)
	createTestUser(t, identRepo, "cand-3", "c3@aura.dating", "Morgan", cand3DOB, []string{"non-binary"}, []string{"queer"}, 52.5100, 13.4100, 50)

	feed, err := discoSvc.GetDiscoveryFeed(ctx, "actor-1", "", 20)
	if err != nil {
		t.Fatalf("feed retrieval failed: %v", err)
	}

	if feed.Count != 1 {
		t.Fatalf("expected exactly 1 compatible candidate in feed, got %d", feed.Count)
	}

	cand := feed.Candidates[0]
	if cand.UserID != "cand-1" {
		t.Errorf("expected candidate cand-1, got %s", cand.UserID)
	}

	// Verify Location Privacy: fuzzed integer distance, never exact GPS coordinates
	if cand.ApproximateDistanceKm < 1 {
		t.Errorf("expected approximate distance >= 1 km, got %d", cand.ApproximateDistanceKm)
	}
}

func TestDiscovery_BlockAndSwipeExclusions(t *testing.T) {
	discoSvc, discoRepo, identRepo := setupTestDiscovery(t)
	ctx := context.Background()

	actorDOB := time.Now().AddDate(-25, 0, 0)
	createTestUser(t, identRepo, "actor-2", "actor2@aura.dating", "Jordan", actorDOB, []string{"transgender woman"}, []string{"lesbian"}, 40.7128, -74.0060, 50)

	candDOB := time.Now().AddDate(-27, 0, 0)
	createTestUser(t, identRepo, "cand-blk", "candblk@aura.dating", "Casey", candDOB, []string{"transgender woman"}, []string{"lesbian"}, 40.7200, -74.0100, 50)

	// 1. Initial feed has candidate
	feed, _ := discoSvc.GetDiscoveryFeed(ctx, "actor-2", "", 20)
	if feed.Count != 1 {
		t.Fatalf("expected 1 candidate initially, got %d", feed.Count)
	}

	// 2. Block candidate
	if err := discoSvc.BlockUser(ctx, "actor-2", "cand-blk", "USER_INITIATED"); err != nil {
		t.Fatalf("block failed: %v", err)
	}

	// 3. Bi-directional block excludes from feed
	feedAfterBlock, _ := discoSvc.GetDiscoveryFeed(ctx, "actor-2", "", 20)
	if feedAfterBlock.Count != 0 {
		t.Fatalf("blocked candidate should not appear in actor feed")
	}

	feedCandidateView, _ := discoSvc.GetDiscoveryFeed(ctx, "cand-blk", "", 20)
	if feedCandidateView.Count != 0 {
		t.Fatalf("blocked actor should not appear in candidate feed (bi-directional exclusion)")
	}

	// 4. Cannot swipe on blocked user
	_, err := discoSvc.Swipe(ctx, "actor-2", discovery.SwipeRequest{
		TargetUserID: "cand-blk",
		Direction:    "LIKE",
	}, "test-trace")
	if err != discovery.ErrCandidateBlocked {
		t.Fatalf("expected ErrCandidateBlocked, got %v", err)
	}
	_ = discoRepo
}

func TestDiscovery_MutualMatchAndRewardGrant(t *testing.T) {
	discoSvc, _, identRepo := setupTestDiscovery(t)
	ctx := context.Background()

	dob := time.Now().AddDate(-25, 0, 0)
	createTestUser(t, identRepo, "user-A", "userA@aura.dating", "User A", dob, []string{"genderfluid"}, []string{"pansexual"}, 37.7749, -122.4194, 50)
	createTestUser(t, identRepo, "user-B", "userB@aura.dating", "User B", dob, []string{"genderfluid"}, []string{"pansexual"}, 37.7750, -122.4190, 50)

	// 1. Self swipe rejected
	_, err := discoSvc.Swipe(ctx, "user-A", discovery.SwipeRequest{
		TargetUserID: "user-A",
		Direction:    "LIKE",
	}, "test-trace")
	if err != discovery.ErrSelfSwipe {
		t.Fatalf("expected ErrSelfSwipe, got %v", err)
	}

	// 2. User A likes User B (Single swipe, no match yet)
	resp1, err := discoSvc.Swipe(ctx, "user-A", discovery.SwipeRequest{
		TargetUserID: "user-B",
		Direction:    "LIKE",
	}, "trace-1")
	if err != nil {
		t.Fatalf("user A swipe failed: %v", err)
	}
	if resp1.Matched {
		t.Fatalf("should not be matched yet without reciprocal like")
	}

	// 3. Repeated swipe is idempotent
	repeatResp, err := discoSvc.Swipe(ctx, "user-A", discovery.SwipeRequest{
		TargetUserID: "user-B",
		Direction:    "LIKE",
	}, "trace-repeat")
	if err != nil {
		t.Fatalf("idempotent repeat swipe failed: %v", err)
	}
	if repeatResp.Matched {
		t.Fatalf("repeated swipe should remain un-matched")
	}

	// 4. User B likes User A (Reciprocal like -> Mutual Match!)
	resp2, err := discoSvc.Swipe(ctx, "user-B", discovery.SwipeRequest{
		TargetUserID: "user-A",
		Direction:    "LIKE",
	}, "trace-2")
	if err != nil {
		t.Fatalf("user B swipe failed: %v", err)
	}
	if !resp2.Matched {
		t.Fatalf("expected mutual match to be created!")
	}
	if resp2.Match == nil {
		t.Fatalf("expected match object in response")
	}
	if !resp2.UnlimitedSwipesGranted {
		t.Fatalf("expected match-triggered unlimited swipe reward to be granted")
	}

	matchID := resp2.Match.ID

	// 5. Verify match listing for both users
	matchesA, err := discoSvc.ListMatches(ctx, "user-A")
	if err != nil || len(matchesA) != 1 {
		t.Fatalf("expected 1 match for User A, got %d", len(matchesA))
	}
	if matchesA[0].MatchedUserID != "user-B" {
		t.Errorf("expected matched user B, got %s", matchesA[0].MatchedUserID)
	}

	matchesB, err := discoSvc.ListMatches(ctx, "user-B")
	if err != nil || len(matchesB) != 1 {
		t.Fatalf("expected 1 match for User B, got %d", len(matchesB))
	}
	if matchesB[0].MatchedUserID != "user-A" {
		t.Errorf("expected matched user A, got %s", matchesB[0].MatchedUserID)
	}

	// 6. Unmatch action
	if err := discoSvc.Unmatch(ctx, matchID, "user-A"); err != nil {
		t.Fatalf("unmatch failed: %v", err)
	}

	// Matches list should now be empty (active matches only)
	activeAfterUnmatch, _ := discoSvc.ListMatches(ctx, "user-A")
	if len(activeAfterUnmatch) != 0 {
		t.Errorf("unmatched conversation should not appear in active matches")
	}
}

func TestDiscovery_HTTPRoutes(t *testing.T) {
	discoSvc, _, identRepo := setupTestDiscovery(t)
	handler := discovery.NewHandler(discoSvc)

	jwtSecret := "test-jwt-secret-key-32b-must-be-long-enough"
	authMw := identity.RequireAuth(jwtSecret)

	dob := time.Now().AddDate(-23, 0, 0)
	createTestUser(t, identRepo, "http-actor", "httpactor@aura.dating", "HTTP Actor", dob, []string{"non-binary"}, []string{"queer"}, 52.52, 13.40, 50)
	createTestUser(t, identRepo, "http-target", "httptarget@aura.dating", "HTTP Target", dob, []string{"non-binary"}, []string{"queer"}, 52.51, 13.41, 50)

	testUser := &identity.User{
		ID:    "http-actor",
		Email: "httpactor@aura.dating",
		Role:  identity.RoleMember,
	}
	token, _ := identity.GenerateAccessToken(jwtSecret, testUser, 1*time.Hour)

	mux := http.NewServeMux()
	mux.Handle("/api/v1/discovery/feed", authMw(http.HandlerFunc(handler.Feed)))
	mux.Handle("/api/v1/swipes", authMw(http.HandlerFunc(handler.Swipe)))
	mux.Handle("/api/v1/matches", authMw(http.HandlerFunc(handler.Matches)))

	// 1. GET /api/v1/discovery/feed -> 200 OK
	feedReq := httptest.NewRequest(http.MethodGet, "/api/v1/discovery/feed?limit=10", nil)
	feedReq.Header.Set("Authorization", "Bearer "+token)
	feedRec := httptest.NewRecorder()
	mux.ServeHTTP(feedRec, feedReq)

	if feedRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from discovery feed, got %d: %s", feedRec.Code, feedRec.Body.String())
	}

	var feedResp discovery.DiscoveryFeedResponse
	if err := json.Unmarshal(feedRec.Body.Bytes(), &feedResp); err != nil {
		t.Fatalf("failed to parse feed JSON: %v", err)
	}
	if feedResp.Count != 1 {
		t.Fatalf("expected 1 candidate, got %d", feedResp.Count)
	}

	// 2. POST /api/v1/swipes -> 200 OK
	swipePayload := `{"target_user_id":"http-target","direction":"LIKE"}`
	swipeReq := httptest.NewRequest(http.MethodPost, "/api/v1/swipes", bytes.NewReader([]byte(swipePayload)))
	swipeReq.Header.Set("Content-Type", "application/json")
	swipeReq.Header.Set("Authorization", "Bearer "+token)
	swipeRec := httptest.NewRecorder()
	mux.ServeHTTP(swipeRec, swipeReq)

	if swipeRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from swipe endpoint, got %d: %s", swipeRec.Code, swipeRec.Body.String())
	}

	var swipeResp discovery.SwipeResponse
	if err := json.Unmarshal(swipeRec.Body.Bytes(), &swipeResp); err != nil {
		t.Fatalf("failed to parse swipe JSON: %v", err)
	}
	if swipeResp.Matched {
		t.Errorf("single swipe should not yet be matched")
	}

	// 3. GET /api/v1/matches -> 200 OK with empty matches
	matchReq := httptest.NewRequest(http.MethodGet, "/api/v1/matches", nil)
	matchReq.Header.Set("Authorization", "Bearer "+token)
	matchRec := httptest.NewRecorder()
	mux.ServeHTTP(matchRec, matchReq)

	if matchRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from matches endpoint, got %d", matchRec.Code)
	}

	// 4. GET /api/v1/discovery/matching-summary -> 200 OK
	sumReq := httptest.NewRequest(http.MethodGet, "/api/v1/discovery/matching-summary", nil)
	sumReq.Header.Set("Authorization", "Bearer "+token)
	sumRec := httptest.NewRecorder()
	mux.Handle("/api/v1/discovery/matching-summary", authMw(http.HandlerFunc(handler.MatchingSummary)))
	mux.ServeHTTP(sumRec, sumReq)

	if sumRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from matching summary, got %d: %s", sumRec.Code, sumRec.Body.String())
	}
	var sumResp discovery.MatchingSummaryResponse
	if err := json.Unmarshal(sumRec.Body.Bytes(), &sumResp); err != nil {
		t.Fatalf("failed to decode matching summary: %v", err)
	}
	// Target is 1 person (< 5), so privacy floor should be applied
	if !sumResp.PrivacyFloorApplied {
		t.Errorf("expected PrivacyFloorApplied to be true for count < 5")
	}
	if sumResp.DisplayText != "Fewer than 5 people match your preferences nearby." {
		t.Errorf("unexpected display text: %s", sumResp.DisplayText)
	}

	// 5. POST /api/v1/swipes with SUPER_SPARK -> 200 OK
	superSwipePayload := `{"target_user_id":"http-target","direction":"SUPER_SPARK"}`
	superReq := httptest.NewRequest(http.MethodPost, "/api/v1/swipes", bytes.NewReader([]byte(superSwipePayload)))
	superReq.Header.Set("Content-Type", "application/json")
	superReq.Header.Set("Authorization", "Bearer "+token)
	superRec := httptest.NewRecorder()
	mux.ServeHTTP(superRec, superReq)
	if superRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from SUPER_SPARK swipe, got %d: %s", superRec.Code, superRec.Body.String())
	}

	// 6. Favourites Routes:
	mux.Handle("/api/v1/discovery/favourites", authMw(http.HandlerFunc(handler.Favourites)))
	mux.Handle("/api/v1/discovery/favourites/", authMw(http.HandlerFunc(handler.FavouriteDetail)))

	// 6a. POST /api/v1/discovery/favourites -> 201 Created
	favPayload := `{"target_user_id":"http-target"}`
	favReq := httptest.NewRequest(http.MethodPost, "/api/v1/discovery/favourites", bytes.NewReader([]byte(favPayload)))
	favReq.Header.Set("Content-Type", "application/json")
	favReq.Header.Set("Authorization", "Bearer "+token)
	favRec := httptest.NewRecorder()
	mux.ServeHTTP(favRec, favReq)
	if favRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created from favourites add, got %d: %s", favRec.Code, favRec.Body.String())
	}

	// 6b. GET /api/v1/discovery/favourites -> 200 OK
	getFavReq := httptest.NewRequest(http.MethodGet, "/api/v1/discovery/favourites", nil)
	getFavReq.Header.Set("Authorization", "Bearer "+token)
	getFavRec := httptest.NewRecorder()
	mux.ServeHTTP(getFavRec, getFavReq)
	if getFavRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from favourites list, got %d: %s", getFavRec.Code, getFavRec.Body.String())
	}
	var favListResp discovery.ListFavouritesResponse
	if err := json.Unmarshal(getFavRec.Body.Bytes(), &favListResp); err != nil {
		t.Fatalf("failed to parse favourites list: %v", err)
	}
	if favListResp.Count != 1 || len(favListResp.Favourites) != 1 || favListResp.Favourites[0].UserID != "http-target" {
		t.Fatalf("expected 1 favourite with user http-target, got %+v", favListResp)
	}

	// 6c. DELETE /api/v1/discovery/favourites/http-target -> 200 OK
	delFavReq := httptest.NewRequest(http.MethodDelete, "/api/v1/discovery/favourites/http-target", nil)
	delFavReq.Header.Set("Authorization", "Bearer "+token)
	delFavRec := httptest.NewRecorder()
	mux.ServeHTTP(delFavRec, delFavReq)
	if delFavRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from favourites delete, got %d: %s", delFavRec.Code, delFavRec.Body.String())
	}

	// Verify empty list after delete
	getFavRec2 := httptest.NewRecorder()
	mux.ServeHTTP(getFavRec2, getFavReq)
	var favListResp2 discovery.ListFavouritesResponse
	_ = json.Unmarshal(getFavRec2.Body.Bytes(), &favListResp2)
	if favListResp2.Count != 0 {
		t.Fatalf("expected 0 favourites after delete, got %d", favListResp2.Count)
	}
}

func TestDiscovery_DealbreakersAndEmptyStateReason(t *testing.T) {
	discoSvc, _, identRepo := setupTestDiscovery(t)
	ctx := context.Background()

	actorDOB := time.Now().AddDate(-28, 0, 0)
	candDOB := time.Now().AddDate(-29, 0, 0)

	// Actor: Alex, Non-smoker, Monogamous, Non-smoker dealbreaker enabled
	createTestUser(t, identRepo, "actor-deal", "alex@aura.dating", "Alex", actorDOB, []string{"non-binary"}, []string{"queer"}, 52.5200, 13.4050, 50)
	actorProf, _ := identRepo.GetProfile(ctx, "actor-deal")
	actorProf.SmokingHabit = identity.SmokingNonSmoker
	actorProf.RelationshipStructure = identity.StructureMonogamous
	actorProf.IsPhotoVerified = true
	_ = identRepo.UpsertProfile(ctx, actorProf)

	actorPref, _ := identRepo.GetPreferences(ctx, "actor-deal")
	actorPref.Dealbreakers = identity.LifestyleDealbreakers{
		NonSmokerOnly:     true,
		RequireVerified:   true,
		RequireMonogamous: true,
	}
	_ = identRepo.UpsertPreferences(ctx, actorPref)

	// Candidate 1: Smoker -> Excluded by NonSmokerOnly
	createTestUser(t, identRepo, "cand-smoker", "smoker@aura.dating", "Smoker", candDOB, []string{"non-binary"}, []string{"queer"}, 52.5100, 13.4100, 50)
	c1Prof, _ := identRepo.GetProfile(ctx, "cand-smoker")
	c1Prof.SmokingHabit = identity.SmokingRegularSmoker
	c1Prof.RelationshipStructure = identity.StructureMonogamous
	c1Prof.IsPhotoVerified = true
	_ = identRepo.UpsertProfile(ctx, c1Prof)

	feed, err := discoSvc.GetDiscoveryFeed(ctx, "actor-deal", "", 20)
	if err != nil {
		t.Fatalf("feed retrieval failed: %v", err)
	}
	if feed.Count != 0 {
		t.Fatalf("expected smoker candidate to be strictly excluded by dealbreaker, got %d", feed.Count)
	}
	if feed.EmptyStateReason != "DEALBREAKERS_EXCLUDED_ALL" {
		t.Errorf("expected empty_state_reason DEALBREAKERS_EXCLUDED_ALL, got %q", feed.EmptyStateReason)
	}

	// Make Candidate 1 non-smoker, but unverified -> Excluded by RequireVerified
	c1Prof.SmokingHabit = identity.SmokingNonSmoker
	c1Prof.IsPhotoVerified = false
	_ = identRepo.UpsertProfile(ctx, c1Prof)

	feed2, _ := discoSvc.GetDiscoveryFeed(ctx, "actor-deal", "", 20)
	if feed2.Count != 0 {
		t.Fatalf("expected unverified candidate to be excluded by RequireVerified, got %d", feed2.Count)
	}
	if feed2.EmptyStateReason != "DEALBREAKERS_EXCLUDED_ALL" {
		t.Errorf("expected empty_state_reason DEALBREAKERS_EXCLUDED_ALL, got %q", feed2.EmptyStateReason)
	}

	// Make Candidate 1 verified, but polyamorous -> Excluded by RequireMonogamous
	c1Prof.IsPhotoVerified = true
	c1Prof.RelationshipStructure = identity.StructurePolyamorous
	_ = identRepo.UpsertProfile(ctx, c1Prof)

	feed3, _ := discoSvc.GetDiscoveryFeed(ctx, "actor-deal", "", 20)
	if feed3.Count != 0 {
		t.Fatalf("expected poly candidate to be excluded by RequireMonogamous, got %d", feed3.Count)
	}
	if feed3.EmptyStateReason != "DEALBREAKERS_EXCLUDED_ALL" {
		t.Errorf("expected empty_state_reason DEALBREAKERS_EXCLUDED_ALL, got %q", feed3.EmptyStateReason)
	}

	// Make Candidate 1 match all criteria!
	c1Prof.RelationshipStructure = identity.StructureMonogamous
	_ = identRepo.UpsertProfile(ctx, c1Prof)

	feed4, _ := discoSvc.GetDiscoveryFeed(ctx, "actor-deal", "", 20)
	if feed4.Count != 1 {
		t.Fatalf("expected 1 candidate when all dealbreakers pass, got %d", feed4.Count)
	}

	// Now swipe candidate 1
	_, _ = discoSvc.Swipe(ctx, "actor-deal", discovery.SwipeRequest{TargetUserID: "cand-smoker", Direction: "PASS"}, "trace")
	feed5, _ := discoSvc.GetDiscoveryFeed(ctx, "actor-deal", "", 20)
	if feed5.Count != 0 {
		t.Fatalf("expected 0 candidates after swiping, got %d", feed5.Count)
	}
	if feed5.EmptyStateReason != "ALL_CANDIDATES_SWIPED" {
		t.Errorf("expected ALL_CANDIDATES_SWIPED, got %q", feed5.EmptyStateReason)
	}
}

func TestDiscovery_MatchingSummaryAndPrivacyFloor(t *testing.T) {
	ctx := context.Background()

	t.Run("ZeroPeopleNearby", func(t *testing.T) {
		discoSvc, _, identRepo := setupTestDiscovery(t)
		actorDOB := time.Now().AddDate(-25, 0, 0)
		createTestUser(t, identRepo, "actor-0", "actor0@aura.dating", "Alex", actorDOB, []string{"non-binary"}, []string{"queer"}, 52.5200, 13.4050, 50)

		summary0, err := discoSvc.GetMatchingSummary(ctx, "actor-0")
		if err != nil {
			t.Fatalf("GetMatchingSummary failed: %v", err)
		}
		if summary0.Count != 0 || summary0.PrivacyFloorApplied {
			t.Errorf("expected 0 count and PrivacyFloorApplied false, got %d / %v", summary0.Count, summary0.PrivacyFloorApplied)
		}
		if summary0.DisplayText != "No people match your preferences nearby." {
			t.Errorf("unexpected text: %s", summary0.DisplayText)
		}
	})

	t.Run("ThreePeopleNearby_PrivacyFloorApplied", func(t *testing.T) {
		discoSvc, _, identRepo := setupTestDiscovery(t)
		actorDOB := time.Now().AddDate(-25, 0, 0)
		createTestUser(t, identRepo, "actor-3", "actor3@aura.dating", "Alex", actorDOB, []string{"non-binary"}, []string{"queer"}, 52.5200, 13.4050, 50)

		for i := 1; i <= 3; i++ {
			uid := fmt.Sprintf("cand-sum-%d", i)
			candDOB := time.Now().AddDate(-24-i, 0, 0)
			createTestUser(t, identRepo, uid, uid+"@aura.dating", "Cand "+uid, candDOB, []string{"non-binary"}, []string{"queer"}, 52.5100+float64(i)*0.001, 13.4050, 50)
		}

		summary3, err := discoSvc.GetMatchingSummary(ctx, "actor-3")
		if err != nil {
			t.Fatalf("GetMatchingSummary failed: %v", err)
		}
		if !summary3.PrivacyFloorApplied {
			t.Errorf("expected PrivacyFloorApplied to be true for 3 candidates")
		}
		if summary3.Count != 0 {
			t.Errorf("expected Count to be floored to 0 when PrivacyFloorApplied is true, got %d", summary3.Count)
		}
		if summary3.DisplayText != "Fewer than 5 people match your preferences nearby." {
			t.Errorf("unexpected display text: %s", summary3.DisplayText)
		}
	})

	t.Run("SixPeopleNearby_FullCountReturned", func(t *testing.T) {
		discoSvc, _, identRepo := setupTestDiscovery(t)
		actorDOB := time.Now().AddDate(-25, 0, 0)
		createTestUser(t, identRepo, "actor-6", "actor6@aura.dating", "Alex", actorDOB, []string{"non-binary"}, []string{"queer"}, 52.5200, 13.4050, 50)

		for i := 1; i <= 6; i++ {
			uid := fmt.Sprintf("cand-sum-%d", i)
			candDOB := time.Now().AddDate(-22, 0, 0)
			createTestUser(t, identRepo, uid, uid+"@aura.dating", "Cand "+uid, candDOB, []string{"non-binary"}, []string{"queer"}, 52.5100+float64(i)*0.001, 13.4050, 50)
		}

		summary6, err := discoSvc.GetMatchingSummary(ctx, "actor-6")
		if err != nil {
			t.Fatalf("GetMatchingSummary failed: %v", err)
		}
		if summary6.PrivacyFloorApplied {
			t.Errorf("expected PrivacyFloorApplied to be false for 6 candidates")
		}
		if summary6.Count != 6 {
			t.Errorf("expected Count to be 6, got %d", summary6.Count)
		}
		if summary6.DisplayText != "6 people match your preferences nearby." {
			t.Errorf("unexpected display text: %s", summary6.DisplayText)
		}
	})
}

func TestDiscovery_RewindSwipe(t *testing.T) {
	ctx := context.Background()
	discoSvc, discoRepo, _ := setupTestDiscovery(t)

	actorID := "rewind-actor"
	targetID := "rewind-target"

	// 1. Unentitled user attempting rewind should fail closed with ErrRewindNotEntitled
	_, err := discoSvc.Rewind(ctx, actorID)
	if !errors.Is(err, discovery.ErrRewindNotEntitled) {
		t.Fatalf("expected ErrRewindNotEntitled, got %v", err)
	}

	// 2. Grant REWIND entitlement
	discoRepo.GrantTestEntitlement(actorID, "REWIND", time.Now().Add(24*time.Hour))

	// 3. Rewind without prior swipes should fail with ErrNoSwipeToRewind
	_, err = discoSvc.Rewind(ctx, actorID)
	if !errors.Is(err, discovery.ErrNoSwipeToRewind) {
		t.Fatalf("expected ErrNoSwipeToRewind, got %v", err)
	}

	// 4. Pass candidate
	_, err = discoSvc.Swipe(ctx, actorID, discovery.SwipeRequest{
		TargetUserID: targetID,
		Direction:    "PASS",
	}, "trace-pass")
	if err != nil {
		t.Fatalf("pass swipe failed: %v", err)
	}

	// 5. Rewind pass
	res, err := discoSvc.Rewind(ctx, actorID)
	if err != nil {
		t.Fatalf("expected rewind to succeed, got %v", err)
	}
	if !res.Success || res.RestoredUserID != targetID {
		t.Fatalf("expected restored target %s, got %+v", targetID, res)
	}

	// 6. Subscribing to HTTP route test
	handler := discovery.NewHandler(discoSvc)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/swipes/rewind", nil)
	authUser := &identity.AuthUser{ID: actorID, Email: "rewind@aura.dating", Role: identity.RoleMember}
	req = req.WithContext(identity.ContextWithAuthUser(req.Context(), authUser))
	rr := httptest.NewRecorder()

	// Prior pass for HTTP call
	_, _ = discoSvc.Swipe(ctx, actorID, discovery.SwipeRequest{
		TargetUserID: targetID,
		Direction:    "PASS",
	}, "trace-pass-2")

	handler.Rewind(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected HTTP 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var httpRes discovery.RewindResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &httpRes); err != nil {
		t.Fatalf("failed to decode rewind JSON: %v", err)
	}
	if !httpRes.Success || httpRes.RestoredUserID != targetID {
		t.Errorf("unexpected HTTP response: %+v", httpRes)
	}
}

func TestDiscovery_PhotoMinimumRequirement(t *testing.T) {
	ctx := context.Background()
	identRepo := identity.NewMemoryRepository()
	discoRepo := discovery.NewMemoryRepository(identRepo)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	tempDir := t.TempDir()
	storage, err := media.NewFileStorageEngine(tempDir, "test-media-signing-secret-key-32b-long")
	if err != nil {
		t.Fatalf("failed to create storage: %v", err)
	}
	proc := media.NewProcessor(logger, 15*1024*1024, 100*1024*1024)
	mediaRepo := media.NewMemoryRepository()
	mediaSvc := media.NewService(mediaRepo, storage, proc, logger)
	t.Cleanup(func() {
		mediaSvc.Stop()
	})

	discoSvc := discovery.NewService(discoRepo, identRepo, mediaSvc, logger)

	actorID := "actor-photo-min"
	candID := "cand-photo-min"
	dob := time.Now().AddDate(-25, 0, 0)
	createTestUser(t, identRepo, actorID, "actor@test.com", "Actor", dob, []string{"non-binary"}, []string{"queer"}, 52.52, 13.40, 50)
	createTestUser(t, identRepo, candID, "cand@test.com", "Candidate", dob, []string{"non-binary"}, []string{"queer"}, 52.52, 13.40, 50)

	// 1. Actor has 0 photos -> feed returns empty with PHOTO_MINIMUM_REQUIRED
	feed, err := discoSvc.GetDiscoveryFeed(ctx, actorID, "", 10)
	if err != nil {
		t.Fatalf("GetDiscoveryFeed failed: %v", err)
	}
	if feed.EmptyStateReason != "PHOTO_MINIMUM_REQUIRED" || len(feed.Candidates) != 0 {
		t.Fatalf("expected PHOTO_MINIMUM_REQUIRED with 0 candidates, got reason=%s count=%d", feed.EmptyStateReason, len(feed.Candidates))
	}

	// 2. Swiping with 0 photos fails with ErrSwipePhotoMinimumRequired
	_, err = discoSvc.Swipe(ctx, actorID, discovery.SwipeRequest{TargetUserID: candID, Direction: "LIKE"}, "swipe-1")
	if !errors.Is(err, discovery.ErrSwipePhotoMinimumRequired) {
		t.Fatalf("expected ErrSwipePhotoMinimumRequired, got %v", err)
	}

	// 3. Upload 2 photos for actor (still < 3)
	for i := 1; i <= 2; i++ {
		img := media.GenerateTestJPEG(200+i*20, 200+i*20)
		_, err := mediaSvc.UploadDirect(ctx, actorID, string(media.PurposeProfileGallery), string(media.MediaTypeImage), fmt.Sprintf("p%d.jpg", i), bytes.NewReader(img), int64(len(img)), fmt.Sprintf("k%d", i))
		if err != nil {
			t.Fatalf("failed to upload photo %d: %v", i, err)
		}
	}

	feed, _ = discoSvc.GetDiscoveryFeed(ctx, actorID, "", 10)
	if feed.EmptyStateReason != "PHOTO_MINIMUM_REQUIRED" {
		t.Fatalf("expected PHOTO_MINIMUM_REQUIRED with 2 photos, got %s", feed.EmptyStateReason)
	}

	// 4. Upload 3rd photo for actor
	img3 := media.GenerateTestJPEG(250, 250)
	_, err = mediaSvc.UploadDirect(ctx, actorID, string(media.PurposeProfileGallery), string(media.MediaTypeImage), "p3.jpg", bytes.NewReader(img3), int64(len(img3)), "k3")
	if err != nil {
		t.Fatalf("failed to upload 3rd photo: %v", err)
	}

	// 5. Candidate has 0 photos -> candidate should NOT be returned in feed
	feed, err = discoSvc.GetDiscoveryFeed(ctx, actorID, "", 10)
	if err != nil {
		t.Fatalf("feed fetch failed: %v", err)
	}
	if len(feed.Candidates) != 0 {
		t.Fatalf("candidate with <3 photos should not be returned, got %d candidates", len(feed.Candidates))
	}

	// 6. Upload 3 photos for candidate
	for i := 1; i <= 3; i++ {
		img := media.GenerateTestJPEG(200+i*20, 200+i*20)
		_, err := mediaSvc.UploadDirect(ctx, candID, string(media.PurposeProfileGallery), string(media.MediaTypeImage), fmt.Sprintf("cp%d.jpg", i), bytes.NewReader(img), int64(len(img)), fmt.Sprintf("ck%d", i))
		if err != nil {
			t.Fatalf("failed to upload candidate photo %d: %v", i, err)
		}
	}

	// 7. Now candidate appears in feed with photos populated
	feed, err = discoSvc.GetDiscoveryFeed(ctx, actorID, "", 10)
	if err != nil {
		t.Fatalf("feed fetch failed: %v", err)
	}
	if len(feed.Candidates) != 1 {
		t.Fatalf("expected 1 candidate with >=3 photos, got %d", len(feed.Candidates))
	}
	if len(feed.Candidates[0].Photos) < 3 {
		t.Fatalf("expected candidate to have at least 3 photos, got %d", len(feed.Candidates[0].Photos))
	}

	// 8. Actor can now swipe successfully
	swipeRes, err := discoSvc.Swipe(ctx, actorID, discovery.SwipeRequest{TargetUserID: candID, Direction: "LIKE"}, "swipe-ok")
	if err != nil {
		t.Fatalf("expected swipe to succeed with 3 photos, got %v", err)
	}
	if swipeRes == nil {
		t.Fatalf("expected non-nil swipe response")
	}
}

func TestDiscovery_UnverifiedAge_LimitedFeedAndSwipeGating(t *testing.T) {
	ctx := context.Background()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identRepo := identity.NewMemoryRepository()
	discoRepo := discovery.NewMemoryRepository(identRepo)

	storage, _ := media.NewFileStorageEngine(t.TempDir(), "test-secret")
	proc := media.NewProcessor(logger, 15*1024*1024, 100*1024*1024, media.WithEnvironment("development"))
	mediaRepo := media.NewMemoryRepository()
	mediaSvc := media.NewService(mediaRepo, storage, proc, logger)
	t.Cleanup(func() {
		mediaSvc.Stop()
	})

	discoSvc := discovery.NewService(discoRepo, identRepo, mediaSvc, logger)

	actorID := "actor-unverified-age"
	candID := "cand-eligible-public"
	dob := time.Now().AddDate(-24, 0, 0)
	createTestUser(t, identRepo, actorID, "actor-unv@test.com", "Actor Unv", dob, []string{"non-binary"}, []string{"queer"}, 52.52, 13.40, 50)
	createTestUser(t, identRepo, candID, "cand-pub@test.com", "Cand Pub", dob, []string{"non-binary"}, []string{"queer"}, 52.52, 13.40, 50)

	// Candidate has 3 approved photos
	for i := 1; i <= 3; i++ {
		img := media.GenerateTestJPEG(200+i*20, 200+i*20)
		_, err := mediaSvc.UploadDirect(ctx, candID, string(media.PurposeProfileGallery), string(media.MediaTypeImage), fmt.Sprintf("cp%d.jpg", i), bytes.NewReader(img), int64(len(img)), fmt.Sprintf("k-unv-%d", i))
		if err != nil {
			t.Fatalf("failed to upload candidate photo: %v", err)
		}
	}

	// Actor also has 3 approved photos
	for i := 1; i <= 3; i++ {
		img := media.GenerateTestJPEG(200+i*20, 200+i*20)
		_, err := mediaSvc.UploadDirect(ctx, actorID, string(media.PurposeProfileGallery), string(media.MediaTypeImage), fmt.Sprintf("ap%d.jpg", i), bytes.NewReader(img), int64(len(img)), fmt.Sprintf("k-act-%d", i))
		if err != nil {
			t.Fatalf("failed to upload actor photo: %v", err)
		}
	}

	// 1. Wire ageChecker that reports pending (unverified)
	verifiedMap := map[string]bool{actorID: false}
	discoSvc.SetAgeChecker(func(ctx context.Context, userID string) (bool, error) {
		return verifiedMap[userID], nil
	})

	// 2. Adult actor with pending verification can browse discovery feed and see candidate
	feed, err := discoSvc.GetDiscoveryFeed(ctx, actorID, "", 10)
	if err != nil {
		t.Fatalf("GetDiscoveryFeed failed for unverified adult user: %v", err)
	}
	if len(feed.Candidates) != 1 {
		t.Fatalf("expected 1 candidate in feed, got %d", len(feed.Candidates))
	}
	if feed.Candidates[0].UserID != candID {
		t.Fatalf("expected candidate %s, got %s", candID, feed.Candidates[0].UserID)
	}

	// 3. Swiping PASS is allowed for pending adult users
	passRes, err := discoSvc.Swipe(ctx, actorID, discovery.SwipeRequest{TargetUserID: candID, Direction: "PASS"}, "swipe-pass-ok")
	if err != nil {
		t.Fatalf("expected PASS swipe to succeed for unverified adult user, got: %v", err)
	}
	if passRes == nil {
		t.Fatalf("expected non-nil swipe response on PASS")
	}

	// 4. Swiping LIKE and SUPER_SPARK is allowed for pending adult users
	likeRes, err := discoSvc.Swipe(ctx, actorID, discovery.SwipeRequest{TargetUserID: candID, Direction: "LIKE"}, "swipe-like-ok")
	if err != nil {
		t.Fatalf("expected LIKE swipe to succeed for unverified adult user, got: %v", err)
	}
	if likeRes == nil {
		t.Fatalf("expected non-nil swipe response on LIKE")
	}

	// 5. Underage user is rejected with ErrUnderageProhibited
	underageID := "actor-underage"
	underageDOB := time.Now().AddDate(-16, 0, 0) // 16 years old
	createTestUser(t, identRepo, underageID, "underage@test.com", "Underage", underageDOB, []string{"non-binary"}, []string{"queer"}, 52.52, 13.40, 50)
	_, err = discoSvc.Swipe(ctx, underageID, discovery.SwipeRequest{TargetUserID: candID, Direction: "PASS"}, "underage-swipe")
	if !errors.Is(err, discovery.ErrUnderageProhibited) {
		t.Fatalf("expected ErrUnderageProhibited for underage user, got: %v", err)
	}
	_, err = discoSvc.GetDiscoveryFeed(ctx, underageID, "", 10)
	if !errors.Is(err, discovery.ErrUnderageProhibited) {
		t.Fatalf("expected ErrUnderageProhibited on feed for underage user, got: %v", err)
	}
}

func TestDiscovery_SearchProfiles(t *testing.T) {
	ctx := context.Background()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identRepo := identity.NewMemoryRepository()
	discoRepo := discovery.NewMemoryRepository(identRepo)
	discoSvc := discovery.NewService(discoRepo, identRepo, nil, logger)

	actorID := "search-actor"
	if err := identRepo.CreateUser(ctx, &identity.User{ID: actorID, Email: actorID + "@aura.local", Status: identity.StatusActive, Role: identity.RoleMember, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}); err != nil {
		t.Fatalf("failed to create actor: %v", err)
	}
	if err := identRepo.UpsertProfile(ctx, &identity.Profile{
		UserID:      actorID,
		DisplayName: "Actor",
		Birthdate:   time.Now().AddDate(-25, 0, 0),
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}); err != nil {
		t.Fatalf("failed to upsert actor profile: %v", err)
	}

	user1 := "search-user-1"
	if err := identRepo.CreateUser(ctx, &identity.User{ID: user1, Email: user1 + "@aura.local", Status: identity.StatusActive, Role: identity.RoleMember, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}); err != nil {
		t.Fatalf("failed to create user1: %v", err)
	}
	if err := identRepo.UpsertProfile(ctx, &identity.Profile{
		UserID:             user1,
		DisplayName:        "River Martinez",
		Bio:                "Coffee enthusiast and queer poet in Brooklyn",
		GenderIdentities:   []string{"non_binary", "genderqueer"},
		SexualOrientations: []string{"pansexual"},
		Birthdate:          time.Now().AddDate(-24, 0, 0),
		IsPhotoVerified:    true,
		CreatedAt:          time.Now().UTC(),
		UpdatedAt:          time.Now().UTC(),
	}); err != nil {
		t.Fatalf("failed to upsert user1 profile: %v", err)
	}

	user2 := "search-user-2"
	if err := identRepo.CreateUser(ctx, &identity.User{ID: user2, Email: user2 + "@aura.local", Status: identity.StatusActive, Role: identity.RoleMember, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}); err != nil {
		t.Fatalf("failed to create user2: %v", err)
	}
	if err := identRepo.UpsertProfile(ctx, &identity.Profile{
		UserID:             user2,
		DisplayName:        "Jordan Lee",
		Bio:                "Designer and climber",
		GenderIdentities:   []string{"transgender_woman"},
		SexualOrientations: []string{"lesbian"},
		Birthdate:          time.Now().AddDate(-28, 0, 0),
		CreatedAt:          time.Now().UTC(),
		UpdatedAt:          time.Now().UTC(),
	}); err != nil {
		t.Fatalf("failed to upsert user2 profile: %v", err)
	}

	// Incognito user should not appear
	incognitoUser := "search-incognito"
	if err := identRepo.CreateUser(ctx, &identity.User{ID: incognitoUser, Email: incognitoUser + "@aura.local", Status: identity.StatusActive, Role: identity.RoleMember, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}); err != nil {
		t.Fatalf("failed to create incognito user: %v", err)
	}
	if err := identRepo.UpsertProfile(ctx, &identity.Profile{
		UserID:           incognitoUser,
		DisplayName:      "River Hidden",
		IncognitoEnabled: true,
		Birthdate:        time.Now().AddDate(-30, 0, 0),
		CreatedAt:        time.Now().UTC(),
		UpdatedAt:        time.Now().UTC(),
	}); err != nil {
		t.Fatalf("failed to upsert incognito profile: %v", err)
	}

	// 1. Search by name match
	res, err := discoSvc.SearchProfiles(ctx, actorID, "River", 20)
	if err != nil {
		t.Fatalf("SearchProfiles failed: %v", err)
	}
	if res.Count != 1 {
		t.Fatalf("expected 1 result for 'River', got %d", res.Count)
	}
	if res.Candidates[0].UserID != user1 {
		t.Fatalf("expected user %s, got %s", user1, res.Candidates[0].UserID)
	}

	// 2. Search by bio keyword
	res, err = discoSvc.SearchProfiles(ctx, actorID, "climber", 20)
	if err != nil {
		t.Fatalf("SearchProfiles failed: %v", err)
	}
	if res.Count != 1 || res.Candidates[0].UserID != user2 {
		t.Fatalf("expected user2 for 'climber', got: %+v", res)
	}

	// 3. Search by tag
	res, err = discoSvc.SearchProfiles(ctx, actorID, "lesbian", 20)
	if err != nil {
		t.Fatalf("SearchProfiles failed: %v", err)
	}
	if res.Count != 1 || res.Candidates[0].UserID != user2 {
		t.Fatalf("expected user2 for 'lesbian', got: %+v", res)
	}

	// 4. Blocked user should be excluded
	_ = discoRepo.BlockUser(ctx, actorID, user1, "test block")
	res, err = discoSvc.SearchProfiles(ctx, actorID, "River", 20)
	if err != nil {
		t.Fatalf("SearchProfiles failed: %v", err)
	}
	if res.Count != 0 {
		t.Fatalf("expected 0 results after block, got %d", res.Count)
	}

	// 5. Empty query, whitespace query, and single-character query must return 0 results
	for _, shortQuery := range []string{"", "   ", "R", " x "} {
		res, err = discoSvc.SearchProfiles(ctx, actorID, shortQuery, 20)
		if err != nil {
			t.Fatalf("SearchProfiles with short query %q failed: %v", shortQuery, err)
		}
		if res.Count != 0 || len(res.Candidates) != 0 {
			t.Fatalf("expected 0 results for short query %q, got count=%d len=%d", shortQuery, res.Count, len(res.Candidates))
		}
	}
}

func TestDiscoveryFeed_CursorPagination3Batches(t *testing.T) {
	discoSvc, _, identRepo := setupTestDiscovery(t)
	ctx := context.Background()

	actorID := "actor_pagination_user"
	now := time.Now().UTC()
	createTestUser(t, identRepo, actorID, "actor_pag@example.com", "Actor Pag", now.AddDate(-25, 0, 0), []string{"non_binary"}, []string{"queer"}, 37.7749, -122.4194, 100)

	// Create 5 test candidate users
	candidateIDs := []string{"pag_u1", "pag_u2", "pag_u3", "pag_u4", "pag_u5"}
	for i, cid := range candidateIDs {
		createTestUser(t, identRepo, cid, fmt.Sprintf("%s@example.com", cid), fmt.Sprintf("Candidate %d", i+1), now.AddDate(-24, 0, 0), []string{"non_binary"}, []string{"queer"}, 37.7750, -122.4195, 100)
	}

	// Batch 1: limit 2
	b1, err := discoSvc.GetDiscoveryFeed(ctx, actorID, "", 2)
	if err != nil {
		t.Fatalf("Batch 1 failed: %v", err)
	}
	if len(b1.Candidates) != 2 {
		t.Fatalf("expected 2 candidates in batch 1, got %d", len(b1.Candidates))
	}
	if b1.NextCursor == "" {
		t.Fatalf("expected non-empty next_cursor in batch 1")
	}

	// Batch 2: limit 2 with cursor from batch 1
	b2, err := discoSvc.GetDiscoveryFeed(ctx, actorID, b1.NextCursor, 2)
	if err != nil {
		t.Fatalf("Batch 2 failed: %v", err)
	}
	if len(b2.Candidates) != 2 {
		t.Fatalf("expected 2 candidates in batch 2, got %d", len(b2.Candidates))
	}
	if b2.NextCursor == "" {
		t.Fatalf("expected non-empty next_cursor in batch 2")
	}

	// Batch 3: limit 2 with cursor from batch 2
	b3, err := discoSvc.GetDiscoveryFeed(ctx, actorID, b2.NextCursor, 2)
	if err != nil {
		t.Fatalf("Batch 3 failed: %v", err)
	}
	if len(b3.Candidates) != 1 {
		t.Fatalf("expected 1 candidate in batch 3, got %d", len(b3.Candidates))
	}
	if b3.NextCursor != "" {
		t.Fatalf("expected empty next_cursor after batch 3, got %s", b3.NextCursor)
	}

	// Verify all 5 candidates are distinct
	seen := make(map[string]bool)
	all := append(append(b1.Candidates, b2.Candidates...), b3.Candidates...)
	if len(all) != 5 {
		t.Fatalf("expected 5 total candidates, got %d", len(all))
	}
	for _, c := range all {
		if seen[c.UserID] {
			t.Fatalf("duplicate candidate across batches: %s", c.UserID)
		}
		seen[c.UserID] = true
	}
}

func TestGetPublicProfile_SanitizedAndSafe(t *testing.T) {
	discoSvc, discoRepo, identRepo := setupTestDiscovery(t)
	ctx := context.Background()

	actorID := "actor_profile_tester"
	targetID := "target_profile_user"
	now := time.Now().UTC()

	createTestUser(t, identRepo, actorID, "actor_prof@example.com", "Actor", now.AddDate(-26, 0, 0), []string{"non_binary"}, []string{"queer"}, 37.7749, -122.4194, 100)
	createTestUser(t, identRepo, targetID, "target_prof@example.com", "Target Member", now.AddDate(-24, 0, 0), []string{"transgender_woman"}, []string{"lesbian"}, 37.7755, -122.4180, 100)

	// 1. Successful fetch
	cand, err := discoSvc.GetPublicProfile(ctx, actorID, targetID)
	if err != nil {
		t.Fatalf("GetPublicProfile failed: %v", err)
	}
	if cand.UserID != targetID {
		t.Fatalf("expected user_id %s, got %s", targetID, cand.UserID)
	}
	if cand.DisplayName != "Target Member" {
		t.Fatalf("expected DisplayName 'Target Member', got %s", cand.DisplayName)
	}
	if cand.Age != 24 {
		t.Fatalf("expected Age 24, got %d", cand.Age)
	}
	if cand.ApproximateDistanceKm < 1 {
		t.Fatalf("expected positive distance, got %d", cand.ApproximateDistanceKm)
	}

	// 2. Blocked profile
	_ = discoRepo.BlockUser(ctx, actorID, targetID, "harassment")
	_, err = discoSvc.GetPublicProfile(ctx, actorID, targetID)
	if err == nil || !errors.Is(err, discovery.ErrCandidateBlocked) {
		t.Fatalf("expected ErrCandidateBlocked for blocked target, got %v", err)
	}

	// 3. Underage profile
	underageID := "underage_user"
	createTestUser(t, identRepo, underageID, "underage@example.com", "Minor", now.AddDate(-17, 0, 0), []string{"cisgender_man"}, []string{"gay"}, 37.7749, -122.4194, 100)
	_, err = discoSvc.GetPublicProfile(ctx, actorID, underageID)
	if err == nil || !errors.Is(err, discovery.ErrUnderageProhibited) {
		t.Fatalf("expected ErrUnderageProhibited for underage profile, got %v", err)
	}
}



