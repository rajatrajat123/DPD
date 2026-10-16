package safety

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/auradating/platform/backend/internal/apperror"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/middleware"
)

type Handler struct {
	svc    *Service
	logger *slog.Logger
}

func NewHandler(svc *Service, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{
		svc:    svc,
		logger: logger,
	}
}

// -----------------------------------------------------------------------------
// Age Assurance Handlers
// -----------------------------------------------------------------------------

func (h *Handler) StartAgeVerificationSession(w http.ResponseWriter, r *http.Request) {
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

	var reqBody struct {
		MediaID string `json:"media_id"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&reqBody)
	}

	res, err := h.svc.CreateAgeVerificationSession(r.Context(), authUser.ID, authUser.Email, r.RemoteAddr, reqBody.MediaID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, res)
}

func (h *Handler) GetAgeVerificationStatus(w http.ResponseWriter, r *http.Request) {
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

	status, err := h.svc.GetAgeAssuranceStatus(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	if status == nil {
		apperror.WriteJSON(w, http.StatusOK, map[string]any{
			"user_id": authUser.ID,
			"status":  "UNVERIFIED",
		})
		return
	}

	apperror.WriteJSON(w, http.StatusOK, status)
}

func (h *Handler) AgeVerificationWebhook(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST is allowed"))
		return
	}

	payload, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Failed to read webhook payload"))
		return
	}

	signature := r.Header.Get("Persona-Signature")
	if signature == "" {
		signature = r.Header.Get("X-Age-Signature")
	}
	if signature == "" {
		signature = r.Header.Get("Aura-Age-Signature")
	}

	res, err := h.svc.ProcessAgeVerificationWebhook(r.Context(), payload, signature)
	if err != nil {
		if errors.Is(err, ErrInvalidWebhookSignature) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Invalid webhook signature"))
			return
		}
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"received": true,
		"status":   res.Status,
	})
}

func (h *Handler) AdminOverrideAgeAssurance(w http.ResponseWriter, r *http.Request) {
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

	prefix := "/api/v1/admin/age-assurance/"
	targetUserID := strings.TrimPrefix(r.URL.Path, prefix)
	targetUserID = strings.TrimSuffix(targetUserID, "/override")
	targetUserID = strings.Trim(targetUserID, "/")

	var req AdminAgeOverrideRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed request body"))
		return
	}

	if err := h.svc.AdminOverrideAgeAssurance(r.Context(), authUser, targetUserID, req, r.RemoteAddr, reqID); err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{"updated": true, "user_id": targetUserID, "status": req.Status})
}

// -----------------------------------------------------------------------------
// Moderation Reporting Handlers
// -----------------------------------------------------------------------------

func (h *Handler) SubmitReport(w http.ResponseWriter, r *http.Request) {
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

	var req CreateReportRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed request body"))
		return
	}

	report, err := h.svc.SubmitReport(r.Context(), authUser, req, r.RemoteAddr, reqID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusCreated, report)
}

// -----------------------------------------------------------------------------
// Moderation Queue & Case Handlers
// -----------------------------------------------------------------------------

func (h *Handler) AdminCases(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	// Check if path is collection or single case
	prefix := "/api/v1/admin/moderation/cases"
	subPath := strings.TrimPrefix(r.URL.Path, prefix)
	subPath = strings.Trim(subPath, "/")

	if subPath == "" {
		if r.Method != http.MethodGet {
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET is allowed"))
			return
		}

		var statusPtr *CaseStatus
		if sStr := r.URL.Query().Get("status"); sStr != "" {
			st := CaseStatus(sStr)
			statusPtr = &st
		}

		var priorityPtr *CasePriority
		if pStr := r.URL.Query().Get("priority"); pStr != "" {
			pr := CasePriority(pStr)
			priorityPtr = &pr
		}

		limit := 50
		if lStr := r.URL.Query().Get("limit"); lStr != "" {
			if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
				limit = l
			}
		}

		cases, err := h.svc.ListCases(r.Context(), authUser, statusPtr, priorityPtr, limit)
		if err != nil {
			h.handleError(w, reqID, err)
			return
		}

		apperror.WriteJSON(w, http.StatusOK, map[string]any{"cases": cases, "count": len(cases)})
		return
	}

	// Sub-routes: /api/v1/admin/moderation/cases/{id}, /{id}/assign, /{id}/action
	parts := strings.Split(subPath, "/")
	caseID := parts[0]

	if len(parts) == 1 {
		if r.Method != http.MethodGet {
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET is allowed"))
			return
		}
		details, err := h.svc.GetCaseDetails(r.Context(), authUser, caseID, r.RemoteAddr, reqID)
		if err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, details)
		return
	}

	action := parts[1]
	if action == "assign" && r.Method == http.MethodPost {
		var req struct {
			AssigneeID string `json:"assignee_id"`
		}
		_ = json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req)
		if req.AssigneeID == "" {
			req.AssigneeID = authUser.ID // Default to self assignment
		}

		c, err := h.svc.AssignCase(r.Context(), authUser, caseID, req.AssigneeID, r.RemoteAddr, reqID)
		if err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, c)
		return
	}

	if (action == "action" || action == "actions") && r.Method == http.MethodPost {
		var req CreateModerationActionRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed request body"))
			return
		}

		act, err := h.svc.ExecuteModerationAction(r.Context(), authUser, caseID, req, r.RemoteAddr, reqID)
		if err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, act)
		return
	}

	apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Route not found"))
}

// -----------------------------------------------------------------------------
// Appeals Handlers
// -----------------------------------------------------------------------------

func (h *Handler) Appeals(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	switch r.Method {
	case http.MethodPost:
		var req CreateAppealRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed request body"))
			return
		}

		appeal, err := h.svc.SubmitAppeal(r.Context(), authUser, req)
		if err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusCreated, appeal)

	case http.MethodGet:
		appeals, err := h.svc.GetMyAppeals(r.Context(), authUser.ID)
		if err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, map[string]any{"appeals": appeals, "count": len(appeals)})

	default:
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
	}
}

func (h *Handler) AdminAppeals(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	prefix := "/api/v1/admin/moderation/appeals"
	subPath := strings.TrimPrefix(r.URL.Path, prefix)
	subPath = strings.Trim(subPath, "/")

	if subPath == "" {
		if r.Method != http.MethodGet {
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET is allowed"))
			return
		}

		var statusPtr *AppealStatus
		if sStr := r.URL.Query().Get("status"); sStr != "" {
			st := AppealStatus(sStr)
			statusPtr = &st
		}

		appeals, err := h.svc.ListAppeals(r.Context(), authUser, statusPtr, 50)
		if err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, map[string]any{"appeals": appeals, "count": len(appeals)})
		return
	}

	parts := strings.Split(subPath, "/")
	appealID := parts[0]

	if len(parts) == 2 && parts[1] == "decide" && r.Method == http.MethodPost {
		var req DecideAppealRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed request body"))
			return
		}

		appeal, err := h.svc.DecideAppeal(r.Context(), authUser, appealID, req, r.RemoteAddr, reqID)
		if err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, appeal)
		return
	}

	apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Route not found"))
}

// -----------------------------------------------------------------------------
// Security Audit Handlers
// -----------------------------------------------------------------------------

func (h *Handler) AdminAuditLogs(w http.ResponseWriter, r *http.Request) {
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

	actorID := r.URL.Query().Get("actor_id")
	action := r.URL.Query().Get("action")
	targetType := r.URL.Query().Get("target_type")
	limit := 50
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	logs, err := h.svc.QueryAuditLogs(r.Context(), authUser, actorID, action, targetType, limit)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{"audit_logs": logs, "count": len(logs)})
}

// StepUpAuth handles POST /api/v1/auth/step-up for challenging credentials and obtaining a signed step-up token.
func (h *Handler) StepUpAuth(w http.ResponseWriter, r *http.Request) {
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

	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil || strings.TrimSpace(req.Password) == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Password is required for step-up authentication"))
		return
	}

	token, exp, err := h.svc.CreateStepUpToken(r.Context(), authUser.ID, req.Password, StepUpTokenDefaultDuration, r.RemoteAddr, reqID)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"step_up_token": token,
		"expires_at":    exp.Format(time.RFC3339),
	})
}

func (h *Handler) handleError(w http.ResponseWriter, reqID string, err error) {
	switch {
	case errors.Is(err, ErrForbidden):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Administrative permission required"))
	case errors.Is(err, ErrSelfActionProhibited):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Self-action or self-approval is prohibited"))
	case errors.Is(err, ErrStepUpRequired):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "STEP_UP_REQUIRED", "Step-up verification required"))
	case errors.Is(err, ErrCaseNotFound):
		apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Moderation case not found"))
	case errors.Is(err, ErrReportNotFound):
		apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Report not found"))
	case errors.Is(err, ErrAppealNotFound):
		apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Appeal not found"))
	case errors.Is(err, ErrProviderDisabledInProd):
		apperror.WriteError(w, reqID, apperror.New(http.StatusServiceUnavailable, apperror.CodeDependencyUnavailable, "Test age assurance provider is disabled in production"))
	default:
		h.logger.Error("safety_handler_error", slog.String("error", err.Error()), slog.String("req_id", reqID))
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, "Internal safety service error"))
	}
}
