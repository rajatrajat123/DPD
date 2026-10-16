package database_test

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/database"
)

func TestSeeder_EnvironmentIsolation_RefusesNonDev(t *testing.T) {
	// 1. Refuse Production
	prodCfg := &config.Config{
		Environment: config.EnvProduction,
		DatabaseURL: "postgres://user:pass@localhost:5432/aura_db",
	}
	if err := database.ValidateDevEnvironment(prodCfg); err == nil {
		t.Fatal("expected seeder to refuse running in production environment")
	}

	// 2. Refuse Staging
	stagingCfg := &config.Config{
		Environment: config.EnvStaging,
		DatabaseURL: "postgres://user:pass@localhost:5432/aura_db",
	}
	if err := database.ValidateDevEnvironment(stagingCfg); err == nil {
		t.Fatal("expected seeder to refuse running in staging environment")
	}

	// 3. Refuse Remote Database Host even if environment claims development
	remoteCfg := &config.Config{
		Environment: config.EnvDevelopment,
		DatabaseURL: "postgres://user:pass@db.production.aura.dating:5432/aura_db",
	}
	if err := database.ValidateDevEnvironment(remoteCfg); err == nil {
		t.Fatal("expected seeder to refuse running on remote database host")
	}

	// 4. Accept Local Development
	devCfg := &config.Config{
		Environment: config.EnvDevelopment,
		DatabaseURL: "postgres://postgres:postgres@localhost:5432/aura_db",
	}
	if err := database.ValidateDevEnvironment(devCfg); err != nil {
		t.Fatalf("expected seeder to accept local dev config, got: %v", err)
	}
}

func TestSeeder_DeterministicIdentifiers(t *testing.T) {
	// User IDs must be valid RFC 4122 v4 deterministic UUIDs
	u1 := database.SeedUserID(1)
	if u1 != "00000000-0000-4000-8000-000000000001" {
		t.Errorf("unexpected seed user ID 1: %s", u1)
	}
	u5000 := database.SeedUserID(5000)
	if u5000 != "00000000-0000-4000-8000-000000005000" {
		t.Errorf("unexpected seed user ID 5000: %s", u5000)
	}

	// Reserved domain must be example.test
	e1 := database.SeedEmail(1)
	if e1 != "seed_00001@example.test" {
		t.Errorf("unexpected seed email 1: %s", e1)
	}
	e5000 := database.SeedEmail(5000)
	if e5000 != "seed_05000@example.test" {
		t.Errorf("unexpected seed email 5000: %s", e5000)
	}

	// Media IDs
	m1 := database.SeedMediaAssetID(1, 0)
	m2 := database.SeedMediaAssetID(1, 1)
	if m1 == m2 {
		t.Errorf("media asset IDs must be distinct")
	}
}

func TestSeeder_EnsureSeedFixturesOnDisk(t *testing.T) {
	tmpDir := t.TempDir()

	err := database.EnsureSeedFixturesOnDisk(tmpDir)
	if err != nil {
		t.Fatalf("failed to ensure seed fixtures: %v", err)
	}

	fixturesDir := filepath.Join(tmpDir, "derivatives", "aura-media-approved", "seed_fixtures")
	files := []string{"thumb_webp.webp", "card_webp.webp", "full_webp.webp"}

	for _, name := range files {
		info, err := os.Stat(filepath.Join(fixturesDir, name))
		if err != nil {
			t.Fatalf("expected fixture %s to exist: %v", name, err)
		}
		if info.Size() == 0 {
			t.Errorf("fixture %s is empty", name)
		}
	}
}

