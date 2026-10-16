package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Environment string

const (
	EnvLocal       Environment = "local"
	EnvDevelopment Environment = "development"
	EnvStaging     Environment = "staging"
	EnvProduction  Environment = "production"
)

type Config struct {
	Environment         Environment
	ServiceName         string
	Version             string
	HTTPHost            string
	HTTPPort            int
	ReadTimeout         time.Duration
	ReadHeaderTimeout   time.Duration
	WriteTimeout        time.Duration
	IdleTimeout         time.Duration
	ShutdownTimeout     time.Duration
	MaxRequestBodyBytes int64

	DatabaseURL      string
	DBMaxConns       int32
	DBMinConns       int32
	DBConnectTimeout time.Duration

	RedisURL string

	JWTSigningSecret string

	MediaMaxImageBytes int64
	MediaMaxVideoBytes     int64
	MediaStorageDir        string
	MediaRetentionInterval  time.Duration
	MediaRetentionBatchSize int

	StripeSecretKey           string
	StripeWebhookSecret       string
	AppleSharedSecret         string
	AppleBundleID             string
	GooglePlayCredentialsJSON string
	GooglePlayPackageName     string

	PersonaAPIKey        string
	PersonaWebhookSecret string

	VisionAPIKey         string
	SightengineAPIUser   string
	SightengineAPISecret string

	ResendAPIKey         string
	ResendFromEmail      string
	PasswordResetURLBase string

	CORSAllowedOrigins []string
}

func LoadFromEnv() (*Config, error) {
	loadDotEnv()
	return Load(os.Getenv)
}

func loadDotEnv() {
	paths := []string{".env", "../.env", "../../.env", "backend/.env"}
	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) != 2 {
				continue
			}
			key := strings.TrimSpace(parts[0])
			val := strings.TrimSpace(parts[1])
			if strings.HasPrefix(val, "\"") && strings.HasSuffix(val, "\"") && len(val) >= 2 {
				val = val[1 : len(val)-1]
			} else if strings.HasPrefix(val, "'") && strings.HasSuffix(val, "'") && len(val) >= 2 {
				val = val[1 : len(val)-1]
			}
			if os.Getenv(key) == "" {
				_ = os.Setenv(key, val)
			}
		}
		_ = f.Close()
		break
	}
}

