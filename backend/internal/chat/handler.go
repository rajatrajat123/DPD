package chat

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/auradating/platform/backend/internal/apperror"
	"github.com/auradating/platform/backend/internal/discovery"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/middleware"
	"github.com/auradating/platform/backend/internal/validator"
)

type AccessValidator interface {
	ValidateAccess(ctx context.Context, userID string) error
}

type AccessValidatorFunc func(ctx context.Context, userID string) error

func (f AccessValidatorFunc) ValidateAccess(ctx context.Context, userID string) error {
	return f(ctx, userID)
}

type Handler struct {
	svc             *Service
	jwtSecret       string
	accessValidator AccessValidator
}

func NewHandler(svc *Service, jwtSecret string) *Handler {
	return &Handler{
		svc:       svc,
		jwtSecret: jwtSecret,
	}
}

func (h *Handler) SetAccessValidator(v AccessValidator) {
	h.accessValidator = v
}

// WebSocketUpgrade handles GET /api/v1/ws and GET /ws/v1.
func (h *Handler) WebSocketUpgrade(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())

	// 1. Authenticate caller: Query param ?token=..., Authorization header, or aura_session cookie
	var tokenStr string
	if tok := r.URL.Query().Get("token"); tok != "" {
		tokenStr = tok
	} else if authHeader := r.Header.Get("Authorization"); strings.HasPrefix(authHeader, "Bearer ") {
		tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
	} else if cookie, err := r.Cookie("aura_session"); err == nil && cookie.Value != "" {
		tokenStr = cookie.Value
	}

	if tokenStr == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication token required for WebSocket upgrade"))
		return
	}

	claims, err := identity.ParseAndVerifyAccessToken(h.jwtSecret, tokenStr)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Invalid or expired token for WebSocket upgrade"))
		return
	}

	if h.accessValidator != nil {
		if err := h.accessValidator.ValidateAccess(r.Context(), claims.Subject); err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "ACCESS_DENIED", err.Error()))
			return
		}
	}

	// 2. Perform WebSocket handshake
	_, err = h.svc.Hub().Upgrade(w, r, claims.Subject)
	if err != nil {
		// Upgrade already writes HTTP error if handshake fails
		return
	}
}

// ListConversations handles GET /api/v1/conversations.
func (h *Handler) ListConversations(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET allowed"))
		return
	}

	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	convs, err := h.svc.ListConversations(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"count":         len(convs),
		"conversations": convs,
	})
}

// ConversationMessages handles GET and POST /api/v1/conversations/{id}/messages and /api/v1/conversations/{id}/read.
func (h *Handler) ConversationMessages(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	// Route path parsing: /api/v1/conversations/{id}/...
	pathRem := strings.TrimPrefix(r.URL.Path, "/api/v1/conversations/")
	parts := strings.Split(pathRem, "/")
	convID := parts[0]
	if convID == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Conversation ID required in path"))
		return
	}

	// Sub-action: /read
	if len(parts) > 1 && parts[1] == "read" {
		if r.Method != http.MethodPost {
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST allowed for mark read"))
			return
		}
		if err := h.svc.MarkRead(r.Context(), convID, authUser.ID); err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, map[string]any{
			"status":          "READ",
			"conversation_id": convID,
		})
		return
	}

	// Sub-action: /messages
	if len(parts) > 1 && parts[1] == "messages" {
		switch r.Method {
		case http.MethodGet:
			limit := 50
			if lStr := r.URL.Query().Get("limit"); lStr != "" {
				if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
					limit = l
				}
			}
			beforeID := r.URL.Query().Get("before_id")
			page, err := h.svc.GetMessages(r.Context(), convID, authUser.ID, beforeID, limit)
			if err != nil {
				h.handleError(w, reqID, err)
				return
			}
			apperror.WriteJSON(w, http.StatusOK, page)

		case http.MethodPost:
			var req SendMessageRequest
			if apiErr := validator.DecodeAndValidate(w, r, 64*1024, &req); apiErr != nil {
				apperror.WriteError(w, reqID, apiErr)
				return
			}

			msg, err := h.svc.SendMessage(r.Context(), authUser.ID, convID, req)
			if err != nil {
				h.handleError(w, reqID, err)
				return
			}
			apperror.WriteJSON(w, http.StatusCreated, msg)

		default:
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		}
		return
	}

	apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Route not found"))
}

// RegisterPushToken handles POST /api/v1/notifications/push-token.
func (h *Handler) RegisterPushToken(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST allowed"))
		return
	}

	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	var req RegisterPushTokenRequest
	if apiErr := validator.DecodeAndValidate(w, r, 16*1024, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	if err := h.svc.RegisterPushToken(r.Context(), authUser.ID, req.Token, req.Platform, req.DeviceID); err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusCreated, map[string]any{
		"status": "REGISTERED",
	})
}

func (h *Handler) handleError(w http.ResponseWriter, reqID string, err error) {
	switch {
	case errors.Is(err, ErrConversationNotFound), errors.Is(err, discovery.ErrMatchNotFound):
		apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Conversation or match not found"))
	case errors.Is(err, ErrUnauthorizedParticipant):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Access to conversation denied"))
	case errors.Is(err, ErrMatchInactive):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Cannot message: match is unmatched, blocked, or inactive"))
	case errors.Is(err, ErrEmptyMessage), errors.Is(err, ErrMessageTooLong), errors.Is(err, ErrInvalidClientMessageID):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
	case errors.Is(err, ErrRateLimitExceeded), errors.Is(err, discovery.ErrDiscoveryMessageQuotaLocked):
		apperror.WriteError(w, reqID, apperror.New(http.StatusTooManyRequests, apperror.CodeRateLimitExceeded, err.Error()))
	default:
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
	}
}

// ListMessageRequests handles GET /api/v1/message-requests.
func (h *Handler) ListMessageRequests(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET allowed"))
		return
	}

	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	reqs, err := h.svc.ListMessageRequests(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"count":    len(reqs),
		"requests": reqs,
	})
}

// HandleMessageRequest handles POST /api/v1/message-requests/{id}/{action} (accept, decline, block).
func (h *Handler) HandleMessageRequest(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST allowed"))
		return
	}

	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	pathRem := strings.TrimPrefix(r.URL.Path, "/api/v1/message-requests/")
	parts := strings.Split(strings.Trim(pathRem, "/"), "/")
	if len(parts) < 2 {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Request ID and action required in path"))
		return
	}

	requestID := parts[0]
	action := strings.ToLower(parts[1])

	switch action {
	case "accept":
		resp, err := h.svc.AcceptMessageRequest(r.Context(), requestID, authUser.ID)
		if err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, resp)

	case "decline":
		if err := h.svc.DeclineMessageRequest(r.Context(), requestID, authUser.ID); err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, map[string]any{"success": true})

	case "block":
		if err := h.svc.BlockMessageRequest(r.Context(), requestID, authUser.ID); err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, map[string]any{"success": true})

	default:
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Invalid action: must be accept, decline, or block"))
	}
}
