package media

import (
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/auradating/platform/backend/internal/apperror"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/middleware"
	"github.com/auradating/platform/backend/internal/validator"
)

type Handler struct {
	svc     *Service
	storage StorageEngine
}

func NewHandler(svc *Service, storage StorageEngine) *Handler {
	return &Handler{
		svc:     svc,
		storage: storage,
	}
}

// Upload handles multipart direct file upload (images and videos).
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
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

	// Parse multipart form (max 105 MiB to allow 100 MiB video + form fields)
	if err := r.ParseMultipartForm(105 * 1024 * 1024); err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, fmt.Sprintf("Failed to parse multipart form: %v", err)))
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Missing 'file' in multipart form data"))
		return
	}
	defer file.Close()

	purpose := r.FormValue("purpose")
	if purpose == "" {
		purpose = string(PurposeProfileGallery)
	}

	mediaType := r.FormValue("media_type")
	if mediaType == "" {
		// Infer from content type or extension
		if strings.HasPrefix(header.Header.Get("Content-Type"), "video/") {
			mediaType = string(MediaTypeVideo)
		} else {
			mediaType = string(MediaTypeImage)
		}
	}

	idempotencyKey := r.Header.Get("Idempotency-Key")
	if idempotencyKey == "" {
		idempotencyKey = r.FormValue("idempotency_key")
	}

	resp, err := h.svc.UploadDirect(
		r.Context(),
		authUser.ID,
		purpose,
		mediaType,
		header.Filename,
		file,
		header.Size,
		idempotencyKey,
	)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusCreated, resp)
}

// CreateUploadIntent registers intent for pre-signed quarantine upload.
func (h *Handler) CreateUploadIntent(w http.ResponseWriter, r *http.Request) {
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

	var req UploadIntentRequest
	if apiErr := validator.DecodeAndValidate(w, r, 1024*1024, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	if req.IdempotencyKey == "" {
		req.IdempotencyKey = r.Header.Get("Idempotency-Key")
	}

	resp, err := h.svc.CreateUploadIntent(r.Context(), authUser.ID, req)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusCreated, resp)
}

// CompleteUpload notifies that client finished direct PUT to quarantine storage.
func (h *Handler) CompleteUpload(w http.ResponseWriter, r *http.Request) {
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

	assetID := extractParamFromPath(r.URL.Path, "/api/v1/media/", "/complete")
	if assetID == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Asset ID required in path"))
		return
	}

	if err := h.svc.CompleteUpload(r.Context(), assetID, authUser.ID); err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"asset_id": assetID,
		"status":   StatusUploaded,
		"message":  "Upload acknowledged; asynchronous processing scheduled",
	})
}

// GetAsset retrieves asset details and active signed derivative URLs.
func (h *Handler) GetAsset(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET is allowed"))
		return
	}

	authUser, _ := identity.GetAuthUser(r.Context())
	var requesterID string
	if authUser != nil {
		requesterID = authUser.ID
	}

	assetID := strings.TrimPrefix(r.URL.Path, "/api/v1/media/")
	assetID = strings.Split(assetID, "/")[0]
	if assetID == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Asset ID required"))
		return
	}

	resp, err := h.svc.GetAssetWithDerivatives(r.Context(), assetID, requesterID)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, resp)
}

// ListMyGallery retrieves the authenticated user's approved gallery assets.
func (h *Handler) ListMyGallery(w http.ResponseWriter, r *http.Request) {
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

	items, err := h.svc.ListUserGallery(r.Context(), authUser.ID)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"count":            len(items),
		"minimum_required": 3,
		"meets_minimum":    len(items) >= 3,
		"assets":           items,
	})
}

// ListUserGallery retrieves public approved gallery assets for a specific user ID.
func (h *Handler) ListUserGallery(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET is allowed"))
		return
	}

	userID := strings.TrimPrefix(r.URL.Path, "/api/v1/media/gallery/user/")
	if userID == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "User ID required in path"))
		return
	}

	items, err := h.svc.ListUserGallery(r.Context(), userID)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"count":  len(items),
		"assets": items,
	})
}

