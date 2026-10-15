package health

import (
	"context"
	"net/http"
	"time"

	"github.com/auradating/platform/backend/internal/apperror"
	"github.com/auradating/platform/backend/internal/middleware"
)

// DependencyProbe represents a backing infrastructure component that can verify readiness.
type DependencyProbe interface {
	HealthCheck(ctx context.Context) error
}

// ComponentStatus describes the health of an individual dependency (PostgreSQL or Redis).
type ComponentStatus struct {
	Status    string `json:"status"`
	LatencyMs int64  `json:"latency_ms"`
	Error     string `json:"error,omitempty"`
}

// Handler provides HTTP handlers for process liveness (/healthz) and dependency readiness (/readyz).
type Handler struct {
	serviceName string
	version     string
	environment string
	startedAt   time.Time
	postgres    DependencyProbe
	redis       DependencyProbe
}

// NewHandler creates a new health and readiness handler.
func NewHandler(serviceName, version, environment string, postgres, redis DependencyProbe) *Handler {
	return &Handler{
		serviceName: serviceName,
		version:     version,
		environment: environment,
		startedAt:   time.Now().UTC(),
		postgres:    postgres,
		redis:       redis,
	}
}

// Liveness handles GET /healthz and returns 200 OK whenever the Go process is responsive.
func (h *Handler) Liveness(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		apperror.WriteError(
			w,
			middleware.GetRequestID(r.Context()),
			apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET and HEAD are supported on /healthz"),
		)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"status":         "ok",
		"service":        h.serviceName,
		"version":        h.version,
		"environment":    h.environment,
		"uptime_seconds": int64(time.Since(h.startedAt).Seconds()),
		"timestamp":      time.Now().UTC().Format(time.RFC3339),
	})
}

// Readiness handles GET /readyz and verifies active connectivity to PostgreSQL and Redis.
// Returns 200 OK if all dependencies respond within their SLA timeout, or 503 Service Unavailable.
func (h *Handler) Readiness(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		apperror.WriteError(
			w,
			middleware.GetRequestID(r.Context()),
			apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET and HEAD are supported on /readyz"),
		)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	checks := make(map[string]ComponentStatus, 2)
	allHealthy := true

	pgStatus := evaluateProbe(ctx, h.postgres)
	if pgStatus.Status != "up" {
		allHealthy = false
	}
	checks["postgresql_postgis"] = pgStatus

	redisStatus := evaluateProbe(ctx, h.redis)
	if redisStatus.Status != "up" {
		allHealthy = false
	}
	checks["redis"] = redisStatus

	overallStatus := "ready"
	httpStatus := http.StatusOK
	if !allHealthy {
		overallStatus = "degraded"
		httpStatus = http.StatusServiceUnavailable
	}

	apperror.WriteJSON(w, httpStatus, map[string]any{
		"status":      overallStatus,
		"service":     h.serviceName,
		"version":     h.version,
		"environment": h.environment,
		"checks":      checks,
		"timestamp":   time.Now().UTC().Format(time.RFC3339),
	})
}

func evaluateProbe(ctx context.Context, probe DependencyProbe) ComponentStatus {
	if probe == nil {
		return ComponentStatus{
			Status:    "down",
			LatencyMs: 0,
			Error:     "dependency probe not configured",
		}
	}

	start := time.Now()
	err := probe.HealthCheck(ctx)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return ComponentStatus{
			Status:    "down",
			LatencyMs: latency,
			Error:     "dependency healthcheck failed",
		}
	}

	return ComponentStatus{
		Status:    "up",
		LatencyMs: latency,
	}
}
