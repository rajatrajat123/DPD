package chat

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/discovery"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/media"
	"github.com/gorilla/websocket"
)

func setupTestChatSystem(t *testing.T) (*Service, *MemoryRepository, *identity.MemoryRepository, string) {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identRepo := identity.NewMemoryRepository()
	chatRepo := NewMemoryRepository(identRepo)
	hub := NewHub([]string{"*"}, logger)
	notif := NewNotificationDispatcher(chatRepo, logger)
	jwtSecret := "super-secure-test-jwt-secret-at-least-32-chars-long"

	svc := NewService(chatRepo, hub, notif, identRepo, jwtSecret, logger)
	return svc, chatRepo, identRepo, jwtSecret
}

func createTestUser(t *testing.T, identRepo *identity.MemoryRepository, id, email, name string) {
	t.Helper()
	now := time.Now().UTC()
	err := identRepo.CreateUser(context.Background(), &identity.User{
		ID:        id,
		Email:     email,
		Role:      identity.RoleMember,
		CreatedAt: now,
		UpdatedAt: now,
	})
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}

	_ = identRepo.UpsertProfile(context.Background(), &identity.Profile{
		UserID:          id,
		DisplayName:     name,
		Birthdate:       now.AddDate(-28, 0, 0),
		IsPhotoVerified: true,
		UpdatedAt:       now,
	})
}

func TestChat_ConversationMembershipAndCrossUserPrevention(t *testing.T) {
	ctx := context.Background()
	svc, chatRepo, identRepo, _ := setupTestChatSystem(t)

	userA := "usr_alice_01"
	userB := "usr_bob_02"
	userC := "usr_eve_03" // Unauthorized attacker

	createTestUser(t, identRepo, userA, "alice@example.com", "Alice")
	createTestUser(t, identRepo, userB, "bob@example.com", "Bob")
	createTestUser(t, identRepo, userC, "eve@example.com", "Eve")

	// Create match between Alice and Bob
	match := &discovery.Match{
		ID:         "match_alice_bob",
		UserLowID:  userA,
		UserHighID: userB,
		Status:     discovery.MatchActive,
		MatchedAt:  time.Now().UTC(),
	}
	chatRepo.SeedMatch(match)

	conv, err := chatRepo.GetOrCreateConversationForMatch(ctx, match.ID)
	if err != nil {
		t.Fatalf("failed to create conversation: %v", err)
	}

	// 1. Authorized user sends message -> Success
	sendReq := SendMessageRequest{
		ClientMessageID: "msg-client-001",
		Body:            "Hi Bob!",
	}
	msg, err := svc.SendMessage(ctx, userA, conv.ID, sendReq)
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if msg.Body != "Hi Bob!" {
		t.Errorf("expected body 'Hi Bob!', got %q", msg.Body)
	}

	// 2. Unauthorized user Eve tries to send message in Alice & Bob's conversation -> 403 Forbidden
	attackerReq := SendMessageRequest{
		ClientMessageID: "msg-client-attacker",
		Body:            "Sneaky injection",
	}
	_, err = svc.SendMessage(ctx, userC, conv.ID, attackerReq)
	if err == nil || err != ErrUnauthorizedParticipant {
		t.Fatalf("expected ErrUnauthorizedParticipant, got %v", err)
	}

	// 3. Unauthorized user Eve tries to read messages -> 403 Forbidden
	_, err = svc.GetMessages(ctx, conv.ID, userC, "", 50)
	if err == nil || err != ErrUnauthorizedParticipant {
		t.Fatalf("expected ErrUnauthorizedParticipant, got %v", err)
	}
}

