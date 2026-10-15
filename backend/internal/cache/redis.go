package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/auradating/platform/backend/internal/config"
	"github.com/redis/go-redis/v9"
)

// Redis wraps a go-redis client for rate limiting, session state, and caching.
type Redis struct {
	Client *redis.Client
}

// NewRedis parses the Redis connection URL from Config and initializes the client lazily.
func NewRedis(cfg *config.Config) (*Redis, error) {
	if cfg == nil {
		return nil, fmt.Errorf("config cannot be nil")
	}
	opts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse REDIS_URL: %w", err)
	}

	opts.DialTimeout = 3 * time.Second
	opts.ReadTimeout = 2 * time.Second
	opts.WriteTimeout = 2 * time.Second
	opts.PoolSize = 20

	client := redis.NewClient(opts)
	return &Redis{Client: client}, nil
}

// HealthCheck executes a bounded PING against Redis.
func (r *Redis) HealthCheck(ctx context.Context) error {
	if r == nil || r.Client == nil {
		return fmt.Errorf("redis client is not initialized")
	}

	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	if err := r.Client.Ping(pingCtx).Err(); err != nil {
		return fmt.Errorf("redis ping failed: %w", err)
	}
	return nil
}

// Close gracefully closes the underlying Redis connection pool.
func (r *Redis) Close() error {
	if r != nil && r.Client != nil {
		return r.Client.Close()
	}
	return nil
}
