package database_test

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/chat"
	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/database"
	"github.com/auradating/platform/backend/internal/discovery"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/media"
	"github.com/auradating/platform/backend/migrations"
)

func genTestUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func setupLivePostgres(t *testing.T) (*database.Postgres, context.Context, context.CancelFunc) {
	t.Helper()
	dbURL := getTestDatabaseURL()
	if dbURL == "" {
		t.Skip("Skipping PostgreSQL persistence verification: Neither TEST_DATABASE_URL nor DATABASE_URL configured.")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)

	cfg, err := config.Load(func(k string) string {
		switch k {
		case "DATABASE_URL":
			return dbURL
		case "APP_ENV":
			return "development"
		case "JWT_SIGNING_SECRET":
			return "local-dev-only-jwt-signing-secret-must-be-changed-32b"
		default:
			return ""
		}
	})
	if err != nil {
		cancel()
		t.Fatalf("failed to load config: %v", err)
	}

	pg, err := database.NewPostgres(ctx, cfg)
	if err != nil {
		cancel()
		t.Fatalf("failed to connect to postgres: %v", err)
	}

	if err := pg.HealthCheck(ctx); err != nil {
		pg.Close()
		cancel()
		t.Fatalf("database healthcheck failed: %v", err)
	}

	// Ensure all migrations are applied
	store := database.NewPgxMigrationStore(pg.Pool)
	migrator, err := database.NewMigrator(migrations.FS, store)
	if err != nil {
		pg.Close()
		cancel()
		t.Fatalf("failed to create migrator: %v", err)
	}

	if _, err := migrator.Up(ctx); err != nil {
		pg.Close()
		cancel()
		t.Fatalf("migrator.Up failed: %v", err)
	}

	return pg, ctx, cancel
}

