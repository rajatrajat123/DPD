package config

import (
	"strings"
	"testing"
)

func TestLoad_DefaultsValidInLocalEnv(t *testing.T) {
	cfg, err := Load(func(string) string { return "" })
	if err != nil {
		t.Fatalf("expected default local config to be valid, got error: %v", err)
	}
	if cfg.Environment != EnvLocal {
		t.Errorf("expected environment %q, got %q", EnvLocal, cfg.Environment)
	}
	if cfg.HTTPPort != 8080 {
		t.Errorf("expected default port 8080, got %d", cfg.HTTPPort)
	}
	for _, o := range cfg.CORSAllowedOrigins {
		if o == "*" {
			t.Errorf("default CORSAllowedOrigins must not contain wildcard '*', got %v", cfg.CORSAllowedOrigins)
		}
	}
}

func TestValidate_ProductionRejectsInsecureDefaults(t *testing.T) {
	env := map[string]string{
		"APP_ENV":      "production",
		"DATABASE_URL": "postgres://aura:pass@db.internal:5432/aura?sslmode=disable",
	}
	_, err := Load(func(k string) string { return env[k] })
	if err == nil {
		t.Fatal("expected production validation to fail on placeholder secret and sslmode=disable")
	}
	if !strings.Contains(err.Error(), "JWT_SIGNING_SECRET") {
		t.Errorf("expected error to mention JWT_SIGNING_SECRET, got: %v", err)
	}
	if !strings.Contains(err.Error(), "sslmode=disable") {
		t.Errorf("expected error to mention sslmode=disable, got: %v", err)
	}
}

func TestValidate_ProductionValidWithProperSettings(t *testing.T) {
	env := map[string]string{
		"APP_ENV":                  "production",
		"HTTP_PORT":                "8443",
		"DATABASE_URL":             "postgres://aura_prod:strong_pass@db.prod.internal:5432/aura?sslmode=verify-full",
		"REDIS_URL":                "rediss://redis.prod.internal:6379/0",
		"JWT_SIGNING_SECRET":       "prod_cryptographic_signing_key_9f8e7d6c5b4a3210_valid",
		"APPLE_BUNDLE_ID":          "com.aura.dating",
		"GOOGLE_PLAY_PACKAGE_NAME": "com.aura.dating",
	}
	cfg, err := Load(func(k string) string { return env[k] })
	if err != nil {
		t.Fatalf("expected valid production config, got: %v", err)
	}
	if cfg.HTTPAddr() != "0.0.0.0:8443" {
		t.Errorf("unexpected HTTPAddr: %s", cfg.HTTPAddr())
	}
	if cfg.AppleBundleID != "com.aura.dating" {
		t.Errorf("expected AppleBundleID com.aura.dating, got %q", cfg.AppleBundleID)
	}
	if cfg.GooglePlayPackageName != "com.aura.dating" {
		t.Errorf("expected GooglePlayPackageName com.aura.dating, got %q", cfg.GooglePlayPackageName)
	}
}

func TestValidate_ProductionRejectsMissingStoreIdentifiers(t *testing.T) {
	baseEnv := map[string]string{
		"APP_ENV":            "production",
		"HTTP_PORT":          "8443",
		"DATABASE_URL":       "postgres://aura_prod:strong_pass@db.prod.internal:5432/aura?sslmode=verify-full",
		"REDIS_URL":          "rediss://redis.prod.internal:6379/0",
		"JWT_SIGNING_SECRET": "prod_cryptographic_signing_key_9f8e7d6c5b4a3210_valid",
	}

	// Missing both
	_, err := Load(func(k string) string { return baseEnv[k] })
	if err == nil {
		t.Fatal("expected failure when APPLE_BUNDLE_ID and GOOGLE_PLAY_PACKAGE_NAME are missing in production")
	}
	if !strings.Contains(err.Error(), "APPLE_BUNDLE_ID") {
		t.Errorf("expected error to mention APPLE_BUNDLE_ID, got: %v", err)
	}
	if !strings.Contains(err.Error(), "GOOGLE_PLAY_PACKAGE_NAME") {
		t.Errorf("expected error to mention GOOGLE_PLAY_PACKAGE_NAME, got: %v", err)
	}
}

func TestValidate_ProductionRejectsWildcardCORS(t *testing.T) {
	env := map[string]string{
		"APP_ENV":                  "production",
		"HTTP_PORT":                "8443",
		"DATABASE_URL":             "postgres://aura_prod:strong_pass@db.prod.internal:5432/aura?sslmode=verify-full",
		"REDIS_URL":                "rediss://redis.prod.internal:6379/0",
		"JWT_SIGNING_SECRET":       "prod_cryptographic_signing_key_9f8e7d6c5b4a3210_valid",
		"APPLE_BUNDLE_ID":          "com.aura.dating",
		"GOOGLE_PLAY_PACKAGE_NAME": "com.aura.dating",
		"CORS_ALLOWED_ORIGINS":     "https://staging.auradating.com,*",
	}
	_, err := Load(func(k string) string { return env[k] })
	if err == nil {
		t.Fatal("expected failure when wildcard '*' is present in CORS_ALLOWED_ORIGINS in production")
	}
	if !strings.Contains(err.Error(), "wildcard '*'") {
		t.Errorf("expected error to mention wildcard '*', got: %v", err)
	}
}

func TestLoad_EnvExampleCompatibility(t *testing.T) {
	env := map[string]string{
		"APP_ENV":               "development",
		"SERVICE_NAME":          "aura-api",
		"APP_VERSION":           "0.1.0-phase01",
		"HTTP_SHUTDOWN_TIMEOUT": "15s",
	}
	cfg, err := Load(func(k string) string { return env[k] })
	if err != nil {
		t.Fatalf("expected .env.example variables to pass validation, got: %v", err)
	}
	if cfg.Environment != EnvDevelopment {
		t.Errorf("expected environment %q, got %q", EnvDevelopment, cfg.Environment)
	}
	if cfg.Version != "0.1.0-phase01" {
		t.Errorf("expected version '0.1.0-phase01', got %q", cfg.Version)
	}
	if !strings.Contains(cfg.DatabaseURL, "/aura_dev?") {
		t.Errorf("expected default DatabaseURL to target 'aura_dev' matching docker-compose.yml, got %q", cfg.DatabaseURL)
	}
}
