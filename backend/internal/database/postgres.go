package database

import (
	"context"
	"fmt"
	"time"

	"github.com/auradating/platform/backend/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	Pool *pgxpool.Pool
}

// NewPostgres configures a pgxpool connection pool. Note that pgxpool.NewWithConfig
// initializes the pool lazily so the HTTP server can boot and report liveness (/healthz)
// while readiness (/readyz) reports actual database reachability.
func NewPostgres(ctx context.Context, cfg *config.Config) (*Postgres, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}

	poolCfg.MaxConns = cfg.DBMaxConns
	poolCfg.MinConns = cfg.DBMinConns
	poolCfg.MaxConnLifetime = 30 * time.Minute
	poolCfg.MaxConnIdleTime = 5 * time.Minute
	poolCfg.HealthCheckPeriod = 30 * time.Second
	poolCfg.ConnConfig.ConnectTimeout = cfg.DBConnectTimeout

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("create pgxpool: %w", err)
	}

	return &Postgres{Pool: pool}, nil
}

func (p *Postgres) HealthCheck(ctx context.Context) error {
	if p == nil || p.Pool == nil {
		return fmt.Errorf("postgres pool is not initialized")
	}
	var one int
	if err := p.Pool.QueryRow(ctx, "SELECT 1").Scan(&one); err != nil {
		return fmt.Errorf("postgres ping failed: %w", err)
	}
	return nil
}

func (p *Postgres) CheckPostGIS(ctx context.Context) (string, error) {
	if p == nil || p.Pool == nil {
		return "", fmt.Errorf("postgres pool is not initialized")
	}
	var version string
	if err := p.Pool.QueryRow(ctx, "SELECT PostGIS_Version()").Scan(&version); err != nil {
		return "", fmt.Errorf("postgis extension check failed: %w", err)
	}
	return version, nil
}

func (p *Postgres) Close() {
	if p != nil && p.Pool != nil {
		p.Pool.Close()
	}
}