func TestSeeder_LiveDatabase_IdempotencyAndEligibility(t *testing.T) {
	cfg, err := config.LoadFromEnv()
	if err != nil || cfg.DatabaseURL == "" {
		t.Skip("skipping live database test; no configuration available")
	}

	parsed, err := url.Parse(cfg.DatabaseURL)
	if err != nil || (parsed.Hostname() != "localhost" && parsed.Hostname() != "127.0.0.1") {
		t.Skip("skipping live database test; not a local host")
	}

	ctx := context.Background()
	pg, err := database.NewPostgres(ctx, cfg)
	if err != nil || pg.HealthCheck(ctx) != nil {
		t.Skip("skipping live database test; postgres not reachable")
	}
	defer pg.Close()

	// 1. Run seeder first time
	stats1, err := database.SeedDevProfiles(ctx, pg.Pool, cfg, nil)
	if err != nil {
		t.Fatalf("SeedDevProfiles run 1 failed: %v", err)
	}
	if stats1.TargetCount != database.TotalSeedProfiles {
		t.Errorf("expected TargetCount=5000, got %d", stats1.TargetCount)
	}

	// 2. Run seeder second time (must be idempotent: 0 created, all reused)
	stats2, err := database.SeedDevProfiles(ctx, pg.Pool, cfg, nil)
	if err != nil {
		t.Fatalf("SeedDevProfiles run 2 failed: %v", err)
	}
	if stats2.CreatedCount != 0 {
		t.Errorf("expected 0 new records on second run (idempotent), got %d", stats2.CreatedCount)
	}
	if stats2.ReusedCount < database.TotalSeedProfiles {
		t.Errorf("expected at least 5000 reused records on second run, got %d", stats2.ReusedCount)
	}

	// 3. Verify non-seed accounts were preserved
	if stats2.NonSeedCount != stats1.NonSeedCount {
		t.Errorf("non-seed real accounts altered! run 1: %d, run 2: %d", stats1.NonSeedCount, stats2.NonSeedCount)
	}
}

func TestSeeder_FeedPagination_LivePostgres(t *testing.T) {
	cfg, err := config.LoadFromEnv()
	if err != nil || cfg.DatabaseURL == "" {
		t.Skip("skipping live database test; no configuration available")
	}

	parsed, err := url.Parse(cfg.DatabaseURL)
	if err != nil || (parsed.Hostname() != "localhost" && parsed.Hostname() != "127.0.0.1") {
		t.Skip("skipping live database test; not a local host")
	}

	ctx := context.Background()
	pg, err := database.NewPostgres(ctx, cfg)
	if err != nil || pg.HealthCheck(ctx) != nil {
		t.Skip("skipping live database test; postgres not reachable")
	}
	defer pg.Close()

	// Query Discovery candidates for the first seed user
	actorID := database.SeedUserID(1)

	var candidates []struct {
		CandidateID string
		DisplayName string
		PhotoCount  int
	}

	query := `
		SELECT 
			u.id, 
			p.display_name,
			(SELECT COUNT(*) FROM media_assets ma WHERE ma.owner_user_id = u.id AND ma.status = 'READY' AND ma.moderation_verdict = 'APPROVED') AS photo_count
		FROM users u
		JOIN profiles p ON p.user_id = u.id
		WHERE u.id <> $1
		  AND u.status = 'ACTIVE'
		  AND p.incognito_enabled = FALSE
		  AND EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate)) >= 18
		  AND (
			  SELECT COUNT(*) FROM media_assets ma 
			  WHERE ma.owner_user_id = u.id 
			    AND ma.purpose = 'PROFILE_GALLERY' 
			    AND ma.status = 'READY' 
			    AND ma.moderation_verdict = 'APPROVED'
		  ) >= 3
		LIMIT 20;
	`
	rows, err := pg.Pool.Query(ctx, query, actorID)
	if err != nil {
		t.Fatalf("failed to query discovery candidates: %v", err)
	}
	defer rows.Close()

	for rows.Next() {
		var c struct {
			CandidateID string
			DisplayName string
			PhotoCount  int
		}
		if err := rows.Scan(&c.CandidateID, &c.DisplayName, &c.PhotoCount); err != nil {
			t.Fatalf("failed to scan candidate: %v", err)
		}
		candidates = append(candidates, c)
	}

	if len(candidates) != 20 {
		t.Fatalf("expected exactly 20 candidates in first page, got %d", len(candidates))
	}

	for _, cand := range candidates {
		if cand.PhotoCount < 3 {
			t.Errorf("candidate %s has %d photos, expected >= 3", cand.CandidateID, cand.PhotoCount)
		}
		if cand.DisplayName == "" {
			t.Errorf("candidate %s has empty display name", cand.CandidateID)
		}
	}
}
