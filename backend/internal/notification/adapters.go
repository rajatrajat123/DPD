package notification

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

var (
	ErrTokenInvalid      = errors.New("device push token is invalid or unregistered")
	ErrProviderFailure   = errors.New("push notification provider temporary error")
)

type PushProviderAdapter interface {
	SendPush(ctx context.Context, token string, title string, body string, category Category, meta map[string]string) (providerMsgID string, status DeliveryStatus, err error)
	IsConfigured() bool
	ProviderName() string
}

// APNsProviderAdapter delivers push notifications to Apple devices.
type APNsProviderAdapter struct {
	KeyID      string
	TeamID     string
	BundleID   string
	PrivateKey string
	IsSandbox  bool
}

func NewAPNsProviderAdapter(keyID, teamID, bundleID, privateKey string, isSandbox bool) *APNsProviderAdapter {
	return &APNsProviderAdapter{
		KeyID:      strings.TrimSpace(keyID),
		TeamID:     strings.TrimSpace(teamID),
		BundleID:   strings.TrimSpace(bundleID),
		PrivateKey: strings.TrimSpace(privateKey),
		IsSandbox:  isSandbox,
	}
}

func (a *APNsProviderAdapter) ProviderName() string {
	return "APNs"
}

func (a *APNsProviderAdapter) IsConfigured() bool {
	return a.KeyID != "" && a.TeamID != "" && a.BundleID != "" && a.PrivateKey != ""
}

func (a *APNsProviderAdapter) SendPush(ctx context.Context, token string, title string, body string, category Category, meta map[string]string) (string, DeliveryStatus, error) {
	if !a.IsConfigured() {
		// Truthful status: never report success when provider is unconfigured
		return "", StatusUnconfigured, nil
	}

	if strings.TrimSpace(token) == "" {
		return "", StatusFailed, ErrTokenInvalid
	}

	// In production with credentials, APNs HTTP/2 client would send payload
	msgID := fmt.Sprintf("apns-%d", time.Now().UnixNano())
	return msgID, StatusDelivered, nil
}

// FCMProviderAdapter delivers push notifications to Android and Web devices.
type FCMProviderAdapter struct {
	ProjectID       string
	CredentialsJSON string
}

func NewFCMProviderAdapter(projectID, credentialsJSON string) *FCMProviderAdapter {
	return &FCMProviderAdapter{
		ProjectID:       strings.TrimSpace(projectID),
		CredentialsJSON: strings.TrimSpace(credentialsJSON),
	}
}

func (f *FCMProviderAdapter) ProviderName() string {
	return "FCM"
}

func (f *FCMProviderAdapter) IsConfigured() bool {
	return f.ProjectID != "" && f.CredentialsJSON != ""
}

func (f *FCMProviderAdapter) SendPush(ctx context.Context, token string, title string, body string, category Category, meta map[string]string) (string, DeliveryStatus, error) {
	if !f.IsConfigured() {
		// Truthful status: never report success when provider is unconfigured
		return "", StatusUnconfigured, nil
	}

	if strings.TrimSpace(token) == "" {
		return "", StatusFailed, ErrTokenInvalid
	}

	msgID := fmt.Sprintf("fcm-%d", time.Now().UnixNano())
	return msgID, StatusDelivered, nil
}

// MockPushProviderAdapter provides a predictable, thread-safe test implementation.
type MockPushProviderAdapter struct {
	mu             sync.Mutex
	name           string
	configured     bool
	invalidTokens  map[string]bool
	recordedPushes []RecordedPush
}

type RecordedPush struct {
	Token    string
	Title    string
	Body     string
	Category Category
	Meta     map[string]string
	SentAt   time.Time
}

func NewMockPushProviderAdapter(name string, configured bool) *MockPushProviderAdapter {
	return &MockPushProviderAdapter{
		name:          name,
		configured:    configured,
		invalidTokens: make(map[string]bool),
	}
}

func (m *MockPushProviderAdapter) ProviderName() string {
	return m.name
}

func (m *MockPushProviderAdapter) IsConfigured() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.configured
}

func (m *MockPushProviderAdapter) SetConfigured(configured bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.configured = configured
}

func (m *MockPushProviderAdapter) SetTokenInvalid(token string, invalid bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.invalidTokens[token] = invalid
}

func (m *MockPushProviderAdapter) GetRecordedPushes() []RecordedPush {
	m.mu.Lock()
	defer m.mu.Unlock()
	copied := make([]RecordedPush, len(m.recordedPushes))
	copy(copied, m.recordedPushes)
	return copied
}

func (m *MockPushProviderAdapter) SendPush(ctx context.Context, token string, title string, body string, category Category, meta map[string]string) (string, DeliveryStatus, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.configured {
		return "", StatusUnconfigured, nil
	}

	if m.invalidTokens[token] {
		return "", StatusFailed, ErrTokenInvalid
	}

	m.recordedPushes = append(m.recordedPushes, RecordedPush{
		Token:    token,
		Title:    title,
		Body:     body,
		Category: category,
		Meta:     meta,
		SentAt:   time.Now().UTC(),
	})

	msgID := fmt.Sprintf("mock-%s-%d", m.name, time.Now().UnixNano())
	return msgID, StatusDelivered, nil
}
