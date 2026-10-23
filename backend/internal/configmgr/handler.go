package configmgr

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/auradating/platform/backend/internal/apperror"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/middleware"
)

type AuditLogger interface {
	RecordAudit(ctx context.Context, actorUserID *string, actorRole, action, targetType, targetID, outcome string, metadata map[string]any) error
}

type Handler struct {
	svc   *Service
	audit AuditLogger
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) SetAuditLogger(audit AuditLogger) {
	h.audit = audit
}

// HandleAdminConfig handles /api/v1/admin/config and /api/v1/admin/config/{key}
func (h *Handler) HandleAdminConfig(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	if authUser.Role != identity.RoleSuperAdmin {
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Super Admin privilege required"))
		return
	}

	pathRem := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/config")
	pathRem = strings.TrimPrefix(pathRem, "/")

	if pathRem == "" {
		if r.Method != http.MethodGet {
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
			return
		}
		configs, err := h.svc.GetAllConfigs(r.Context())
		if err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
			return
		}
		apperror.WriteJSON(w, http.StatusOK, map[string]any{"configs": configs})
		return
	}

	key := pathRem
	switch r.Method {
	case http.MethodGet:
		val, err := h.svc.GetConfig(r.Context(), key)
		if err != nil {
			if errors.Is(err, ErrConfigNotFound) {
				apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Configuration key not found"))
				return
			}
			apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
			return
		}
		apperror.WriteJSON(w, http.StatusOK, map[string]any{
			"key":   key,
			"value": val,
		})

	case http.MethodPut, http.MethodPost:
		body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		if err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Failed to read request body"))
			return
		}

		var payload struct {
			Value json.RawMessage `json:"value"`
		}
		if err := json.Unmarshal(body, &payload); err != nil || len(payload.Value) == 0 {
			// Direct JSON payload
			payload.Value = body
		}

		if err := h.svc.UpdateConfig(r.Context(), key, payload.Value, &authUser.ID); err != nil {
			if h.audit != nil {
				_ = h.audit.RecordAudit(r.Context(), &authUser.ID, string(authUser.Role), "admin.config_update_failed", "CONFIG", key, "FAILURE", map[string]any{
					"error": err.Error(),
				})
			}
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
			return
		}

		if h.audit != nil {
			_ = h.audit.RecordAudit(r.Context(), &authUser.ID, string(authUser.Role), "admin.config_updated", "CONFIG", key, "SUCCESS", map[string]any{
				"key": key,
			})
		}

		apperror.WriteJSON(w, http.StatusOK, map[string]any{
			"status": "UPDATED",
			"key":    key,
			"value":  payload.Value,
		})

	default:
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
	}
}