// 1. Verify User Registration, Login, and Session Persistence
func TestPostgres_UserRegistrationAndLoginPersistence(t *testing.T) {
	pg, ctx, cancel := setupLivePostgres(t)
	defer cancel()
	defer pg.Close()

	identRepo := identity.NewPostgresRepository(pg.Pool)

	runID := time.Now().UnixNano()
	userID := genTestUUID()
	userEmail := fmt.Sprintf("persist_reg_%d@auratest.internal", runID)
	phone := fmt.Sprintf("+1555%07d", runID%10000000)
	now := time.Now().UTC()

	user := &identity.User{
		ID:           userID,
		Email:        userEmail,
		PhoneE164:    &phone,
		PasswordHash: "argon2id$v=19$m=65536,t=1,p=1$synthetic_hash_value",
		Status:       identity.StatusActive,
		Role:         identity.RoleMember,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	// 1a. Persist user registration
	if err := identRepo.CreateUser(ctx, user); err != nil {
		t.Fatalf("failed to create user in PostgreSQL: %v", err)
	}

	// 1b. Duplicate email rejection
	dupUser := &identity.User{
		ID:           genTestUUID(),
		Email:        userEmail,
		PasswordHash: "some_other_hash",
		Status:       identity.StatusActive,
		Role:         identity.RoleMember,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := identRepo.CreateUser(ctx, dupUser); !errors.Is(err, identity.ErrUserAlreadyExists) {
		t.Fatalf("expected ErrUserAlreadyExists on duplicate email, got: %v", err)
	}

	// 1c. Read back by ID
	byID, err := identRepo.GetUserByID(ctx, userID)
	if err != nil {
		t.Fatalf("failed to read user by ID: %v", err)
	}
	if byID.Email != userEmail || byID.Role != identity.RoleMember || byID.Status != identity.StatusActive {
		t.Fatalf("user by ID fields mismatch: %+v", byID)
	}

	// 1d. Read back by Email
	byEmail, err := identRepo.GetUserByEmail(ctx, userEmail)
	if err != nil {
		t.Fatalf("failed to read user by email: %v", err)
	}
	if byEmail.ID != userID {
		t.Fatalf("user by email ID mismatch: expected %s, got %s", userID, byEmail.ID)
	}

	// 1e. Persist session
	tokenHash := []byte(fmt.Sprintf("token_hash_%d", runID))
	sessionID := genTestUUID()
	familyID := genTestUUID()
	session := &identity.UserSession{
		ID:                sessionID,
		UserID:            userID,
		FamilyID:          familyID,
		RefreshTokenHash:  tokenHash,
		DeviceFingerprint: "pixel9_fingerprint_hash",
		UserAgent:         "Aura/1.0.0 Android/15",
		IPAddress:         "192.168.1.100",
		ExpiresAt:         now.Add(30 * 24 * time.Hour),
		CreatedAt:         now,
	}
	if err := identRepo.CreateSession(ctx, session); err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// 1f. Read back session
	readSess, err := identRepo.GetSessionByTokenHash(ctx, tokenHash)
	if err != nil {
		t.Fatalf("failed to read session: %v", err)
	}
	if readSess.ID != sessionID || readSess.UserID != userID || readSess.FamilyID != familyID {
		t.Fatalf("session fields mismatch: %+v", readSess)
	}

	// 1g. Revoke session
	if err := identRepo.RevokeSession(ctx, sessionID); err != nil {
		t.Fatalf("failed to revoke session: %v", err)
	}
	revokedSess, err := identRepo.GetSessionByTokenHash(ctx, tokenHash)
	if err != nil {
		t.Fatalf("failed to read revoked session: %v", err)
	}
	if revokedSess.RevokedAt == nil {
		t.Fatalf("expected revoked_at to be set on session")
	}

	// 1h. Account verification flow
	verID := genTestUUID()
	ver := &identity.AccountVerification{
		ID:          verID,
		UserID:      userID,
		Channel:     "EMAIL",
		Target:      userEmail,
		CodeHash:    fmt.Sprintf("otp_code_hash_%d", runID),
		Attempts:    0,
		MaxAttempts: 5,
		ExpiresAt:   now.Add(15 * time.Minute),
		CreatedAt:   now,
	}
	if err := identRepo.CreateVerification(ctx, ver); err != nil {
		t.Fatalf("failed to create account verification: %v", err)
	}

	latestVer, err := identRepo.GetLatestVerification(ctx, userID, "EMAIL")
	if err != nil {
		t.Fatalf("failed to get latest verification: %v", err)
	}
	if latestVer.ID != verID {
		t.Fatalf("verification ID mismatch: expected %s, got %s", verID, latestVer.ID)
	}

	if err := identRepo.MarkVerificationVerified(ctx, verID); err != nil {
		t.Fatalf("failed to mark verification verified: %v", err)
	}

	// 1i. Password reset persistence
	resetID := genTestUUID()
	resetHash := fmt.Sprintf("pwd_reset_hash_%d", runID)
	reset := &identity.PasswordReset{
		ID:        resetID,
		UserID:    userID,
		TokenHash: resetHash,
		ExpiresAt: now.Add(1 * time.Hour),
		CreatedAt: now,
	}
	if err := identRepo.CreatePasswordReset(ctx, reset); err != nil {
		t.Fatalf("failed to create password reset: %v", err)
	}
	readReset, err := identRepo.GetPasswordResetByHash(ctx, resetHash)
	if err != nil {
		t.Fatalf("failed to get password reset: %v", err)
	}
	if readReset.ID != resetID {
		t.Fatalf("password reset ID mismatch: expected %s, got %s", resetID, readReset.ID)
	}
	if err := identRepo.MarkPasswordResetUsed(ctx, resetID); err != nil {
		t.Fatalf("failed to mark password reset used: %v", err)
	}

	t.Log("User registration, login, and session persistence verified successfully against live PostgreSQL!")
}

// 2. Verify Profile Updates and Discovery Preferences Persistence
func TestPostgres_ProfileAndPreferencesPersistence(t *testing.T) {
	pg, ctx, cancel := setupLivePostgres(t)
	defer cancel()
	defer pg.Close()

	identRepo := identity.NewPostgresRepository(pg.Pool)

	runID := time.Now().UnixNano()
	userID := genTestUUID()
	userEmail := fmt.Sprintf("persist_prof_%d@auratest.internal", runID)
	now := time.Now().UTC()

	// Seed user account
	user := &identity.User{
		ID:           userID,
		Email:        userEmail,
		PasswordHash: "hash",
		Status:       identity.StatusActive,
		Role:         identity.RoleMember,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := identRepo.CreateUser(ctx, user); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// 2a. Profile persistence with comprehensive LGBTQ+ identity taxonomy & lifestyle habits
	bdate := time.Date(1995, time.August, 14, 0, 0, 0, 0, time.UTC)
	prof := &identity.Profile{
		UserID:                userID,
		DisplayName:           "Maya Lin",
		Birthdate:             bdate,
		Bio:                   "Artist & community organizer in Oakland",
		Pronouns:              []string{"they/them", "she/her"},
		GenderIdentities:      []string{"non-binary", "genderqueer"},
		SexualOrientations:    []string{"queer", "pansexual"},
		RelationshipIntents:   []string{"serious dating", "long-term partner"},
		RelationshipStructure: identity.StructureMonogamous,
		SmokingHabit:          identity.SmokingNonSmoker,
		DrinkingHabit:         identity.DrinkingSocially,
		VisibilitySettings:    identity.DefaultVisibilitySettings(),
		IsPhotoVerified:       true,
		DiscreteModeEnabled:   false,
		IncognitoEnabled:      false,
		CreatedAt:             now,
		UpdatedAt:             now,
	}

	if err := identRepo.UpsertProfile(ctx, prof); err != nil {
		t.Fatalf("failed to upsert profile: %v", err)
	}

	readProf, err := identRepo.GetProfile(ctx, userID)
	if err != nil {
		t.Fatalf("failed to read back profile: %v", err)
	}
	if readProf.DisplayName != "Maya Lin" || readProf.Bio != "Artist & community organizer in Oakland" {
		t.Fatalf("profile display name or bio mismatch: %+v", readProf)
	}
	if readProf.SmokingHabit != identity.SmokingNonSmoker || readProf.DrinkingHabit != identity.DrinkingSocially {
		t.Fatalf("profile habits mismatch: smoking=%s, drinking=%s", readProf.SmokingHabit, readProf.DrinkingHabit)
	}
	if !readProf.IsPhotoVerified {
		t.Fatalf("expected is_photo_verified to be true")
	}
	if len(readProf.GenderIdentities) != 2 || readProf.GenderIdentities[0] != "non-binary" {
		t.Fatalf("gender identities mismatch: %+v", readProf.GenderIdentities)
	}

	// 2b. Location persistence with PostGIS geography
	loc := &identity.ProfileLocation{
		UserID:      userID,
		Latitude:    37.8044,
		Longitude:   -122.2712,
		CityName:    "Oakland",
		CountryCode: "US",
		UpdatedAt:   now,
	}
	if err := identRepo.UpsertLocation(ctx, loc); err != nil {
		t.Fatalf("failed to upsert profile location: %v", err)
	}

	readLoc, err := identRepo.GetLocation(ctx, userID)
	if err != nil {
		t.Fatalf("failed to read back location: %v", err)
	}
	if math.Abs(readLoc.Latitude-37.8044) > 0.001 || math.Abs(readLoc.Longitude-(-122.2712)) > 0.001 {
		t.Fatalf("location coordinates mismatch: lat=%.4f lon=%.4f", readLoc.Latitude, readLoc.Longitude)
	}
	if readLoc.CityName != "Oakland" || readLoc.CountryCode != "US" {
		t.Fatalf("city/country mismatch: city=%s country=%s", readLoc.CityName, readLoc.CountryCode)
	}

	// 2c. Dating preferences with dealbreakers and notification settings
	pref := &identity.DatingPreferences{
		UserID:               userID,
		MinAge:               23,
		MaxAge:               38,
		MaxDistanceKm:        45,
		PreferredGenders:     []string{"non-binary", "transgender woman"},
		PreferredIntents:     []string{"serious dating"},
		VerifiedProfilesOnly: true,
		Dealbreakers: identity.LifestyleDealbreakers{
			NonSmokerOnly:     true,
			RequireVerified:   true,
			RequireMonogamous: true,
		},
		NotificationPreferences: identity.NotificationPreferences{
			MatchesEnabled:          true,
			MessagesEnabled:         true,
			DiscoveryUpdatesEnabled: false,
			BillingAlertsEnabled:    true,
			SecurityAlertsEnabled:   true,
			QuietHoursEnabled:       true,
			QuietHoursStartUTC:      23,
			QuietHoursEndUTC:        7,
		},
		UpdatedAt: now,
	}

	if err := identRepo.UpsertPreferences(ctx, pref); err != nil {
		t.Fatalf("failed to upsert dating preferences: %v", err)
	}

	readPref, err := identRepo.GetPreferences(ctx, userID)
	if err != nil {
		t.Fatalf("failed to read back dating preferences: %v", err)
	}
	if readPref.MinAge != 23 || readPref.MaxAge != 38 || readPref.MaxDistanceKm != 45 {
		t.Fatalf("dating preferences range mismatch: %+v", readPref)
	}
	if !readPref.VerifiedProfilesOnly {
		t.Fatalf("expected verified_profiles_only to be true")
	}
	if !readPref.Dealbreakers.NonSmokerOnly || !readPref.Dealbreakers.RequireVerified || !readPref.Dealbreakers.RequireMonogamous {
		t.Fatalf("dealbreakers mismatch: %+v", readPref.Dealbreakers)
	}
	if !readPref.NotificationPreferences.QuietHoursEnabled || readPref.NotificationPreferences.QuietHoursStartUTC != 23 {
		t.Fatalf("notification preferences mismatch: %+v", readPref.NotificationPreferences)
	}

	t.Log("Profile updates, PostGIS location, and discovery preferences persistence verified successfully against live PostgreSQL!")
}

// 3. Verify Likes, Mutual Matches, and Outbox Event Persistence
func TestPostgres_LikesAndMutualMatchesPersistence(t *testing.T) {
	pg, ctx, cancel := setupLivePostgres(t)
	defer cancel()
	defer pg.Close()

	identRepo := identity.NewPostgresRepository(pg.Pool)
	discRepo := discovery.NewPostgresRepository(pg.Pool)

	runID := time.Now().UnixNano()
	userAID := genTestUUID()
	userBID := genTestUUID()
	now := time.Now().UTC()

	// Seed User A
	userA := &identity.User{
		ID:           userAID,
		Email:        fmt.Sprintf("user_a_%d@auratest.internal", runID),
		PasswordHash: "hash",
		Status:       identity.StatusActive,
		Role:         identity.RoleMember,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := identRepo.CreateUser(ctx, userA); err != nil {
		t.Fatalf("failed to create user A: %v", err)
	}
	bdateA := time.Date(1996, time.March, 10, 0, 0, 0, 0, time.UTC)
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{
		UserID:              userAID,
		DisplayName:         "Alex",
		Birthdate:           bdateA,
		GenderIdentities:    []string{"non-binary"},
		SexualOrientations:  []string{"queer"},
		RelationshipIntents: []string{"serious dating"},
		IsPhotoVerified:     true,
		CreatedAt:           now,
		UpdatedAt:           now,
	})

	// Seed User B
	userB := &identity.User{
		ID:           userBID,
		Email:        fmt.Sprintf("user_b_%d@auratest.internal", runID),
		PasswordHash: "hash",
		Status:       identity.StatusActive,
		Role:         identity.RoleMember,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := identRepo.CreateUser(ctx, userB); err != nil {
		t.Fatalf("failed to create user B: %v", err)
	}
	bdateB := time.Date(1994, time.July, 22, 0, 0, 0, 0, time.UTC)
	_ = identRepo.UpsertProfile(ctx, &identity.Profile{
		UserID:              userBID,
		DisplayName:         "Robin",
		Birthdate:           bdateB,
		GenderIdentities:    []string{"transgender man"},
		SexualOrientations:  []string{"queer"},
		RelationshipIntents: []string{"serious dating"},
		IsPhotoVerified:     true,
		CreatedAt:           now,
		UpdatedAt:           now,
	})

	// 3a. User A swipes LIKE on User B -> no match yet
	isMatch, match, reward, err := discRepo.CreateSwipe(ctx, userAID, userBID, discovery.SwipeLike, "Loved your bio!", "corr-1")
	if err != nil {
		t.Fatalf("User A swipe LIKE failed: %v", err)
	}
	if isMatch || match != nil {
		t.Fatalf("expected no match on initial one-way swipe, got isMatch=%v match=%v", isMatch, match)
	}
	if reward {
		t.Fatalf("expected no reward granted on one-way swipe")
	}

	// 3b. User B swipes LIKE on User A -> reciprocal match formed!
	isMatch, match, reward, err = discRepo.CreateSwipe(ctx, userBID, userAID, discovery.SwipeLike, "Nice to meet you!", "corr-2")
	if err != nil {
		t.Fatalf("User B reciprocal swipe LIKE failed: %v", err)
	}
	if !isMatch || match == nil {
		t.Fatalf("expected mutual match to be created, got isMatch=%v, match=%v", isMatch, match)
	}
	if !reward {
		t.Fatalf("expected match reward to be granted")
	}
	if match.Status != discovery.MatchActive {
		t.Fatalf("expected match status ACTIVE, got: %s", match.Status)
	}

	// 3c. Verify match persistence via GetMatchByID
	persistedMatch, err := discRepo.GetMatchByID(ctx, match.ID, userAID)
	if err != nil {
		t.Fatalf("failed to retrieve match by ID for user A: %v", err)
	}
	if persistedMatch.ID != match.ID {
		t.Fatalf("match ID mismatch: expected %s, got %s", match.ID, persistedMatch.ID)
	}

	// 3d. Verify ListMatches
	matchesA, err := discRepo.ListMatches(ctx, userAID)
	if err != nil {
		t.Fatalf("failed to list matches for user A: %v", err)
	}
	if len(matchesA) == 0 || matchesA[0].ID != match.ID {
		t.Fatalf("expected match in user A list, got %d matches", len(matchesA))
	}

	// 3e. Verify transactional outbox event
	var outboxEventCount int
	err = pg.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM outbox_events
		WHERE aggregate_type = 'MATCH' AND aggregate_id = $1 AND event_type = 'match.created.v1'
	`, match.ID).Scan(&outboxEventCount)
	if err != nil {
		t.Fatalf("failed to check outbox events: %v", err)
	}
	if outboxEventCount != 1 {
		t.Fatalf("expected 1 match.created.v1 outbox event, found: %d", outboxEventCount)
	}

	// 3f. Verify UNLIMITED_SWIPES reward in user_entitlements
	var entitlementCount int
	err = pg.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM user_entitlements
		WHERE user_id IN ($1, $2) AND entitlement_code = 'UNLIMITED_SWIPES' AND source = 'MATCH_REWARD'
	`, userAID, userBID).Scan(&entitlementCount)
	if err != nil {
		t.Fatalf("failed to check entitlements: %v", err)
	}
	if entitlementCount != 2 {
		t.Fatalf("expected 2 UNLIMITED_SWIPES rewards, found: %d", entitlementCount)
	}

	// 3g. Blocking behavior
	if err := discRepo.BlockUser(ctx, userAID, userBID, "harassment_report"); err != nil {
		t.Fatalf("failed to block user: %v", err)
	}

	isBlocked, err := discRepo.IsBlocked(ctx, userAID, userBID)
	if err != nil || !isBlocked {
		t.Fatalf("expected userA -> userB to be blocked, got: %v, err: %v", isBlocked, err)
	}
	isBlockedRev, err := discRepo.IsBlocked(ctx, userBID, userAID)
	if err != nil || !isBlockedRev {
		t.Fatalf("expected bi-directional block to return true for userB -> userA, got: %v, err: %v", isBlockedRev, err)
	}

	// Match should now be marked BLOCKED
	var matchStatus string
	err = pg.Pool.QueryRow(ctx, "SELECT status FROM matches WHERE id = $1", match.ID).Scan(&matchStatus)
	if err != nil {
		t.Fatalf("failed to query match status after block: %v", err)
	}
	if matchStatus != "BLOCKED" {
		t.Fatalf("expected match status BLOCKED after user block, got: %s", matchStatus)
	}

	t.Log("Likes, mutual matches, outbox event, and blocking persistence verified successfully against live PostgreSQL!")
}

// 4. Verify Chat Messages, Idempotency, and Authorization Persistence
func TestPostgres_ChatMessagesAndAuthorizationPersistence(t *testing.T) {
	pg, ctx, cancel := setupLivePostgres(t)
	defer cancel()
	defer pg.Close()

	identRepo := identity.NewPostgresRepository(pg.Pool)
	chatRepo := chat.NewPostgresRepository(pg.Pool)

	runID := time.Now().UnixNano()
	userCID := genTestUUID()
	userDID := genTestUUID()
	userOutsiderID := genTestUUID()
	now := time.Now().UTC()

	// Seed accounts
	for _, u := range []struct {
		id    string
		email string
	}{
		{userCID, fmt.Sprintf("chat_c_%d@auratest.internal", runID)},
		{userDID, fmt.Sprintf("chat_d_%d@auratest.internal", runID)},
		{userOutsiderID, fmt.Sprintf("chat_out_%d@auratest.internal", runID)},
	} {
		_ = identRepo.CreateUser(ctx, &identity.User{
			ID:           u.id,
			Email:        u.email,
			PasswordHash: "hash",
			Status:       identity.StatusActive,
			Role:         identity.RoleMember,
			CreatedAt:    now,
			UpdatedAt:    now,
		})
	}

	// Create active match between User C and User D
	var matchID string
	lowID, highID := userCID, userDID
	if lowID > highID {
		lowID, highID = userDID, userCID
	}
	err := pg.Pool.QueryRow(ctx, `
		INSERT INTO matches (user_low_id, user_high_id, status, matched_at)
		VALUES ($1, $2, 'ACTIVE', NOW())
		RETURNING id
	`, lowID, highID).Scan(&matchID)
	if err != nil {
		t.Fatalf("failed to insert test match: %v", err)
	}

	// 4a. Get or create conversation for match
	conv, err := chatRepo.GetOrCreateConversationForMatch(ctx, matchID)
	if err != nil {
		t.Fatalf("failed to get or create conversation: %v", err)
	}
	if conv.ID == "" || conv.MatchID != matchID {
		t.Fatalf("conversation fields invalid: %+v", conv)
	}

	// 4b. Authorization checks
	isMemberC, err := chatRepo.VerifyConversationMembership(ctx, conv.ID, userCID)
	if err != nil || !isMemberC {
		t.Fatalf("expected user C to be member, got %v, err %v", isMemberC, err)
	}
	isMemberD, err := chatRepo.VerifyConversationMembership(ctx, conv.ID, userDID)
	if err != nil || !isMemberD {
		t.Fatalf("expected user D to be member, got %v, err %v", isMemberD, err)
	}
	isMemberOutsider, err := chatRepo.VerifyConversationMembership(ctx, conv.ID, userOutsiderID)
	if err != nil || isMemberOutsider {
		t.Fatalf("expected outsider to NOT be member, got %v, err %v", isMemberOutsider, err)
	}

	eligible, err := chatRepo.CheckActiveMatchEligibility(ctx, conv.ID, userCID)
	if err != nil || !eligible {
		t.Fatalf("expected user C to be eligible to chat, got %v, err %v", eligible, err)
	}

	// 4c. Save first message
	clientMsgID1 := genTestUUID()
	msg1 := &chat.Message{
		ConversationID:  conv.ID,
		SenderUserID:    userCID,
		ClientMessageID: clientMsgID1,
		Body:            "Hello from user C!",
		MessageType:     chat.MessageTypeText,
	}
	saved1, isDup1, err := chatRepo.SaveMessage(ctx, msg1)
	if err != nil {
		t.Fatalf("failed to save message: %v", err)
	}
	if isDup1 || saved1.ID == "" {
		t.Fatalf("expected successful non-duplicate save, got dup=%v, id=%s", isDup1, saved1.ID)
	}

	// 4d. Idempotent save message (replay with same client_message_id)
	savedDup, isDup2, err := chatRepo.SaveMessage(ctx, msg1)
	if err != nil {
		t.Fatalf("idempotent SaveMessage returned error: %v", err)
	}
	if !isDup2 || savedDup.ID != saved1.ID {
		t.Fatalf("expected duplicate message detection, got isDup=%v, id=%s", isDup2, savedDup.ID)
	}

	// 4e. List messages
	msgs, _, _, err := chatRepo.ListMessages(ctx, conv.ID, "", 10)
	if err != nil {
		t.Fatalf("failed to list messages: %v", err)
	}
	if len(msgs) != 1 || msgs[0].Body != "Hello from user C!" {
		t.Fatalf("unexpected message list: %+v", msgs)
	}

	// 4f. Mark messages read by User D
	markedCount, err := chatRepo.MarkMessagesRead(ctx, conv.ID, userDID)
	if err != nil {
		t.Fatalf("failed to mark messages read: %v", err)
	}
	if markedCount != 1 {
		t.Fatalf("expected 1 message marked read, got: %d", markedCount)
	}

	// 4g. Outbox event verification for message
	var msgOutboxCount int
	err = pg.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM outbox_events
		WHERE aggregate_type = 'conversation' AND aggregate_id = $1 AND event_type = 'messaging.message.sent.v1'
	`, conv.ID).Scan(&msgOutboxCount)
	if err != nil {
		t.Fatalf("failed to query outbox for chat: %v", err)
	}
	if msgOutboxCount != 1 {
		t.Fatalf("expected 1 messaging.message.sent.v1 outbox event, got: %d", msgOutboxCount)
	}

	t.Log("Chat messages, idempotency, read receipts, and authorization persistence verified successfully against live PostgreSQL!")
}

// 5. Verify Media Metadata, Derivatives, and Gallery Ordering Persistence
func TestPostgres_MediaMetadataAndGalleryOrderingPersistence(t *testing.T) {
	pg, ctx, cancel := setupLivePostgres(t)
	defer cancel()
	defer pg.Close()

	identRepo := identity.NewPostgresRepository(pg.Pool)
	mediaRepo := media.NewPostgresRepository(pg.Pool)

	runID := time.Now().UnixNano()
	ownerID := genTestUUID()
	otherUserID := genTestUUID()
	now := time.Now().UTC()

	// Seed users
	_ = identRepo.CreateUser(ctx, &identity.User{
		ID:           ownerID,
		Email:        fmt.Sprintf("media_owner_%d@auratest.internal", runID),
		PasswordHash: "hash",
		Status:       identity.StatusActive,
		Role:         identity.RoleMember,
		CreatedAt:    now,
		UpdatedAt:    now,
	})
	_ = identRepo.CreateUser(ctx, &identity.User{
		ID:           otherUserID,
		Email:        fmt.Sprintf("media_other_%d@auratest.internal", runID),
		PasswordHash: "hash",
		Status:       identity.StatusActive,
		Role:         identity.RoleMember,
		CreatedAt:    now,
		UpdatedAt:    now,
	})

	approvedVerdict := media.VerdictApproved
	w, h := 1080, 1350

	// 5a. Create Asset 1 (display_order = 0)
	asset1 := &media.MediaAsset{
		OwnerUserID:       ownerID,
		MediaType:         media.MediaTypeImage,
		Purpose:           media.PurposeProfileGallery,
		Status:            media.StatusReady,
		QuarantineBucket:  "aura-quarantine",
		QuarantineKey:     fmt.Sprintf("raw/asset1_%d.jpg", runID),
		OriginalSHA256:    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		OriginalMIME:      "image/jpeg",
		OriginalSizeBytes: 1048576,
		WidthPx:           &w,
		HeightPx:          &h,
		ExifStripped:      true,
		ModerationVerdict: &approvedVerdict,
		IdempotencyKey:    fmt.Sprintf("idem_media_1_%d", runID),
		DisplayOrder:      0,
	}
	if err := mediaRepo.CreateAsset(ctx, asset1); err != nil {
		t.Fatalf("failed to create asset 1: %v", err)
	}
	if asset1.ID == "" {
		t.Fatalf("expected asset1 to have generated ID")
	}

	// 5b. Create Asset 2 (display_order = 1)
	asset2 := &media.MediaAsset{
		OwnerUserID:       ownerID,
		MediaType:         media.MediaTypeImage,
		Purpose:           media.PurposeProfileGallery,
		Status:            media.StatusReady,
		QuarantineBucket:  "aura-quarantine",
		QuarantineKey:     fmt.Sprintf("raw/asset2_%d.jpg", runID),
		OriginalSHA256:    "f3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		OriginalMIME:      "image/jpeg",
		OriginalSizeBytes: 2048576,
		WidthPx:           &w,
		HeightPx:          &h,
		ExifStripped:      true,
		ModerationVerdict: &approvedVerdict,
		IdempotencyKey:    fmt.Sprintf("idem_media_2_%d", runID),
		DisplayOrder:      1,
	}
	if err := mediaRepo.CreateAsset(ctx, asset2); err != nil {
		t.Fatalf("failed to create asset 2: %v", err)
	}

	// 5c. Persist Derivatives for Asset 1
	thumbW, thumbH := 300, 375
	dThumb := &media.MediaDerivative{
		MediaAssetID:  asset1.ID,
		Variant:       media.VariantThumbWebP,
		StorageBucket: "aura-media-derivatives",
		StorageKey:    fmt.Sprintf("derivatives/%s/thumb.webp", asset1.ID),
		MimeType:      "image/webp",
		SizeBytes:     14200,
		WidthPx:       &thumbW,
		HeightPx:      &thumbH,
	}
	if err := mediaRepo.SaveDerivative(ctx, dThumb); err != nil {
		t.Fatalf("failed to save derivative: %v", err)
	}

	cardW, cardH := 720, 900
	dCard := &media.MediaDerivative{
		MediaAssetID:  asset1.ID,
		Variant:       media.VariantCardWebP,
		StorageBucket: "aura-media-derivatives",
		StorageKey:    fmt.Sprintf("derivatives/%s/card.webp", asset1.ID),
		MimeType:      "image/webp",
		SizeBytes:     64200,
		WidthPx:       &cardW,
		HeightPx:      &cardH,
	}
	if err := mediaRepo.SaveDerivative(ctx, dCard); err != nil {
		t.Fatalf("failed to save card derivative: %v", err)
	}

	derivs, err := mediaRepo.GetDerivativesByAssetID(ctx, asset1.ID)
	if err != nil {
		t.Fatalf("failed to get derivatives: %v", err)
	}
	if len(derivs) != 2 {
		t.Fatalf("expected 2 derivatives for asset 1, got: %d", len(derivs))
	}

	// 5d. Verify ListUserAssets initial order (Asset 1 then Asset 2)
	galleryPurpose := media.PurposeProfileGallery
	initialAssets, err := mediaRepo.ListUserAssets(ctx, ownerID, &galleryPurpose, true)
	if err != nil {
		t.Fatalf("failed to list user assets: %v", err)
	}
	if len(initialAssets) != 2 {
		t.Fatalf("expected 2 gallery assets, got: %d", len(initialAssets))
	}
	if initialAssets[0].ID != asset1.ID || initialAssets[1].ID != asset2.ID {
		t.Fatalf("initial gallery order mismatch: got [%s, %s], expected [%s, %s]",
			initialAssets[0].ID, initialAssets[1].ID, asset1.ID, asset2.ID)
	}

	// 5e. Reorder gallery (swap Asset 2 to order 0, Asset 1 to order 1)
	if err := mediaRepo.ReorderAssets(ctx, ownerID, []string{asset2.ID, asset1.ID}); err != nil {
		t.Fatalf("failed to reorder assets: %v", err)
	}

	reorderedAssets, err := mediaRepo.ListUserAssets(ctx, ownerID, &galleryPurpose, true)
	if err != nil {
		t.Fatalf("failed to list reordered assets: %v", err)
	}
	if len(reorderedAssets) != 2 {
		t.Fatalf("expected 2 reordered assets, got: %d", len(reorderedAssets))
	}
	if reorderedAssets[0].ID != asset2.ID || reorderedAssets[1].ID != asset1.ID {
		t.Fatalf("reordered gallery order mismatch: got [%s, %s], expected [%s, %s]",
			reorderedAssets[0].ID, reorderedAssets[1].ID, asset2.ID, asset1.ID)
	}
	if reorderedAssets[0].DisplayOrder != 0 || reorderedAssets[1].DisplayOrder != 1 {
		t.Fatalf("display_order field values mismatch: [order=%d, order=%d]",
			reorderedAssets[0].DisplayOrder, reorderedAssets[1].DisplayOrder)
	}

	// 5f. Unauthorized reorder authorization guard
	err = mediaRepo.ReorderAssets(ctx, otherUserID, []string{asset2.ID, asset1.ID})
	if !errors.Is(err, media.ErrUnauthorizedMedia) {
		t.Fatalf("expected ErrUnauthorizedMedia when reordering another user's assets, got: %v", err)
	}

	// 5g. Delete / Purge Asset
	if err := mediaRepo.DeleteAsset(ctx, asset1.ID, ownerID); err != nil {
		t.Fatalf("failed to delete asset 1: %v", err)
	}

	afterDeleteAssets, err := mediaRepo.ListUserAssets(ctx, ownerID, &galleryPurpose, true)
	if err != nil {
		t.Fatalf("failed to list assets after deletion: %v", err)
	}
	if len(afterDeleteAssets) != 1 || afterDeleteAssets[0].ID != asset2.ID {
		t.Fatalf("expected only asset 2 remaining after asset 1 deletion, got: %+v", afterDeleteAssets)
	}

	t.Log("Media metadata, derivatives, and gallery ordering persistence verified successfully against live PostgreSQL!")
}
