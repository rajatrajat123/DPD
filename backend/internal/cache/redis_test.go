package cache

import (
	"context"
	"testing"

	"github.com/auradating/platform/backend/internal/config"
)

func TestNewRedis_ValidAndInvalidURL(t *testing.T) {
	validCfg := &config.Config{
		RedisURL: "redis://localhost:6379/0",
	}

	r, err := NewRedis(validCfg)
	if err != nil {
		t.Fatalf("expected valid Redis config to succeed, got error: %v", err)
	}
	defer func() { _ = r.Close() }()

	invalidCfg := &config.Config{
		RedisURL: "http://not-a-redis-url",
	}
	if _, err := NewRedis(invalidCfg); err == nil {
		t.Fatalf("expected invalid Redis URL scheme to return an error")
	}
}

func TestRedis_NilHealthCheck(t *testing.T) {
	var r *Redis
	if err := r.HealthCheck(context.Background()); err == nil {
		t.Fatalf("expected error on nil Redis health check")
	}
}