func TestChat_UnmatchAndBlockImmediateRevocation(t *testing.T) {
	ctx := context.Background()
	svc, chatRepo, identRepo, _ := setupTestChatSystem(t)

	userA := "usr_alice_01"
	userB := "usr_bob_02"

	createTestUser(t, identRepo, userA, "alice@example.com", "Alice")
	createTestUser(t, identRepo, userB, "bob@example.com", "Bob")

	match := &discovery.Match{
		ID:         "match_alice_bob",
		UserLowID:  userA,
		UserHighID: userB,
		Status:     discovery.MatchActive,
		MatchedAt:  time.Now().UTC(),
	}
	chatRepo.SeedMatch(match)

	conv, err := chatRepo.GetOrCreateConversationForMatch(ctx, match.ID)
	if err != nil {
		t.Fatalf("failed to get conversation: %v", err)
	}

	// Message succeeds before block
	_, err = svc.SendMessage(ctx, userA, conv.ID, SendMessageRequest{
		ClientMessageID: "msg-001",
		Body:            "Hello!",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Simulate Alice blocks Bob
	chatRepo.SeedBlock(userA, userB)

	// Bob attempts to message Alice -> Forbidden
	_, err = svc.SendMessage(ctx, userB, conv.ID, SendMessageRequest{
		ClientMessageID: "msg-002",
		Body:            "Are you there?",
	})
	if err == nil || err != ErrMatchInactive {
		t.Fatalf("expected ErrMatchInactive after block, got %v", err)
	}

	// Bob attempts to get messages -> Forbidden
	_, err = svc.GetMessages(ctx, conv.ID, userB, "", 50)
	if err == nil || err != ErrMatchInactive {
		t.Fatalf("expected ErrMatchInactive for reading messages after block, got %v", err)
	}
}

func TestChat_DurablePersistenceAndIdempotency(t *testing.T) {
	ctx := context.Background()
	svc, chatRepo, identRepo, _ := setupTestChatSystem(t)

	userA := "usr_alice_01"
	userB := "usr_bob_02"

	createTestUser(t, identRepo, userA, "alice@example.com", "Alice")
	createTestUser(t, identRepo, userB, "bob@example.com", "Bob")

	match := &discovery.Match{
		ID:         "match_alice_bob",
		UserLowID:  userA,
		UserHighID: userB,
		Status:     discovery.MatchActive,
		MatchedAt:  time.Now().UTC(),
	}
	chatRepo.SeedMatch(match)
	conv, _ := chatRepo.GetOrCreateConversationForMatch(ctx, match.ID)

	clientMsgID := "idempotent-uuid-999"
	req := SendMessageRequest{
		ClientMessageID: clientMsgID,
		Body:            "Durable test message",
	}

	// 1. Initial send
	msg1, err := svc.SendMessage(ctx, userA, conv.ID, req)
	if err != nil {
		t.Fatalf("failed initial send: %v", err)
	}

	// Outbox event was generated
	outbox1 := chatRepo.GetOutboxEvents()
	if len(outbox1) != 1 {
		t.Fatalf("expected 1 outbox event, got %d", len(outbox1))
	}

	// 2. Duplicate send with same client_message_id
	msg2, err := svc.SendMessage(ctx, userA, conv.ID, req)
	if err != nil {
		t.Fatalf("failed duplicate send: %v", err)
	}

	// Must return the exact same message ID
	if msg1.ID != msg2.ID {
		t.Fatalf("expected same message ID %q, got %q", msg1.ID, msg2.ID)
	}

	// Must NOT create a duplicate outbox event
	outbox2 := chatRepo.GetOutboxEvents()
	if len(outbox2) != 1 {
		t.Fatalf("expected outbox event count to remain 1, got %d", len(outbox2))
	}

	// Messages count in conversation must remain 1
	page, err := svc.GetMessages(ctx, conv.ID, userA, "", 50)
	if err != nil || len(page.Messages) != 1 {
		t.Fatalf("expected exactly 1 message in conversation, got %d", len(page.Messages))
	}
}

func TestChat_CursorPaginationAndOrdering(t *testing.T) {
	ctx := context.Background()
	svc, chatRepo, identRepo, _ := setupTestChatSystem(t)

	userA := "usr_alice_01"
	userB := "usr_bob_02"
	createTestUser(t, identRepo, userA, "alice@example.com", "Alice")
	createTestUser(t, identRepo, userB, "bob@example.com", "Bob")

	match := &discovery.Match{
		ID:         "match_alice_bob",
		UserLowID:  userA,
		UserHighID: userB,
		Status:     discovery.MatchActive,
		MatchedAt:  time.Now().UTC(),
	}
	chatRepo.SeedMatch(match)
	conv, _ := chatRepo.GetOrCreateConversationForMatch(ctx, match.ID)

	// Send 5 messages sequentially
	for i := 1; i <= 5; i++ {
		_, err := svc.SendMessage(ctx, userA, conv.ID, SendMessageRequest{
			ClientMessageID: strings.Repeat(string(rune('a'+i)), 10),
			Body:            strings.Repeat("word ", i),
		})
		if err != nil {
			t.Fatalf("failed to send message %d: %v", i, err)
		}
	}

	// Page 1: limit 2
	page1, err := svc.GetMessages(ctx, conv.ID, userA, "", 2)
	if err != nil {
		t.Fatalf("failed page 1: %v", err)
	}
	if len(page1.Messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(page1.Messages))
	}
	if !page1.HasMore {
		t.Errorf("expected has_more to be true")
	}

	// Page 2: before cursor
	page2, err := svc.GetMessages(ctx, conv.ID, userA, page1.NextCursor, 2)
	if err != nil {
		t.Fatalf("failed page 2: %v", err)
	}
	if len(page2.Messages) != 2 {
		t.Fatalf("expected 2 messages on page 2, got %d", len(page2.Messages))
	}

	// Verify chronological ordering
	if page1.Messages[0].CreatedAt.After(page1.Messages[1].CreatedAt) {
		t.Errorf("expected messages to be chronologically ordered")
	}
}

func TestChat_WebSocketAuthenticationAndFrames(t *testing.T) {
	svc, chatRepo, identRepo, jwtSecret := setupTestChatSystem(t)

	userA := "usr_alice_01"
	userB := "usr_bob_02"
	createTestUser(t, identRepo, userA, "alice@example.com", "Alice")
	createTestUser(t, identRepo, userB, "bob@example.com", "Bob")

	match := &discovery.Match{
		ID:         "match_alice_bob",
		UserLowID:  userA,
		UserHighID: userB,
		Status:     discovery.MatchActive,
		MatchedAt:  time.Now().UTC(),
	}
	chatRepo.SeedMatch(match)
	conv, _ := chatRepo.GetOrCreateConversationForMatch(context.Background(), match.ID)

	handler := NewHandler(svc, jwtSecret)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/ws") {
			handler.WebSocketUpgrade(w, r)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/v1/ws"

	// 1. Unauthenticated connection attempt -> Rejected with 401
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatalf("expected dial to fail without token")
	}
	if resp != nil && resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized, got %d", resp.StatusCode)
	}

	// 2. Connect Bob with valid JWT
	bobToken, _ := identity.GenerateAccessToken(jwtSecret, &identity.User{
		ID:    userB,
		Email: "bob@example.com",
		Role:  identity.RoleMember,
	}, 15*time.Minute)

	bobConn, _, err := websocket.DefaultDialer.Dial(wsURL+"?token="+bobToken, nil)
	if err != nil {
		t.Fatalf("failed to dial WebSocket for Bob: %v", err)
	}
	defer bobConn.Close()

	// Verify Bob is online in hub (allow brief registration window)
	bobOnline := false
	for i := 0; i < 20; i++ {
		if svc.Hub().IsUserOnline(userB) {
			bobOnline = true
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !bobOnline {
		t.Errorf("expected Bob to be registered online in Hub")
	}

	// 3. Connect Alice with valid JWT
	aliceToken, _ := identity.GenerateAccessToken(jwtSecret, &identity.User{
		ID:    userA,
		Email: "alice@example.com",
		Role:  identity.RoleMember,
	}, 15*time.Minute)

	aliceConn, _, err := websocket.DefaultDialer.Dial(wsURL+"?token="+aliceToken, nil)
	if err != nil {
		t.Fatalf("failed to dial WebSocket for Alice: %v", err)
	}
	defer aliceConn.Close()

	// 4. Test Ping / Pong over WebSocket
	pingFrame := WSClientMessage{Action: ActionPing}
	if err := aliceConn.WriteJSON(pingFrame); err != nil {
		t.Fatalf("failed to send ping: %v", err)
	}

	var pongResp WSServerMessage
	if err := aliceConn.ReadJSON(&pongResp); err != nil {
		t.Fatalf("failed to read pong: %v", err)
	}
	if pongResp.Type != EventPong {
		t.Errorf("expected EventPong, got %q", pongResp.Type)
	}

	// 5. Test Typing Indicator: Alice types -> Bob receives typing.indicator
	typingFrame := WSClientMessage{
		Action:         ActionTypingStart,
		ConversationID: conv.ID,
	}
	if err := aliceConn.WriteJSON(typingFrame); err != nil {
		t.Fatalf("failed to send typing indicator: %v", err)
	}

	var bobTypingEvent WSServerMessage
	_ = bobConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if err := bobConn.ReadJSON(&bobTypingEvent); err != nil {
		t.Fatalf("Bob failed to receive typing event: %v", err)
	}
	if bobTypingEvent.Type != EventTypingIndicator {
		t.Errorf("expected EventTypingIndicator, got %q", bobTypingEvent.Type)
	}

	// 6. Test Real-Time Message Send: Alice sends message -> Bob receives message.new, Alice receives message.delivered
	msgFrame := WSClientMessage{
		Action:          ActionMessageSend,
		ConversationID:  conv.ID,
		ClientMessageID: "ws-client-msg-1234",
		Body:            "Real-time greeting over WebSocket!",
	}
	if err := aliceConn.WriteJSON(msgFrame); err != nil {
		t.Fatalf("failed to send message frame: %v", err)
	}

	// Bob receives message.new
	var bobMsgEvent WSServerMessage
	_ = bobConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if err := bobConn.ReadJSON(&bobMsgEvent); err != nil {
		t.Fatalf("Bob failed to receive message.new: %v", err)
	}
	if bobMsgEvent.Type != EventMessageNew {
		t.Errorf("expected EventMessageNew, got %q", bobMsgEvent.Type)
	}

	var receivedMsg Message
	_ = json.Unmarshal(bobMsgEvent.Payload, &receivedMsg)
	if receivedMsg.Body != "Real-time greeting over WebSocket!" {
		t.Errorf("unexpected body: %q", receivedMsg.Body)
	}

	// Alice receives message.delivered
	var aliceAckEvent WSServerMessage
	_ = aliceConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if err := aliceConn.ReadJSON(&aliceAckEvent); err != nil {
		t.Fatalf("Alice failed to receive delivery ack: %v", err)
	}
	if aliceAckEvent.Type != EventMessageDelivered {
		t.Errorf("expected EventMessageDelivered, got %q", aliceAckEvent.Type)
	}
}

func TestChat_PrivacySafeNotifications(t *testing.T) {
	ctx := context.Background()
	svc, chatRepo, identRepo, _ := setupTestChatSystem(t)

	userA := "usr_alice_01"
	userB := "usr_bob_02"
	createTestUser(t, identRepo, userA, "alice@example.com", "Alice")
	createTestUser(t, identRepo, userB, "bob@example.com", "Bob")

	match := &discovery.Match{
		ID:         "match_alice_bob",
		UserLowID:  userA,
		UserHighID: userB,
		Status:     discovery.MatchActive,
		MatchedAt:  time.Now().UTC(),
	}
	chatRepo.SeedMatch(match)
	conv, _ := chatRepo.GetOrCreateConversationForMatch(ctx, match.ID)

	// Bob is offline (not connected to WS).
	// Alice sends a private message with sensitive text.
	sensitiveBody := "Meet me at the queer community cafe tomorrow at 5!"
	_, err := svc.SendMessage(ctx, userA, conv.ID, SendMessageRequest{
		ClientMessageID: "notif-test-001",
		Body:            sensitiveBody,
	})
	if err != nil {
		t.Fatalf("failed to send message: %v", err)
	}

	// Verify notification log
	if len(chatRepo.notifLogs) == 0 {
		t.Fatalf("expected notification logs to be generated for offline recipient")
	}

	for _, log := range chatRepo.notifLogs {
		bodyPreview, _ := log["body_preview"].(string)
		title, _ := log["title"].(string)

		// Verification: Sensitive body text must NEVER appear in push preview
		if strings.Contains(bodyPreview, sensitiveBody) {
			t.Errorf("PRIVACY VIOLATION: raw message body leaked in notification preview: %q", bodyPreview)
		}
		if strings.Contains(title, sensitiveBody) {
			t.Errorf("PRIVACY VIOLATION: raw message body leaked in notification title: %q", title)
		}

		// Must use generic privacy-safe copy
		if !strings.Contains(bodyPreview, "You have a new message from Alice") {
			t.Errorf("expected privacy-safe preview, got %q", bodyPreview)
		}
	}
}

func TestChat_WebSocketOriginValidation(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identRepo := identity.NewMemoryRepository()
	chatRepo := NewMemoryRepository(identRepo)
	// Notice: allowed origins includes explicit origin AND wildcard '*' to test wildcard rejection
	hub := NewHub([]string{"http://localhost:3000", "*"}, logger)
	notif := NewNotificationDispatcher(chatRepo, logger)
	jwtSecret := "super-secure-test-jwt-secret-at-least-32-chars-long"
	svc := NewService(chatRepo, hub, notif, identRepo, jwtSecret, logger)

	userID := "usr_test_ws_origin"
	createTestUser(t, identRepo, userID, "origin_test@example.com", "OriginTester")
	token, _ := identity.GenerateAccessToken(jwtSecret, &identity.User{
		ID:    userID,
		Email: "origin_test@example.com",
		Role:  identity.RoleMember,
	}, 15*time.Minute)

	handler := NewHandler(svc, jwtSecret)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handler.WebSocketUpgrade(w, r)
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "?token=" + token

	// 1. Allowed Origin succeeds
	headerAllowed := make(http.Header)
	headerAllowed.Set("Origin", "http://localhost:3000")
	conn1, _, err := websocket.DefaultDialer.Dial(wsURL, headerAllowed)
	if err != nil {
		t.Fatalf("expected allowed origin to succeed, got: %v", err)
	}
	_ = conn1.Close()

	// 2. Non-browser request (empty Origin header) succeeds
	conn2, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("expected non-browser request without Origin to succeed, got: %v", err)
	}
	_ = conn2.Close()

	// 3. Untrusted origin is rejected even though wildcard '*' was in allowed list
	headerEvil := make(http.Header)
	headerEvil.Set("Origin", "https://malicious-website.com")
	_, respEvil, err := websocket.DefaultDialer.Dial(wsURL, headerEvil)
	if err == nil {
		t.Fatalf("expected untrusted origin to be rejected by checkOrigin")
	}
	if respEvil != nil && respEvil.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for bad origin, got: %d", respEvil.StatusCode)
	}
}

