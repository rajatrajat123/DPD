package notification

import (
	"net/http"
	"strconv"

	"github.com/auradating/platform/backend/internal/apperror"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/middleware"
	"github.com/auradating/platform/backend/internal/validator"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Preferences handles GET and PUT /api/v1/notifications/preferences.
func (h *Handler) Preferences(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		prefs, err := h.svc.GetPreferences(r.Context(), authUser.ID)
		if err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
			return
		}
		apperror.WriteJSON(w, http.StatusOK, prefs)

	case http.MethodPut:
		var req UpdatePreferencesRequest
		if apiErr := validator.DecodeAndValidate(w, r, 64*1024, &req); apiErr != nil {
			apperror.WriteError(w, reqID, apiErr)
			return
		}

		updated, err := h.svc.UpdatePreferences(r.Context(), authUser.ID, req)
		if err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
			return
		}
		apperror.WriteJSON(w, http.StatusOK, updated)

	default:
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET and PUT are allowed"))
	}
}

// RegisterPushToken handles POST /api/v1/notifications/push-token.
func (h *Handler) RegisterPushToken(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST is allowed"))
		return
	}

	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	var req RegisterPushTokenRequest
	if apiErr := validator.DecodeAndValidate(w, r, 64*1024, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	if err := h.svc.RegisterPushToken(r.Context(), authUser.ID, req.Token, req.Platform, req.DeviceID); err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusCreated, map[string]any{
		"status":   "REGISTERED",
		"platform": req.Platform,
	})
}

// Logs handles GET /api/v1/notifications/logs.
func (h *Handler) Logs(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET is allowed"))
		return
	}

	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	limit := 50
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	logs, err := h.svc.ListNotificationLogs(r.Context(), authUser.ID, limit)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"count": len(logs),
		"logs":  logs,
	})
}
