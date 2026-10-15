package notification_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/notification"
)

func setupTestNotification(t *testing.T) (*notification.Service, *notification.MemoryRepository, *notification.MockPushProviderAdapter, *notification.MockPushProviderAdapter) {
	t.Helper()
	repo := notification.NewMemoryRepository()
	apns := notification.NewMockPushProviderAdapter("APNs", true)
	fcm := notification.NewMockPushProviderAdapter("FCM", true)
	svc := notification.NewService(repo, apns, fcm, nil)
	return svc, repo, apns, fcm
}

func TestNotification_ConsentEnforcement(t *testing.T) {
	svc, repo, _, _ := setupTestNotification(t)
	ctx := context.Background()
	userID := "user-consent-1"

	// 1. User opts out of discovery updates and messages
	prefs := identity.DefaultNotificationPreferences()
	prefs.DiscoveryUpdatesEnabled = false
	prefs.MessagesEnabled = false
	prefs.MatchesEnabled = true
	_ = repo.UpdatePreferences(ctx, userID, &prefs)

	// Dispatch message notification -> should be suppressed by consent
	err := svc.SendNotification(ctx, notification.NotificationRequest{
		RecipientUserID: userID,
		Category:        notification.CategoryNewMessage,
		Title:           "New message",
		BodyPreview:     "You have a new message",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	logs, _ := repo.ListNotificationLogs(ctx, userID, 10)
	if len(logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(logs))
	}
	if logs[0].DeliveryStatus != notification.StatusSuppressedConsent {
		t.Errorf("expected SUPPRESSED_CONSENT, got %s", logs[0].DeliveryStatus)
	}

	// Dispatch security alert -> must NOT be suppressed even if user wanted to opt out
	err = svc.SendNotification(ctx, notification.NotificationRequest{
		RecipientUserID: userID,
		Category:        notification.CategorySecurityAlert,
		Title:           "Security Alert",
		BodyPreview:     "New login from unfamiliar device",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	logs2, _ := repo.ListNotificationLogs(ctx, userID, 10)
	if len(logs2) != 2 {
		t.Fatalf("expected 2 logs, got %d", len(logs2))
	}
	if logs2[0].DeliveryStatus != notification.StatusDelivered {
		t.Errorf("expected security alert to be DELIVERED, got %s", logs2[0].DeliveryStatus)
	}
}

func TestNotification_QuietHours(t *testing.T) {
	// 1. Verify IsInQuietHours helper unit logic
	if !notification.IsInQuietHours(23, 22, 8) {
		t.Errorf("23:00 should be in quiet hours 22:00-08:00")
	}
	if !notification.IsInQuietHours(2, 22, 8) {
		t.Errorf("02:00 should be in quiet hours 22:00-08:00")
	}
	if notification.IsInQuietHours(14, 22, 8) {
		t.Errorf("14:00 should NOT be in quiet hours 22:00-08:00")
	}
	if !notification.IsInQuietHours(12, 10, 16) {
		t.Errorf("12:00 should be in quiet hours 10:00-16:00")
	}
	if notification.IsInQuietHours(18, 10, 16) {
		t.Errorf("18:00 should NOT be in quiet hours 10:00-16:00")
	}

	// 2. Integration test with Service
	svc, repo, _, _ := setupTestNotification(t)
	ctx := context.Background()
	userID := "user-quiet-1"

	currentHour := time.Now().UTC().Hour()
	// Set quiet hours to cover current hour
	start := (currentHour - 1 + 24) % 24
	end := (currentHour + 2) % 24

	prefs := identity.DefaultNotificationPreferences()
	prefs.QuietHoursEnabled = true
	prefs.QuietHoursStartUTC = start
	prefs.QuietHoursEndUTC = end
	_ = repo.UpdatePreferences(ctx, userID, &prefs)

	err := svc.SendNotification(ctx, notification.NotificationRequest{
		RecipientUserID: userID,
		Category:        notification.CategoryMatchCreated,
		Title:           "New Match!",
		BodyPreview:     "You have a new mutual match",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	logs, _ := repo.ListNotificationLogs(ctx, userID, 10)
	if len(logs) == 0 {
		t.Fatalf("expected log entry")
	}
	if logs[0].DeliveryStatus != notification.StatusSuppressedQuietHours {
		t.Errorf("expected SUPPRESSED_QUIET_HOURS, got %s", logs[0].DeliveryStatus)
	}

	// Security alert must bypass quiet hours
	_ = svc.SendNotification(ctx, notification.NotificationRequest{
		RecipientUserID: userID,
		Category:        notification.CategorySecurityAlert,
		Title:           "Password changed",
		BodyPreview:     "Your account password was updated",
	})

	logsAfter, _ := repo.ListNotificationLogs(ctx, userID, 10)
	if logsAfter[0].DeliveryStatus != notification.StatusDelivered {
		t.Errorf("expected security alert to bypass quiet hours with DELIVERED, got %s", logsAfter[0].DeliveryStatus)
	}
}

func TestNotification_PushProviderRoutingAndInvalidTokenCleanup(t *testing.T) {
	svc, repo, apns, fcm := setupTestNotification(t)
	ctx := context.Background()
	userID := "user-routing-1"

	// Register iOS token and Android token
	iosToken := "apns-token-xyz"
	androidToken := "fcm-token-abc"
	invalidToken := "fcm-token-bad"

	_ = repo.RegisterPushToken(ctx, userID, iosToken, "IOS", "dev-ios")
	_ = repo.RegisterPushToken(ctx, userID, androidToken, "ANDROID", "dev-android")
	_ = repo.RegisterPushToken(ctx, userID, invalidToken, "ANDROID", "dev-bad")

	fcm.SetTokenInvalid(invalidToken, true)

	err := svc.SendNotification(ctx, notification.NotificationRequest{
		RecipientUserID: userID,
		Category:        notification.CategoryMatchCreated,
		Title:           "New match on Aura!",
		BodyPreview:     "You have a new match",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Check APNs received iOS push
	apnsPushes := apns.GetRecordedPushes()
	if len(apnsPushes) != 1 || apnsPushes[0].Token != iosToken {
		t.Errorf("expected 1 APNs push to %s, got %d", iosToken, len(apnsPushes))
	}

	// Check FCM received valid push
	fcmPushes := fcm.GetRecordedPushes()
	if len(fcmPushes) != 1 || fcmPushes[0].Token != androidToken {
		t.Errorf("expected 1 FCM push to %s, got %d", androidToken, len(fcmPushes))
	}

	// Verify invalid token was automatically deactivated
	activeTokens, _ := repo.ListActivePushTokens(ctx, userID)
	for _, tok := range activeTokens {
		if tok.Token == invalidToken {
			t.Errorf("invalid token %s should have been deactivated (is_active=false)", invalidToken)
		}
	}
	if len(activeTokens) != 2 {
		t.Errorf("expected exactly 2 active tokens remaining, got %d", len(activeTokens))
	}
}

func TestNotification_UnconfiguredProviderTruthfulness(t *testing.T) {
	svc, repo, apns, _ := setupTestNotification(t)
	ctx := context.Background()
	userID := "user-unconf-1"

	// Set APNs to unconfigured
	apns.SetConfigured(false)
	_ = repo.RegisterPushToken(ctx, userID, "token-ios", "IOS", "dev-ios")

	_ = svc.SendNotification(ctx, notification.NotificationRequest{
		RecipientUserID: userID,
		Category:        notification.CategoryMatchCreated,
		Title:           "New Match!",
		BodyPreview:     "New connection waiting",
	})

	logs, _ := repo.ListNotificationLogs(ctx, userID, 10)
	foundUnconfigured := false
	for _, l := range logs {
		if l.Channel == notification.ChannelPushAPNs && l.DeliveryStatus == notification.StatusUnconfigured {
			foundUnconfigured = true
			break
		}
	}
	if !foundUnconfigured {
		t.Errorf("expected truthful UNCONFIGURED status when provider credentials are missing")
	}
}

func TestNotification_Deduplication(t *testing.T) {
	svc, repo, apns, _ := setupTestNotification(t)
	ctx := context.Background()
	userID := "user-dedup-1"
	eventID := "evt-unique-match-12345"

	_ = repo.RegisterPushToken(ctx, userID, "ios-tok-1", "IOS", "dev-1")

	req := notification.NotificationRequest{
		RecipientUserID: userID,
		Category:        notification.CategoryMatchCreated,
		Title:           "Match!",
		BodyPreview:     "You matched",
		EventID:         eventID,
	}

	// Send 1
	_ = svc.SendNotification(ctx, req)
	// Send 2 (duplicate)
	_ = svc.SendNotification(ctx, req)

	// APNs should only receive 1 push, not 2
	pushes := apns.GetRecordedPushes()
	if len(pushes) != 1 {
		t.Errorf("expected deduplication to prevent duplicate push, got %d pushes", len(pushes))
	}
}

func TestNotification_HTTPEndpoints(t *testing.T) {
	svc, _, _, _ := setupTestNotification(t)
	handler := notification.NewHandler(svc)

	jwtSecret := "test-jwt-secret-key-32b-must-be-long-enough"
	authMw := identity.RequireAuth(jwtSecret)

	testUser := &identity.User{
		ID:    "http-notif-user",
		Email: "notif@aura.dating",
		Role:  identity.RoleMember,
	}
	token, _ := identity.GenerateAccessToken(jwtSecret, testUser, 1*time.Hour)

	mux := http.NewServeMux()
	mux.Handle("/api/v1/notifications/preferences", authMw(http.HandlerFunc(handler.Preferences)))
	mux.Handle("/api/v1/notifications/push-token", authMw(http.HandlerFunc(handler.RegisterPushToken)))
	mux.Handle("/api/v1/notifications/logs", authMw(http.HandlerFunc(handler.Logs)))

	// 1. GET /api/v1/notifications/preferences
	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/notifications/preferences", nil)
	getReq.Header.Set("Authorization", "Bearer "+token)
	getRec := httptest.NewRecorder()
	mux.ServeHTTP(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", getRec.Code, getRec.Body.String())
	}

	var prefs identity.NotificationPreferences
	_ = json.Unmarshal(getRec.Body.Bytes(), &prefs)
	if !prefs.MatchesEnabled {
		t.Errorf("expected default MatchesEnabled true")
	}

	// 2. PUT /api/v1/notifications/preferences (update preferences)
	putPayload := `{"quiet_hours_enabled":true,"quiet_hours_start_utc":23,"quiet_hours_end_utc":7}`
	putReq := httptest.NewRequest(http.MethodPut, "/api/v1/notifications/preferences", bytes.NewReader([]byte(putPayload)))
	putReq.Header.Set("Authorization", "Bearer "+token)
	putReq.Header.Set("Content-Type", "application/json")
	putRec := httptest.NewRecorder()
	mux.ServeHTTP(putRec, putReq)

	if putRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from PUT preferences, got %d: %s", putRec.Code, putRec.Body.String())
	}
	var updatedPrefs identity.NotificationPreferences
	_ = json.Unmarshal(putRec.Body.Bytes(), &updatedPrefs)
	if !updatedPrefs.QuietHoursEnabled || updatedPrefs.QuietHoursStartUTC != 23 || updatedPrefs.QuietHoursEndUTC != 7 {
		t.Errorf("preferences update not applied correctly: %+v", updatedPrefs)
	}

	// 3. POST /api/v1/notifications/push-token
	tokenPayload := `{"token":"test-device-token-123","platform":"IOS","device_id":"iphone-15"}`
	tokReq := httptest.NewRequest(http.MethodPost, "/api/v1/notifications/push-token", bytes.NewReader([]byte(tokenPayload)))
	tokReq.Header.Set("Authorization", "Bearer "+token)
	tokReq.Header.Set("Content-Type", "application/json")
	tokRec := httptest.NewRecorder()
	mux.ServeHTTP(tokRec, tokReq)

	if tokRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created from push token register, got %d: %s", tokRec.Code, tokRec.Body.String())
	}

	// 4. GET /api/v1/notifications/logs
	logsReq := httptest.NewRequest(http.MethodGet, "/api/v1/notifications/logs", nil)
	logsReq.Header.Set("Authorization", "Bearer "+token)
	logsRec := httptest.NewRecorder()
	mux.ServeHTTP(logsRec, logsReq)

	if logsRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from logs endpoint, got %d", logsRec.Code)
	}
}
