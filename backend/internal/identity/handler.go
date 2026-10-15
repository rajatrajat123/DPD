package identity

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/auradating/platform/backend/internal/apperror"
	"github.com/auradating/platform/backend/internal/middleware"
	"github.com/auradating/platform/backend/internal/validator"
)

type contextKey string

const authUserKey contextKey = "aura_auth_user"

type AuthUser struct {
	ID    string
	Email string
	Role  UserRole
}

func GetAuthUser(ctx context.Context) (*AuthUser, bool) {
	u, ok := ctx.Value(authUserKey).(*AuthUser)
	return u, ok
}

func ContextWithAuthUser(ctx context.Context, u *AuthUser) context.Context {
	return context.WithValue(ctx, authUserKey, u)
}

func RequireAuth(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reqID := middleware.GetRequestID(r.Context())

			authHeader := r.Header.Get("Authorization")
			var tokenStr string
			if strings.HasPrefix(authHeader, "Bearer ") {
				tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
			} else if cookie, err := r.Cookie("aura_session"); err == nil && cookie.Value != "" {
				tokenStr = cookie.Value
			}

			if tokenStr == "" {
				apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication token required"))
				return
			}

			claims, err := ParseAndVerifyAccessToken(jwtSecret, tokenStr)
			if err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Invalid or expired authentication token"))
				return
			}

			authUser := &AuthUser{
				ID:    claims.Subject,
				Email: claims.Email,
				Role:  claims.Role,
			}
			ctx := context.WithValue(r.Context(), authUserKey, authUser)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

type Handler struct {
	svc          *Service
	maxBodyBytes int64
}

func NewHandler(svc *Service, maxBodyBytes int64) *Handler {
	if maxBodyBytes <= 0 {
		maxBodyBytes = 1024 * 1024 // 1 MB default
	}
	return &Handler{
		svc:          svc,
		maxBodyBytes: maxBodyBytes,
	}
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		return
	}

	var req RegisterRequest
	if apiErr := validator.DecodeAndValidate(w, r, h.maxBodyBytes, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	clientInfo := extractClientInfo(r)
	resp, err := h.svc.Register(r.Context(), req, clientInfo)
	if err != nil {
		if errorsIs(err, ErrUserAlreadyExists) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusConflict, apperror.CodeConflict, "An account with this email or phone already exists"))
			return
		}
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusCreated, resp)
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		return
	}

	var req LoginRequest
	if apiErr := validator.DecodeAndValidate(w, r, h.maxBodyBytes, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	clientInfo := extractClientInfo(r)
	resp, err := h.svc.Login(r.Context(), req, clientInfo)
	if err != nil {
		if strings.Contains(err.Error(), "temporarily locked") {
			apperror.WriteError(w, reqID, apperror.New(http.StatusTooManyRequests, "ACCOUNT_LOCKED", err.Error()))
			return
		}
		if errorsIs(err, ErrInvalidCredentials) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Invalid email or password"))
			return
		}
		if errorsIs(err, ErrAccountNotActive) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Account is suspended or deactivated"))
			return
		}
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, "Failed to authenticate"))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) RefreshToken(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		return
	}

	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if apiErr := validator.DecodeAndValidate(w, r, h.maxBodyBytes, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	clientInfo := extractClientInfo(r)
	resp, err := h.svc.RefreshToken(r.Context(), req.RefreshToken, clientInfo)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Refresh token is invalid, expired, or revoked"))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		return
	}

	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if apiErr := validator.DecodeAndValidate(w, r, h.maxBodyBytes, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	_ = h.svc.Logout(r.Context(), req.RefreshToken)
	apperror.WriteJSON(w, http.StatusOK, map[string]string{"status": "logged_out"})
}

func (h *Handler) SendVerification(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	user, ok := GetAuthUser(r.Context())
	if !ok {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	var req struct {
		Channel string `json:"channel"`
	}
	if apiErr := validator.DecodeAndValidate(w, r, h.maxBodyBytes, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	_, err := h.svc.SendVerification(r.Context(), user.ID, req.Channel)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"status":  "verification_sent",
		"channel": strings.ToUpper(req.Channel),
	})
}

func (h *Handler) ConfirmVerification(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	user, ok := GetAuthUser(r.Context())
	if !ok {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	var req struct {
		Channel string `json:"channel"`
		Code    string `json:"code"`
	}
	if apiErr := validator.DecodeAndValidate(w, r, h.maxBodyBytes, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	if err := h.svc.ConfirmVerification(r.Context(), user.ID, req.Channel, req.Code); err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]string{"status": "verified"})
}

func (h *Handler) RequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	var req struct {
		Email string `json:"email"`
	}
	if apiErr := validator.DecodeAndValidate(w, r, h.maxBodyBytes, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	_, _ = h.svc.RequestPasswordReset(r.Context(), req.Email)
	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"message": "If this email exists, password reset instructions have been generated",
	})
}

