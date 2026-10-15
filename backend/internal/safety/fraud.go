package safety

import (
	"context"
	"errors"
	"strings"
	"time"
)

const (
	MaxConsecutiveFailedLogins = 5
	LoginLockoutDuration       = 15 * time.Minute
)

var (
	ErrLoginLockoutActive = errors.New("account temporarily locked due to excessive failed login attempts; please try again later")
)

// FraudManager manages login brute-force tracking, account lockouts, and suspicious activity detection.
type FraudManager struct {
	repo Repository
}

func NewFraudManager(repo Repository) *FraudManager {
	return &FraudManager{repo: repo}
}

// CheckLoginAllowed checks if the email or IP is currently locked out from login attempts.
func (f *FraudManager) CheckLoginAllowed(ctx context.Context, email, ipAddress string) error {
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	attempt, err := f.repo.GetLoginAttempt(ctx, normalizedEmail, ipAddress)
	if err != nil {
		return err
	}
	if attempt == nil {
		return nil
	}

	if attempt.LockedUntil != nil && time.Now().UTC().Before(*attempt.LockedUntil) {
		return ErrLoginLockoutActive
	}

	return nil
}

// RecordFailedLogin increments the failed attempt counter and applies a lockout if the threshold is reached.
func (f *FraudManager) RecordFailedLogin(ctx context.Context, email, ipAddress string) (int, *time.Time, error) {
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	return f.repo.RecordFailedLogin(ctx, normalizedEmail, ipAddress, MaxConsecutiveFailedLogins, LoginLockoutDuration)
}

// RecordSuccessfulLogin clears any accumulated failed attempt counter upon valid authentication.
func (f *FraudManager) RecordSuccessfulLogin(ctx context.Context, email, ipAddress string) error {
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	return f.repo.ResetLoginAttempts(ctx, normalizedEmail, ipAddress)
}
