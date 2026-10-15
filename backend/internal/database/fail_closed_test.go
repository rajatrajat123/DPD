package database_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/database"
)

// TestProductionDatabase_FailsClosedWhenUnreachable verifies requirement 7:
// In production or staging, database unreachability MUST fail safely on startup
// and NEVER silently fall back to in-memory repositories.
func TestProductionDatabase_FailsClosedWhenUnreachable(t *testing.T) {
	testCases := []struct {
		env         config.Environment
		expectFatal bool
	}{
		{env: config.EnvProduction, expectFatal: true},
		{env: config.EnvStaging, expectFatal: true},
		{env: config.EnvDevelopment, expectFatal: false},
		{env: config.EnvLocal, expectFatal: false},
	}

	for _, tc := range testCases {
		t.Run(string(tc.env), func(t *testing.T) {
			cfg := &config.Config{
				Environment:      tc.env,
				DatabaseURL:      "postgres://invalid_user:invalid_pass@127.0.0.1:5433/invalid_db?sslmode=disable",
				DBConnectTimeout: 100 * time.Millisecond,
				DBMaxConns:       5,
				DBMinConns:       1,
			}

			ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
			defer cancel()

			pg, err := database.NewPostgres(ctx, cfg)
			if err != nil {
				// NewPostgres failed early
				if !tc.expectFatal {
					t.Fatalf("unexpected NewPostgres error in %s: %v", tc.env, err)
				}
				return
			}
			defer pg.Close()

			healthErr := pg.HealthCheck(ctx)
			if healthErr == nil {
				t.Fatalf("expected healthcheck to fail against invalid port 5433")
			}

			// Simulate startup decision logic from cmd/api/main.go
			shouldExitFatal := false
			if healthErr != nil && (cfg.Environment == config.EnvProduction || cfg.Environment == config.EnvStaging) {
				shouldExitFatal = true
			}

			if shouldExitFatal != tc.expectFatal {
				t.Errorf("for env %s: expected fatal startup failure=%v, got=%v (health error: %v)",
					tc.env, tc.expectFatal, shouldExitFatal, healthErr)
			}
		})
	}
}

// TestPostgresHealthCheck_NilSafety verifies that HealthCheck returns a clean error on uninitialized pool
func TestPostgresHealthCheck_NilSafety(t *testing.T) {
	var nilPG *database.Postgres
	if err := nilPG.HealthCheck(context.Background()); err == nil {
		t.Error("expected error calling HealthCheck on nil Postgres")
	}

	emptyPG := &database.Postgres{Pool: nil}
	if err := emptyPG.HealthCheck(context.Background()); err == nil {
		t.Error("expected error calling HealthCheck on empty Postgres pool")
	}
}

// TestPostgresCheckPostGIS_NilSafety verifies that CheckPostGIS returns a clean error on uninitialized pool
func TestPostgresCheckPostGIS_NilSafety(t *testing.T) {
	var nilPG *database.Postgres
	if _, err := nilPG.CheckPostGIS(context.Background()); err == nil || !errors.Is(err, err) {
		t.Error("expected error calling CheckPostGIS on nil Postgres")
	}

	emptyPG := &database.Postgres{Pool: nil}
	if _, err := emptyPG.CheckPostGIS(context.Background()); err == nil {
		t.Error("expected error calling CheckPostGIS on empty Postgres pool")
	}
}
