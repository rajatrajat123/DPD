package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/database"
)

func main() {
	verifyOnly := flag.Bool("verify-only", false, "Only verify count and eligibility without inserting records")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	cfg, err := config.LoadFromEnv()
	if err != nil {
		logger.Error("failed_to_load_config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	// 1. Strict safety validation: only development environment and local database
	if err := database.ValidateDevEnvironment(cfg); err != nil {
		logger.Error("safety_validation_failed", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	pg, err := database.NewPostgres(ctx, cfg)
	if err != nil {
		logger.Error("failed_to_connect_to_postgres", slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer pg.Close()

	if err := pg.HealthCheck(ctx); err != nil {
		logger.Error("database_health_check_failed", slog.String("error", err.Error()))
		os.Exit(1)
	}

	if *verifyOnly {
		var seedCount, eligibleCount, nonSeedCount int
		_ = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM users WHERE email LIKE '%@"+database.SeedEmailDomain+"'").Scan(&seedCount)
		_ = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@"+database.SeedEmailDomain+"'").Scan(&nonSeedCount)

		elQuery := `
			SELECT COUNT(DISTINCT u.id)
			FROM users u
			JOIN profiles p ON p.user_id = u.id
			WHERE u.email LIKE '%@` + database.SeedEmailDomain + `'
			  AND u.status = 'ACTIVE'
			  AND p.incognito_enabled = FALSE
			  AND EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate)) >= 18
			  AND (
				  SELECT COUNT(*) FROM media_assets ma 
				  WHERE ma.owner_user_id = u.id 
				    AND ma.purpose = 'PROFILE_GALLERY' 
				    AND ma.status = 'READY' 
				    AND ma.moderation_verdict = 'APPROVED'
			  ) >= 3;
		`
		_ = pg.Pool.QueryRow(ctx, elQuery).Scan(&eligibleCount)

		logger.Info("seed_verification_summary",
			slog.Int("total_seed_profiles", seedCount),
			slog.Int("discovery_eligible_profiles", eligibleCount),
			slog.Int("non_seed_real_users_preserved", nonSeedCount),
			slog.Bool("satisfies_5000_requirement", seedCount == database.TotalSeedProfiles),
		)
		fmt.Printf("Seed Verification: %d seed profiles (%d eligible for Discovery). Preserved %d non-seed accounts.\n",
			seedCount, eligibleCount, nonSeedCount)
		return
	}

	logger.Info("starting_development_seeder",
		slog.Int("target_profiles", database.TotalSeedProfiles),
		slog.String("email_domain", database.SeedEmailDomain),
	)

	stats, err := database.SeedDevProfiles(ctx, pg.Pool, cfg, logger)
	if err != nil {
		logger.Error("seeding_failed", slog.String("error", err.Error()))
		os.Exit(1)
	}

	logger.Info("seeding_completed_successfully",
		slog.Int("target_count", stats.TargetCount),
		slog.Int("created_count", stats.CreatedCount),
		slog.Int("reused_count", stats.ReusedCount),
		slog.Int("eligible_count", stats.EligibleCount),
		slog.Int("non_seed_preserved", stats.NonSeedCount),
		slog.Int64("duration_ms", stats.DurationMs),
	)

	fmt.Printf("\n=== AURA SEED RESULTS ===\n"+
		"Target Profiles:         %d\n"+
		"Newly Created:           %d\n"+
		"Reused / Existing:       %d\n"+
		"Discovery Eligible:      %d\n"+
		"Non-Seed Real Accounts:  %d (Preserved)\n"+
		"Elapsed Time:            %d ms\n"+
		"=========================\n\n",
		stats.TargetCount, stats.CreatedCount, stats.ReusedCount,
		stats.EligibleCount, stats.NonSeedCount, stats.DurationMs,
	)
}