func TestChat_EqualTimestampsAndDeterministicOrdering(t *testing.T) {
	ctx := context.Background()
	svc, chatRepo, identRepo, _ := setupTestChatSystem(t)

	userA := "usr_phoneA_01"
	userB := "usr_phoneB_02"
	createTestUser(t, identRepo, userA, "phoneA@example.com", "Phone A User")
	createTestUser(t, identRepo, userB, "phoneB@example.com", "Phone B User")

	match := &discovery.Match{
		ID:         "match_phoneA_phoneB",
		UserLowID:  userA,
		UserHighID: userB,
		Status:     discovery.MatchActive,
		MatchedAt:  time.Now().UTC(),
	}
	chatRepo.SeedMatch(match)
	conv, err := chatRepo.GetOrCreateConversationForMatch(ctx, match.ID)
	if err != nil {
		t.Fatalf("failed to create conversation: %v", err)
	}

	// 1. Phone A sends Message 1
	msg1, err := svc.SendMessage(ctx, userA, conv.ID, SendMessageRequest{
		ClientMessageID: "phoneA-msg-001",
		Body:            "Message 1 from Phone A",
	})
	if err != nil {
		t.Fatalf("failed Phone A message 1: %v", err)
	}

	// 2. Phone B replies with Message 2
	msg2, err := svc.SendMessage(ctx, userB, conv.ID, SendMessageRequest{
		ClientMessageID: "phoneB-msg-002",
		Body:            "Message 2 from Phone B",
	})
	if err != nil {
		t.Fatalf("failed Phone B message 2: %v", err)
	}

	// 3. Phone A replies with Message 3
	msg3, err := svc.SendMessage(ctx, userA, conv.ID, SendMessageRequest{
		ClientMessageID: "phoneA-msg-003",
		Body:            "Message 3 from Phone A",
	})
	if err != nil {
		t.Fatalf("failed Phone A message 3: %v", err)
	}

	// Query conversation messages
	page, err := svc.GetMessages(ctx, conv.ID, userA, "", 50)
	if err != nil {
		t.Fatalf("failed to get messages: %v", err)
	}

	if len(page.Messages) != 3 {
		t.Fatalf("expected 3 messages, got %d", len(page.Messages))
	}

	// Chronological contract: oldest first, newest last
	if page.Messages[0].ID != msg1.ID {
		t.Errorf("expected first message to be %s (Message 1), got %s", msg1.ID, page.Messages[0].ID)
	}
	if page.Messages[1].ID != msg2.ID {
		t.Errorf("expected second message to be %s (Message 2), got %s", msg2.ID, page.Messages[1].ID)
	}
	if page.Messages[2].ID != msg3.ID {
		t.Errorf("expected third message to be %s (Message 3), got %s", msg3.ID, page.Messages[2].ID)
	}

	// 4. Test pagination cursor with NextCursor
	paged, err := svc.GetMessages(ctx, conv.ID, userA, "", 2)
	if err != nil {
		t.Fatalf("failed paged fetch: %v", err)
	}
	if len(paged.Messages) != 2 {
		t.Fatalf("expected 2 messages in page 1, got %d", len(paged.Messages))
	}
	// The 2 newest messages in chronological order: msg2 and msg3
	if paged.Messages[0].ID != msg2.ID || paged.Messages[1].ID != msg3.ID {
		t.Errorf("expected paged messages to be msg2 and msg3, got %s and %s", paged.Messages[0].ID, paged.Messages[1].ID)
	}

	// Older page before NextCursor
	olderPage, err := svc.GetMessages(ctx, conv.ID, userA, paged.NextCursor, 2)
	if err != nil {
		t.Fatalf("failed olderPage fetch: %v", err)
	}
	if len(olderPage.Messages) != 1 || olderPage.Messages[0].ID != msg1.ID {
		t.Errorf("expected olderPage message to be msg1, got %v", olderPage.Messages)
	}
}

