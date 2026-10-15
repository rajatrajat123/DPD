package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/auradating/platform/backend/internal/cache"
	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/database"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/server"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	cfg, err := config.LoadFromEnv()
	if err != nil {
		logger.Error("failed_to_load_configuration", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pg, err := database.NewPostgres(ctx, cfg)
	if err != nil {
		logger.Error("failed_to_configure_postgres_pool", slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer pg.Close()

	redisClient, err := cache.NewRedis(cfg)
	if err != nil {
		logger.Error("failed_to_configure_redis_client", slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer func() {
		if err := redisClient.Close(); err != nil {
			logger.Warn("redis_close_error", slog.String("error", err.Error()))
		}
	}()

	var identityRepo identity.Repository
	if err := pg.HealthCheck(ctx); err == nil {
		logger.Info("connected_to_live_postgresql_using_postgres_repository")
		identityRepo = identity.NewPostgresRepository(pg.Pool)
	} else {
		if cfg.Environment == config.EnvProduction || cfg.Environment == config.EnvStaging {
			logger.Error("production_database_unreachable_refusing_in_memory_fallback", slog.String("error", err.Error()))
			os.Exit(1)
		}
		logger.Warn("postgresql_unreachable_in_development_using_in_memory_repository",
			slog.String("error", err.Error()),
		)
		identityRepo = identity.NewMemoryRepository()
	}

	srv := server.New(cfg, logger, pg, redisClient, identityRepo)
	httpServer := srv.HTTPServer()

	errCh := make(chan error, 1)
	go func() {
		logger.Info("starting_aura_api_server",
			slog.String("service", cfg.ServiceName),
			slog.String("version", cfg.Version),
			slog.String("environment", string(cfg.Environment)),
			slog.String("addr", httpServer.Addr),
		)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case <-ctx.Done():
		logger.Info("shutdown_signal_received", slog.String("timeout", cfg.ShutdownTimeout.String()))
	case serveErr := <-errCh:
		if serveErr != nil {
			logger.Error("http_server_failed", slog.String("error", serveErr.Error()))
			os.Exit(1)
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful_shutdown_failed", slog.String("error", err.Error()))
		os.Exit(1)
	}

	if srv.MediaService() != nil {
		srv.MediaService().Stop()
	}

	logger.Info("aura_api_server_stopped_cleanly")
}