func (h *Handler) ConfirmPasswordReset(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	var req struct {
		Token       string `json:"token"`
		NewPassword string `json:"new_password"`
	}
	if apiErr := validator.DecodeAndValidate(w, r, h.maxBodyBytes, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	if err := h.svc.ConfirmPasswordReset(r.Context(), req.Token, req.NewPassword); err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]string{"status": "password_updated"})
}

func (h *Handler) GetMyProfile(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	user, ok := GetAuthUser(r.Context())
	if !ok {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	resp, err := h.svc.GetMyProfile(r.Context(), user.ID)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, "Failed to retrieve profile"))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) UpdateMyProfile(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	user, ok := GetAuthUser(r.Context())
	if !ok {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	var req UpdateProfileRequest
	if apiErr := validator.DecodeAndValidate(w, r, h.maxBodyBytes, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	profile, err := h.svc.UpdateMyProfile(r.Context(), user.ID, req)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, profile)
}

func (h *Handler) UpdateMyLocation(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	user, ok := GetAuthUser(r.Context())
	if !ok {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	var req UpdateLocationRequest
	if apiErr := validator.DecodeAndValidate(w, r, h.maxBodyBytes, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	loc, err := h.svc.UpdateMyLocation(r.Context(), user.ID, req)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, loc)
}

func (h *Handler) GetMyPreferences(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	user, ok := GetAuthUser(r.Context())
	if !ok {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	pref, err := h.svc.GetMyPreferences(r.Context(), user.ID)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, "Failed to retrieve dating preferences"))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, pref)
}

func (h *Handler) UpdateMyPreferences(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	user, ok := GetAuthUser(r.Context())
	if !ok {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	var req UpdatePreferencesRequest
	if apiErr := validator.DecodeAndValidate(w, r, h.maxBodyBytes, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	pref, err := h.svc.UpdateMyPreferences(r.Context(), user.ID, req)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, pref)
}

func extractClientInfo(r *http.Request) ClientInfo {
	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" {
		ip = r.RemoteAddr
	} else {
		// Take first IP in forward list
		if idx := strings.Index(ip, ","); idx != -1 {
			ip = strings.TrimSpace(ip[:idx])
		}
	}
	return ClientInfo{
		DeviceFingerprint: r.Header.Get("X-Device-Fingerprint"),
		UserAgent:         r.UserAgent(),
		IPAddress:         ip,
	}
}

func errorsIs(err, target error) bool {
	return strings.Contains(err.Error(), target.Error())
}

func (h *Handler) AdminUsers(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		return
	}

	roleFilter := r.URL.Query().Get("role")
	statusFilter := r.URL.Query().Get("status")
	search := r.URL.Query().Get("search")
	limit := 50
	offset := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if val, err := strconv.Atoi(l); err == nil && val > 0 {
			limit = val
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if val, err := strconv.Atoi(o); err == nil && val >= 0 {
			offset = val
		}
	}

	users, total, err := h.svc.ListUsers(r.Context(), roleFilter, statusFilter, search, limit, offset)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"users":  users,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *Handler) AdminUpdateRole(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPut && r.Method != http.MethodPatch && r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		return
	}

	authUser, ok := GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	pathParts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(pathParts) < 4 {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "User ID missing from URL path"))
		return
	}
	targetUserID := pathParts[3]

	var req struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Invalid request body"))
		return
	}

	err := h.svc.UpdateUserRole(r.Context(), authUser.ID, targetUserID, UserRole(req.Role))
	if err != nil {
		if strings.Contains(err.Error(), "self-action prohibited") {
			apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "SELF_ACTION_PROHIBITED", err.Error()))
			return
		}
		if errors.Is(err, ErrUserNotFound) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "User not found"))
			return
		}
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"user_id": targetUserID,
		"role":    req.Role,
		"updated": true,
	})
}

func (h *Handler) AdminSupportUnlock(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST is allowed"))
		return
	}

	authUser, ok := GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	var req struct {
		UserID string `json:"user_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil || strings.TrimSpace(req.UserID) == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Target user_id is required"))
		return
	}

	if err := h.svc.UnlockAccount(r.Context(), authUser.ID, req.UserID); err != nil {
		if strings.Contains(err.Error(), "self-action prohibited") {
			apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "SELF_ACTION_PROHIBITED", err.Error()))
			return
		}
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"user_id":  req.UserID,
		"unlocked": true,
	})
}

func (h *Handler) AdminSupportResetPassword(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST is allowed"))
		return
	}

	authUser, ok := GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	var req struct {
		UserID string `json:"user_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil || strings.TrimSpace(req.UserID) == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Target user_id is required"))
		return
	}

	reset, err := h.svc.AdminResetPassword(r.Context(), authUser.ID, req.UserID)
	if err != nil {
		if strings.Contains(err.Error(), "self-action prohibited") {
			apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "SELF_ACTION_PROHIBITED", err.Error()))
			return
		}
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"user_id":    req.UserID,
		"expires_at": reset.ExpiresAt,
		"message":    "Password reset link generated and dispatched to member email",
	})
}