// DeleteAsset deletes a media asset and purges stored files.
func (h *Handler) DeleteAsset(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodDelete {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only DELETE is allowed"))
		return
	}

	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	assetID := strings.TrimPrefix(r.URL.Path, "/api/v1/media/")
	assetID = strings.Split(assetID, "/")[0]
	if assetID == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Asset ID required"))
		return
	}

	if err := h.svc.DeleteAsset(r.Context(), assetID, authUser.ID); err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Stream securely delivers derivative files using HMAC signed token verification and HTTP Range support.
func (h *Handler) Stream(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET/HEAD allowed"))
		return
	}

	pathRemainder := strings.TrimPrefix(r.URL.Path, "/api/v1/media/stream/")
	parts := strings.SplitN(pathRemainder, "/", 2)
	if len(parts) < 2 {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed stream path"))
		return
	}

	bucket := parts[0]
	storageKey := parts[1]

	token := r.URL.Query().Get("token")
	if token == "" {
		token = r.Header.Get("X-Media-Token")
	}

	// Verify HMAC signed token
	if !h.storage.VerifySignedToken(bucket, storageKey, token) {
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Invalid, missing, or expired media access token"))
		return
	}

	reader, mimeType, size, err := h.storage.OpenDerivative(r.Context(), bucket, storageKey)
	if err != nil {
		if errors.Is(err, ErrFileNotFound) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Media object not found"))
			return
		}
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Invalid media storage path"))
		return
	}
	defer reader.Close()

	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	// Use http.ServeContent to support range requests for streaming video/audio
	http.ServeContent(w, r, filepath.Base(storageKey), time.Now().Add(-1*time.Hour), reader)
	_ = size
}

func (h *Handler) handleServiceError(w http.ResponseWriter, reqID string, err error) {
	switch {
	case errors.Is(err, ErrAssetNotFound):
		apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Media asset not found"))
	case errors.Is(err, ErrDerivativeNotFound):
		apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Media derivative not found"))
	case errors.Is(err, ErrUnauthorizedMedia):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Not authorized to access or modify this media asset"))
	case errors.Is(err, ErrUnsupportedFormat):
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnsupportedMediaType, apperror.CodeInvalidRequest, err.Error()))
	case errors.Is(err, ErrPolyglotDetected):
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnprocessableEntity, apperror.CodeValidationFailed, err.Error()))
	case errors.Is(err, ErrInvalidFileSize):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, err.Error()))
	case errors.Is(err, ErrFileTooLarge):
		apperror.WriteError(w, reqID, apperror.New(http.StatusRequestEntityTooLarge, apperror.CodeInvalidRequest, err.Error()))
	case errors.Is(err, ErrImageDimensionTooSmall), errors.Is(err, ErrImageDimensionTooLarge), errors.Is(err, ErrCorruptMedia):
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnprocessableEntity, apperror.CodeValidationFailed, err.Error()))
	case errors.Is(err, ErrMediaModerationRejected):
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnprocessableEntity, "MODERATION_REJECTED", err.Error()))
	case errors.Is(err, ErrMinimumPhotosViolation):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, "PHOTO_MINIMUM_VIOLATION", err.Error()))
	case errors.Is(err, ErrTranscodingWorkerUnavailable):
		apperror.WriteError(w, reqID, apperror.New(http.StatusServiceUnavailable, apperror.CodeDependencyUnavailable, err.Error()))
	default:
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
	}
}

func extractParamFromPath(path, prefix, suffix string) string {
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return ""
	}
	trimmed := strings.TrimPrefix(path, prefix)
	return strings.TrimSuffix(trimmed, suffix)
}

// ReorderGallery handles PUT /api/v1/media/gallery/reorder
func (h *Handler) ReorderGallery(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPut && r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only PUT or POST allowed"))
		return
	}

	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	var req ReorderGalleryRequest
	if apiErr := validator.DecodeAndValidate(w, r, 1024*1024, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	if err := h.svc.ReorderGallery(r.Context(), authUser.ID, req.AssetIDs); err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]bool{"success": true})
}