func TestChat_PhotoAndVideoAttachmentSharingAndAuthorization(t *testing.T) {
	ctx := context.Background()
	svc, chatRepo, identRepo, _ := setupTestChatSystem(t)

	// Set up isolated media service
	tempDir := t.TempDir()
	storage, err := media.NewFileStorageEngine(tempDir, "test-media-signing-secret-key-32b-long")
	if err != nil {
		t.Fatalf("failed to create storage engine: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	processor := media.NewProcessor(logger, 15*1024*1024, 100*1024*1024)
	mediaRepo := media.NewMemoryRepository()
	mediaSvc := media.NewService(mediaRepo, storage, processor, logger)
	t.Cleanup(func() {
		mediaSvc.Stop()
	})
	// Connect attachment authorization checker
	mediaSvc.SetAttachmentAccessChecker(chatRepo.CanAccessMediaAsset)

	userA := "usr_photo_sender"
	userB := "usr_photo_recipient"
	userC := "usr_unrelated_third_party"
	createTestUser(t, identRepo, userA, "sender@example.com", "Sender A")
	createTestUser(t, identRepo, userB, "recipient@example.com", "Recipient B")
	createTestUser(t, identRepo, userC, "intruder@example.com", "Intruder C")

	match := &discovery.Match{
		ID:         "match_media_sharing",
		UserLowID:  userA,
		UserHighID: userB,
		Status:     discovery.MatchActive,
		MatchedAt:  time.Now().UTC(),
	}
	chatRepo.SeedMatch(match)
	conv, err := chatRepo.GetOrCreateConversationForMatch(ctx, match.ID)
	if err != nil {
		t.Fatalf("failed to create conversation: %v", err)
	}

	// 1. UserA uploads a photo attachment
	testJPEG := media.GenerateTestJPEG(640, 800)
	photoAsset, err := mediaSvc.UploadDirect(
		ctx,
		userA,
		string(media.PurposeChatAttachment),
		string(media.MediaTypeImage),
		"beach.jpg",
		bytes.NewReader(testJPEG),
		int64(len(testJPEG)),
		"idemp_photo_001",
	)
	if err != nil {
		t.Fatalf("failed to upload chat photo: %v", err)
	}
	if photoAsset.Status != media.StatusReady {
		t.Fatalf("expected photo asset status READY, got %s", photoAsset.Status)
	}

	// 2. UserA uploads an MP4 video attachment
	dummyMP4 := make([]byte, 1024)
	copy(dummyMP4[0:4], []byte{0x00, 0x00, 0x04, 0x00})
	copy(dummyMP4[4:8], []byte("ftyp"))
	copy(dummyMP4[8:12], []byte("mp42"))
	videoAsset, err := mediaSvc.UploadDirect(
		ctx,
		userA,
		string(media.PurposeChatAttachment),
		string(media.MediaTypeVideo),
		"sunset.mp4",
		bytes.NewReader(dummyMP4),
		int64(len(dummyMP4)),
		"idemp_video_001",
	)
	if err != nil {
		t.Fatalf("failed to upload chat video: %v", err)
	}
	if videoAsset.Status != media.StatusReady {
		t.Fatalf("expected video asset status READY, got %s", videoAsset.Status)
	}

	// 3. UserA sends photo message
	photoMsg, err := svc.SendMessage(ctx, userA, conv.ID, SendMessageRequest{
		ClientMessageID: "client_photo_001",
		Body:            "Here is the photo!",
		MessageType:     string(MessageTypeImage),
		MediaAssetID:    &photoAsset.ID,
	})
	if err != nil {
		t.Fatalf("failed to send photo message: %v", err)
	}
	if photoMsg.MessageType != MessageTypeImage {
		t.Errorf("expected MessageTypeImage, got %s", photoMsg.MessageType)
	}
	if photoMsg.MediaAssetID == nil || *photoMsg.MediaAssetID != photoAsset.ID {
		t.Errorf("expected MediaAssetID %s, got %v", photoAsset.ID, photoMsg.MediaAssetID)
	}

	// 4. UserA sends video message (without text body, only video attachment)
	videoMsg, err := svc.SendMessage(ctx, userA, conv.ID, SendMessageRequest{
		ClientMessageID: "client_video_002",
		Body:            "",
		MessageType:     string(MessageTypeVideo),
		MediaAssetID:    &videoAsset.ID,
	})
	if err != nil {
		t.Fatalf("failed to send video message: %v", err)
	}
	if videoMsg.MessageType != MessageTypeVideo {
		t.Errorf("expected MessageTypeVideo, got %s", videoMsg.MessageType)
	}

	// 5. Authorization verification:
	// A) Sender (UserA) can access asset with derivatives
	senderPhotoView, err := mediaSvc.GetAssetWithDerivatives(ctx, photoAsset.ID, userA)
	if err != nil {
		t.Fatalf("sender should be authorized to access their photo asset: %v", err)
	}
	if len(senderPhotoView.Derivatives) == 0 {
		t.Errorf("expected photo derivatives for sender")
	}

	// B) Recipient (UserB) can access asset with derivatives
	recipientPhotoView, err := mediaSvc.GetAssetWithDerivatives(ctx, photoAsset.ID, userB)
	if err != nil {
		t.Fatalf("recipient should be authorized to access conversation photo attachment: %v", err)
	}
	if len(recipientPhotoView.Derivatives) == 0 {
		t.Errorf("expected photo derivatives for recipient")
	}

	recipientVideoView, err := mediaSvc.GetAssetWithDerivatives(ctx, videoAsset.ID, userB)
	if err != nil {
		t.Fatalf("recipient should be authorized to access conversation video attachment: %v", err)
	}
	if len(recipientVideoView.Derivatives) == 0 {
		t.Errorf("expected video derivatives for recipient")
	}

	// C) Unauthorized UserC must be REJECTED with ErrUnauthorizedMedia
	_, err = mediaSvc.GetAssetWithDerivatives(ctx, photoAsset.ID, userC)
	if err == nil {
		t.Errorf("expected unauthorized UserC to be rejected with error, got nil")
	}
	if !errors.Is(err, media.ErrUnauthorizedMedia) {
		t.Errorf("expected ErrUnauthorizedMedia for UserC, got: %v", err)
	}

	_, err = mediaSvc.GetAssetWithDerivatives(ctx, videoAsset.ID, userC)
	if !errors.Is(err, media.ErrUnauthorizedMedia) {
		t.Errorf("expected ErrUnauthorizedMedia for video attachment access by UserC, got: %v", err)
	}

	// D) Unauthenticated caller ("") must also be rejected
	_, err = mediaSvc.GetAssetWithDerivatives(ctx, photoAsset.ID, "")
	if !errors.Is(err, media.ErrUnauthorizedMedia) {
		t.Errorf("expected ErrUnauthorizedMedia for unauthenticated request, got: %v", err)
	}
}

func TestChat_ListConversationsEnrichesAvatarURL(t *testing.T) {
	ctx := context.Background()
	svc, chatRepo, identRepo, _ := setupTestChatSystem(t)

	tempDir := t.TempDir()
	storage, err := media.NewFileStorageEngine(tempDir, "test-media-signing-secret-key-32b-long")
	if err != nil {
		t.Fatalf("failed to create storage engine: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	processor := media.NewProcessor(logger, 15*1024*1024, 100*1024*1024)
	mediaRepo := media.NewMemoryRepository()
	mediaSvc := media.NewService(mediaRepo, storage, processor, logger)
	t.Cleanup(func() {
		mediaSvc.Stop()
	})
	svc.SetMediaService(mediaSvc)

	userA := "usr_avatar_a"
	userB := "usr_avatar_b"
	createTestUser(t, identRepo, userA, "userA@example.com", "Alice")
	createTestUser(t, identRepo, userB, "userB@example.com", "Bob")

	match := &discovery.Match{
		ID:         "match_avatar_1",
		UserLowID:  userA,
		UserHighID: userB,
		Status:     discovery.MatchActive,
		MatchedAt:  time.Now().UTC(),
	}
	chatRepo.SeedMatch(match)
	conv, err := chatRepo.GetOrCreateConversationForMatch(ctx, match.ID)
	if err != nil {
		t.Fatalf("failed to create conversation: %v", err)
	}

	// Upload gallery photo for UserB
	testJPEG := media.GenerateTestJPEG(640, 800)
	_, err = mediaSvc.UploadDirect(
		ctx,
		userB,
		string(media.PurposeProfileGallery),
		string(media.MediaTypeImage),
		"bob_avatar.jpg",
		bytes.NewReader(testJPEG),
		int64(len(testJPEG)),
		"idemp_avatar_b",
	)
	if err != nil {
		t.Fatalf("failed to upload avatar for UserB: %v", err)
	}

	// UserA lists conversations: partner (UserB) must have non-empty AvatarURL
	convs, err := svc.ListConversations(ctx, userA)
	if err != nil {
		t.Fatalf("ListConversations failed: %v", err)
	}
	if len(convs) != 1 {
		t.Fatalf("expected 1 conversation, got %d", len(convs))
	}
	if convs[0].ID != conv.ID {
		t.Errorf("expected conv ID %s, got %s", conv.ID, convs[0].ID)
	}
	if convs[0].Partner == nil {
		t.Fatalf("expected non-nil Partner")
	}
	if convs[0].Partner.AvatarURL == "" {
		t.Errorf("expected partner AvatarURL to be enriched from gallery media, got empty string")
	}
}


