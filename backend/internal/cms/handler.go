package cms

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/auradating/platform/backend/internal/apperror"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/middleware"
	"github.com/auradating/platform/backend/internal/safety"
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
// Public Endpoints
// -----------------------------------------------------------------------------

// GetPublicContent handles GET /api/v1/cms/public?key={key}&slug={slug}
func (h *Handler) GetPublicContent(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET is allowed"))
		return
	}

	key := strings.TrimSpace(r.URL.Query().Get("key"))
	slug := strings.TrimSpace(r.URL.Query().Get("slug"))

	target := key
	if target == "" {
		target = slug
	}
	if target == "" {
		target = "/"
	}

	item, ver, err := h.svc.GetPublicContent(r.Context(), target)
	if err != nil {
		if errors.Is(err, ErrContentNotFound) || errors.Is(err, ErrVersionNotFound) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Published content not found"))
			return
		}
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, "Failed to retrieve public content"))
		return
	}

	w.Header().Set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600")
	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"item":    item,
		"version": ver,
	})
}

// -----------------------------------------------------------------------------
// Admin CMS Endpoints
// -----------------------------------------------------------------------------

// AdminContent handles routing for /api/v1/admin/cms/content and /api/v1/admin/cms/content/*
func (h *Handler) AdminContent(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	prefix := "/api/v1/admin/cms/content"
	subPath := strings.TrimPrefix(r.URL.Path, prefix)
	subPath = strings.Trim(subPath, "/")

	// Collection: GET /api/v1/admin/cms/content
	if subPath == "" {
		if r.Method != http.MethodGet {
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET is allowed"))
			return
		}

		if !safety.HasPermission(authUser.Role, safety.PermCMSWrite) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "CMS permission required"))
			return
		}

		statusFilter := r.URL.Query().Get("status")
		items, err := h.svc.ListContent(r.Context(), statusFilter)
		if err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
			return
		}
		apperror.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "count": len(items)})
		return
	}

	// Sub-paths: /{id}, /{id}/publish, /{id}/unpublish, /{id}/revert
	parts := strings.Split(subPath, "/")
	id := parts[0]

	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			if !safety.HasPermission(authUser.Role, safety.PermCMSWrite) {
				apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "CMS read permission required"))
				return
			}
			detail, err := h.svc.GetContentDetail(r.Context(), id)
			if err != nil {
				if errors.Is(err, ErrContentNotFound) {
					apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Content item not found"))
					return
				}
				apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
				return
			}
			apperror.WriteJSON(w, http.StatusOK, detail)

		case http.MethodPut:
			if !safety.HasPermission(authUser.Role, safety.PermCMSWrite) {
				apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "CMS write permission required"))
				return
			}
			var req SaveDraftRequest
			if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&req); err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed draft payload"))
				return
			}
			detail, err := h.svc.SaveDraft(r.Context(), id, req, authUser)
			if err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
				return
			}
			apperror.WriteJSON(w, http.StatusOK, detail)

		default:
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		}
		return
	}

	action := parts[1]
	switch action {
	case "publish":
		if r.Method != http.MethodPost {
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST is allowed"))
			return
		}
		if !safety.HasPermission(authUser.Role, safety.PermCMSPublish) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "CMS publish permission required"))
			return
		}
		var req struct {
			VersionID string `json:"version_id"`
		}
		_ = json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req)

		detail, err := h.svc.Publish(r.Context(), id, req.VersionID, authUser)
		if err != nil {
			if errors.Is(err, ErrDuplicateSlug) {
				apperror.WriteError(w, reqID, apperror.New(http.StatusConflict, "DUPLICATE_SLUG", "A published item with this URL slug already exists"))
				return
			}
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
			return
		}
		apperror.WriteJSON(w, http.StatusOK, detail)

	case "unpublish":
		if r.Method != http.MethodPost {
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST is allowed"))
			return
		}
		if !safety.HasPermission(authUser.Role, safety.PermCMSPublish) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "CMS publish permission required"))
			return
		}
		detail, err := h.svc.Unpublish(r.Context(), id, authUser)
		if err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
			return
		}
		apperror.WriteJSON(w, http.StatusOK, detail)

	case "revert":
		if r.Method != http.MethodPost {
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST is allowed"))
			return
		}
		if !safety.HasPermission(authUser.Role, safety.PermCMSWrite) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "CMS write permission required"))
			return
		}
		var req struct {
			VersionNumber int `json:"version_number"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil || req.VersionNumber <= 0 {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Valid version_number is required"))
			return
		}
		detail, err := h.svc.RevertToVersion(r.Context(), id, req.VersionNumber, authUser)
		if err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
			return
		}
		apperror.WriteJSON(w, http.StatusOK, detail)

	default:
		apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "CMS action not found"))
	}
}

// AdminMedia handles GET /api/v1/admin/cms/media and POST /api/v1/admin/cms/media/upload
func (h *Handler) AdminMedia(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	if !safety.HasPermission(authUser.Role, safety.PermCMSWrite) {
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "CMS media permission required"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		limit := 50
		if lStr := r.URL.Query().Get("limit"); lStr != "" {
			if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
				limit = l
			}
		}
		assets, err := h.svc.ListMedia(r.Context(), limit)
		if err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
			return
		}
		apperror.WriteJSON(w, http.StatusOK, map[string]any{"assets": assets, "count": len(assets)})

	case http.MethodPost:
		// Max 10MB file + overhead
		if err := r.ParseMultipartForm(12 * 1024 * 1024); err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Failed to parse multipart form"))
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Marketing image file is required"))
			return
		}
		defer file.Close()

		altText := strings.TrimSpace(r.FormValue("alt_text"))
		if altText == "" {
			altText = header.Filename
		}

		asset, err := h.svc.UploadMarketingMedia(r.Context(), header.Filename, file, header.Size, altText, authUser)
		if err != nil {
			if errors.Is(err, ErrInvalidFileType) || errors.Is(err, ErrFileTooLarge) {
				apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
				return
			}
			apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
			return
		}

		apperror.WriteJSON(w, http.StatusCreated, asset)

	default:
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
	}
}

// AdminAudit handles GET /api/v1/admin/cms/audit
func (h *Handler) AdminAudit(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	if !safety.HasPermission(authUser.Role, safety.PermAuditRead) && !safety.HasPermission(authUser.Role, safety.PermCMSWrite) {
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "CMS audit permission required"))
		return
	}

	limit := 50
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	records, err := h.svc.ListAuditTrail(r.Context(), limit)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{"audit_records": records, "count": len(records)})
}
