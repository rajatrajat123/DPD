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
	"github.com/auradating/platform/backend/migrations"
)

func main() {
	direction := flag.String("direction", "validate", "Migration action: validate | status | up | down")
	steps := flag.Int("steps", 1, "Number of migrations to roll back when direction=down")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	specs, err := database.LoadAndValidateMigrations(migrations.FS)
	if err != nil {
		logger.Error("migration_validation_failed", slog.String("error", err.Error()))
		os.Exit(1)
	}

	if *direction == "validate" {
		for _, spec := range specs {
			logger.Info("verified_embedded_migration",
				slog.Int("version", spec.Version),
				slog.String("name", spec.Name),
				slog.String("sha256", spec.Checksum),
			)
		}
		logger.Info("all_embedded_migrations_validated_successfully", slog.Int("total_migrations", len(specs)))
		return
	}

	cfg, err := config.LoadFromEnv()
	if err != nil {
		logger.Error("failed_to_load_config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pg, err := database.NewPostgres(ctx, cfg)
	if err != nil {
		logger.Error("failed_to_init_postgres_pool", slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer pg.Close()

	store := database.NewPgxMigrationStore(pg.Pool)
	migrator, err := database.NewMigrator(migrations.FS, store)
	if err != nil {
		logger.Error("failed_to_create_migrator", slog.String("error", err.Error()))
		os.Exit(1)
	}

	switch *direction {
	case "status":
		records, err := migrator.Status(ctx)
		if err != nil {
			logger.Error("failed_to_query_migration_status", slog.String("error", err.Error()))
			os.Exit(1)
		}
		for _, rec := range records {
			state := "PENDING"
			if rec.Applied && rec.AppliedAt != nil {
				state = fmt.Sprintf("APPLIED (%s)", rec.AppliedAt.Format(time.RFC3339))
			}
			logger.Info("migration_status",
				slog.Int("version", rec.Version),
				slog.String("name", rec.Name),
				slog.String("state", state),
				slog.String("checksum", rec.Checksum),
			)
		}
	case "up":
		applied, err := migrator.Up(ctx)
		if err != nil {
			logger.Error("migration_up_failed", slog.String("error", err.Error()))
			os.Exit(1)
		}
		logger.Info("migrations_up_completed", slog.Int("applied_count", applied))
	case "down":
		reverted, err := migrator.Down(ctx, *steps)
		if err != nil {
			logger.Error("migration_down_failed", slog.String("error", err.Error()))
			os.Exit(1)
		}
		logger.Info("migrations_down_completed", slog.Int("reverted_count", reverted))
	default:
		logger.Error("unsupported_migration_direction", slog.String("direction", *direction))
		os.Exit(1)
	}
}