func Load(getenv func(string) string) (*Config, error) {
	corsRaw := getString(getenv, "CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8081")
	var corsOrigins []string
	for _, orig := range strings.Split(corsRaw, ",") {
		trimmed := strings.TrimSpace(orig)
		if trimmed != "" {
			corsOrigins = append(corsOrigins, trimmed)
		}
	}

	appEnv := Environment(getString(getenv, "APP_ENV", string(EnvLocal)))
	defaultBundleID := "com.aura.dating"
	defaultPackageName := "com.aura.dating"
	if appEnv == EnvStaging || appEnv == EnvProduction {
		defaultBundleID = ""
		defaultPackageName = ""
	}

	cfg := &Config{
		Environment:         appEnv,
		ServiceName:         getString(getenv, "SERVICE_NAME", "aura-backend-api"),
		Version:             getString(getenv, "SERVICE_VERSION", getString(getenv, "APP_VERSION", "0.1.0")),
		HTTPHost:            getString(getenv, "HTTP_HOST", "0.0.0.0"),
		HTTPPort:            getInt(getenv, "HTTP_PORT", 8080),
		ReadTimeout:         getDuration(getenv, "HTTP_READ_TIMEOUT", 10*time.Second),
		ReadHeaderTimeout:   getDuration(getenv, "HTTP_READ_HEADER_TIMEOUT", 5*time.Second),
		WriteTimeout:        getDuration(getenv, "HTTP_WRITE_TIMEOUT", 15*time.Second),
		IdleTimeout:         getDuration(getenv, "HTTP_IDLE_TIMEOUT", 60*time.Second),
		ShutdownTimeout:     getDuration(getenv, "SHUTDOWN_TIMEOUT", getDuration(getenv, "HTTP_SHUTDOWN_TIMEOUT", 15*time.Second)),
		MaxRequestBodyBytes: getInt64(getenv, "MAX_REQUEST_BODY_BYTES", 1024*1024), // 1 MiB JSON API limit

		DatabaseURL:      getString(getenv, "DATABASE_URL", "postgres://aura:aura_dev_password@localhost:5432/aura_dev?sslmode=disable"),
		DBMaxConns:       int32(getInt(getenv, "DB_MAX_CONNS", 25)),
		DBMinConns:       int32(getInt(getenv, "DB_MIN_CONNS", 2)),
		DBConnectTimeout: getDuration(getenv, "DB_CONNECT_TIMEOUT", 5*time.Second),

		RedisURL: getString(getenv, "REDIS_URL", "redis://localhost:6379/0"),

		JWTSigningSecret: getString(getenv, "JWT_SIGNING_SECRET", "local-dev-only-jwt-signing-secret-must-be-changed-32b"),

		MediaMaxImageBytes:      getInt64(getenv, "MEDIA_MAX_IMAGE_BYTES", 15*1024*1024),  // 15 MiB
		MediaMaxVideoBytes:      getInt64(getenv, "MEDIA_MAX_VIDEO_BYTES", 100*1024*1024), // 100 MiB
		MediaStorageDir:         getString(getenv, "MEDIA_STORAGE_DIR", "data/media"),
		MediaRetentionInterval:  getDuration(getenv, "MEDIA_RETENTION_INTERVAL", 1*time.Hour),
		MediaRetentionBatchSize: getInt(getenv, "MEDIA_RETENTION_BATCH_SIZE", 100),

		StripeSecretKey:           getString(getenv, "STRIPE_SECRET_KEY", "sk_test_placeholder"),
		StripeWebhookSecret:       getString(getenv, "STRIPE_WEBHOOK_SECRET", "whsec_test_placeholder"),
		AppleSharedSecret:         getString(getenv, "APPLE_SHARED_SECRET", "apple_secret_placeholder"),
		AppleBundleID:             getString(getenv, "APPLE_BUNDLE_ID", defaultBundleID),
		GooglePlayCredentialsJSON: getString(getenv, "GOOGLE_PLAY_CREDENTIALS_JSON", ""),
		GooglePlayPackageName:     getString(getenv, "GOOGLE_PLAY_PACKAGE_NAME", defaultPackageName),

		PersonaAPIKey:        getString(getenv, "PERSONA_API_KEY", ""),
		PersonaWebhookSecret: getString(getenv, "PERSONA_WEBHOOK_SECRET", ""),

		VisionAPIKey:         getString(getenv, "VISION_API_KEY", ""),
		SightengineAPIUser:   getString(getenv, "SIGHTENGINE_API_USER", ""),
		SightengineAPISecret: getString(getenv, "SIGHTENGINE_API_SECRET", ""),

		ResendAPIKey:         getString(getenv, "RESEND_API_KEY", ""),
		ResendFromEmail:      getString(getenv, "RESEND_FROM_EMAIL", "Aura <security@aura.dating>"),
		PasswordResetURLBase: getString(getenv, "PASSWORD_RESET_URL_BASE", "http://localhost:3000/auth/reset-password"),

		CORSAllowedOrigins: corsOrigins,
	}

	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) Validate() error {
	var errs []error

	switch c.Environment {
	case EnvLocal, EnvDevelopment, EnvStaging, EnvProduction:
	default:
		errs = append(errs, fmt.Errorf("invalid APP_ENV %q: must be local, development, staging, or production", c.Environment))
	}

	if c.HTTPPort < 1 || c.HTTPPort > 65535 {
		errs = append(errs, fmt.Errorf("invalid HTTP_PORT %d: must be between 1 and 65535", c.HTTPPort))
	}

	if c.ReadTimeout <= 0 || c.ReadHeaderTimeout <= 0 || c.WriteTimeout <= 0 || c.IdleTimeout <= 0 {
		errs = append(errs, errors.New("HTTP server timeouts must all be positive durations"))
	}

	if !strings.HasPrefix(c.DatabaseURL, "postgres://") && !strings.HasPrefix(c.DatabaseURL, "postgresql://") {
		errs = append(errs, errors.New("DATABASE_URL must start with postgres:// or postgresql://"))
	}

	if c.DBMaxConns < 1 || c.DBMinConns < 0 || c.DBMinConns > c.DBMaxConns {
		errs = append(errs, fmt.Errorf("invalid database pool bounds: min=%d max=%d", c.DBMinConns, c.DBMaxConns))
	}

	if !strings.HasPrefix(c.RedisURL, "redis://") && !strings.HasPrefix(c.RedisURL, "rediss://") {
		errs = append(errs, errors.New("REDIS_URL must start with redis:// or rediss://"))
	}

	if len(c.JWTSigningSecret) < 32 {
		errs = append(errs, errors.New("JWT_SIGNING_SECRET must be at least 32 characters"))
	}

	if c.Environment == EnvStaging || c.Environment == EnvProduction {
		if strings.Contains(c.JWTSigningSecret, "local-dev-only") || strings.Contains(c.JWTSigningSecret, "dev-only") || strings.Contains(c.JWTSigningSecret, "placeholder") {
			errs = append(errs, errors.New("JWT_SIGNING_SECRET cannot use local development placeholder in staging or production"))
		}
		if strings.Contains(c.DatabaseURL, "sslmode=disable") {
			errs = append(errs, errors.New("DATABASE_URL cannot have sslmode=disable in staging or production"))
		}
		if strings.TrimSpace(c.AppleBundleID) == "" {
			errs = append(errs, errors.New("APPLE_BUNDLE_ID must be configured in staging or production"))
		}
		if strings.TrimSpace(c.GooglePlayPackageName) == "" {
			errs = append(errs, errors.New("GOOGLE_PLAY_PACKAGE_NAME must be configured in staging or production"))
		}
		for _, origin := range c.CORSAllowedOrigins {
			if origin == "*" {
				errs = append(errs, errors.New("CORS_ALLOWED_ORIGINS cannot contain wildcard '*' in staging or production"))
			}
		}
	}

	if c.MediaMaxImageBytes <= 0 || c.MediaMaxVideoBytes <= 0 {
		errs = append(errs, errors.New("media size limits must be positive"))
	}

	return errors.Join(errs...)
}

func (c *Config) HTTPAddr() string {
	return fmt.Sprintf("%s:%d", c.HTTPHost, c.HTTPPort)
}

func getString(getenv func(string) string, key, fallback string) string {
	if v := strings.TrimSpace(getenv(key)); v != "" {
		return v
	}
	return fallback
}

func getInt(getenv func(string) string, key string, fallback int) int {
	if v := strings.TrimSpace(getenv(key)); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			return parsed
		}
	}
	return fallback
}

func getInt64(getenv func(string) string, key string, fallback int64) int64 {
	if v := strings.TrimSpace(getenv(key)); v != "" {
		if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
			return parsed
		}
	}
	return fallback
}

func getDuration(getenv func(string) string, key string, fallback time.Duration) time.Duration {
	if v := strings.TrimSpace(getenv(key)); v != "" {
		if parsed, err := time.ParseDuration(v); err == nil {
			return parsed
		}
	}
	return fallback
}
