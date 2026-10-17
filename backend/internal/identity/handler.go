package identity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
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
	svc           *Service
	maxBodyBytes  int64
	expoGoURLBase string
}

func NewHandler(svc *Service, maxBodyBytes int64) *Handler {
	if maxBodyBytes <= 0 {
		maxBodyBytes = 1024 * 1024 // 1 MB default
	}
	return &Handler{
		svc:           svc,
		maxBodyBytes:  maxBodyBytes,
		expoGoURLBase: "exp://192.168.29.15:8081/--/reset-password",
	}
}

func (h *Handler) SetExpoGoURLBase(u string) {
	trimmed := strings.TrimSpace(u)
	if trimmed != "" {
		h.expoGoURLBase = trimmed
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

func (h *Handler) GoogleAuth(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		return
	}

	var req GoogleAuthRequest
	if apiErr := validator.DecodeAndValidate(w, r, h.maxBodyBytes, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	if strings.TrimSpace(req.IDToken) == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, "id_token is required"))
		return
	}

	clientInfo := extractClientInfo(r)
	resp, err := h.svc.AuthenticateWithGoogle(r.Context(), req, clientInfo)
	if err != nil {
		if errorsIs(err, ErrAccountNotActive) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Account is suspended or deactivated"))
			return
		}
		if errorsIs(err, ErrOAuthEmailNotVerified) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, "Google email is not verified"))
			return
		}
		if errorsIs(err, ErrInvalidOAuthToken) || strings.Contains(strings.ToLower(err.Error()), "token") {
			apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, err.Error()))
			return
		}
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, err.Error()))
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

	clientInfo := extractClientInfo(r)
	_, err := h.svc.RequestPasswordReset(r.Context(), req.Email, clientInfo.IPAddress)
	if err != nil {
		if errors.Is(err, ErrResetRateLimited) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusTooManyRequests, apperror.CodeRateLimitExceeded, "Please wait before requesting another password reset email"))
			return
		}
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
		return
	}

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

// ResetPasswordWebPage serves an HTML password reset landing page.
// It acts as a bridge to open the Aura mobile app in Expo Go or as a standalone app,
// while providing an in-browser form to reset the password directly on the phone or PC.
func (h *Handler) ResetPasswordWebPage(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")

	rawToken := strings.TrimSpace(r.URL.Query().Get("token"))
	if rawToken == "" {
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, renderMissingTokenHTML())
		return
	}

	safeToken := html.EscapeString(rawToken)
	escapedToken := url.QueryEscape(rawToken)

	expoBase := h.expoGoURLBase
	if expoBase == "" {
		expoBase = "exp://192.168.29.15:8081/--/reset-password"
	}
	expoGoURL := fmt.Sprintf("%s?token=%s", expoBase, escapedToken)
	standaloneURL := fmt.Sprintf("aura://reset-password?token=%s", escapedToken)

	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprint(w, renderResetFormHTML(safeToken, expoGoURL, standaloneURL))
}

func renderMissingTokenHTML() string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Reset Password — Aura</title>
  <style>
    body { margin: 0; padding: 24px 16px; background-color: #0b0b0c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #f5f5f7; display: flex; justify-content: center; align-items: center; min-height: 90vh; }
    .card { background-color: #161618; border: 1px solid #2a2a2e; border-radius: 16px; max-width: 440px; width: 100%; padding: 36px 28px; text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
    .monogram { width: 56px; height: 56px; border-radius: 28px; border: 1.5px solid #d4af37; color: #d4af37; font-weight: 700; font-size: 24px; line-height: 56px; margin: 0 auto 16px auto; }
    .brand { color: #d4af37; font-size: 18px; font-weight: 700; letter-spacing: 3px; margin: 0; }
    .tagline { color: #8e8e93; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 4px; }
    h1 { color: #f5f5f7; font-size: 20px; font-weight: 600; margin: 24px 0 12px 0; }
    p { color: #a1a1a6; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0; }
    .btn { display: inline-block; background-color: #d4af37; color: #0b0b0c; font-weight: 700; font-size: 14px; padding: 14px 28px; border-radius: 10px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="monogram">A</div>
    <div class="brand">AURA</div>
    <div class="tagline">Exclusive LGBTQ+ Dating</div>
    <h1>Reset Link Incomplete</h1>
    <p>This password recovery link does not contain a valid security token. Please click the full link received in your email or request a new recovery link from the Aura app.</p>
    <a href="aura://forgot-password" class="btn">Return to Aura</a>
  </div>
</body>
</html>`
}

func renderResetFormHTML(safeToken, expoGoURL, standaloneURL string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Reset Password — Aura</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px 16px; background-color: #0b0b0c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #f5f5f7; display: flex; justify-content: center; align-items: center; min-height: 95vh; }
    .card { background-color: #161618; border: 1px solid #2a2a2e; border-radius: 16px; max-width: 440px; width: 100%%; padding: 32px 24px; box-shadow: 0 12px 40px rgba(0,0,0,0.5); }
    .header { text-align: center; margin-bottom: 24px; }
    .monogram { width: 52px; height: 52px; border-radius: 26px; border: 1.5px solid #d4af37; color: #d4af37; font-weight: 700; font-size: 22px; line-height: 52px; margin: 0 auto 12px auto; }
    .brand { color: #d4af37; font-size: 18px; font-weight: 700; letter-spacing: 3px; margin: 0; }
    .tagline { color: #8e8e93; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 4px; }
    h1 { color: #f5f5f7; font-size: 20px; font-weight: 600; margin: 16px 0 6px 0; text-align: center; }
    .subtitle { color: #8e8e93; font-size: 13px; text-align: center; margin: 0 0 20px 0; }
    .app-box { background-color: #1a1a1d; border: 1px solid #2a2a2e; border-radius: 12px; padding: 18px; margin-bottom: 20px; text-align: center; }
    .app-title { font-size: 13px; font-weight: 600; color: #f5f5f7; margin-bottom: 12px; }
    .btn-expo { display: block; background-color: #d4af37; color: #0b0b0c; font-weight: 700; font-size: 14px; padding: 13px 18px; border-radius: 8px; text-decoration: none; text-align: center; margin-bottom: 10px; transition: opacity 0.2s; }
    .btn-expo:hover { opacity: 0.9; }
    .btn-standalone { display: block; background-color: #26262a; color: #d4af37; border: 1px solid #3a3a40; font-weight: 600; font-size: 13px; padding: 10px 18px; border-radius: 8px; text-decoration: none; text-align: center; }
    .divider { display: flex; align-items: center; text-align: center; margin: 24px 0 20px 0; }
    .divider::before, .divider::after { content: ''; flex: 1; border-bottom: 1px solid #2a2a2e; }
    .divider span { color: #636366; font-size: 11px; font-weight: 600; letter-spacing: 1px; padding: 0 10px; text-transform: uppercase; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 12px; font-weight: 500; color: #a1a1a6; margin-bottom: 6px; }
    .input-wrapper { position: relative; }
    input[type="password"], input[type="text"] { width: 100%%; background-color: #0b0b0c; border: 1px solid #2a2a2e; border-radius: 8px; padding: 12px 42px 12px 14px; color: #f5f5f7; font-size: 14px; outline: none; transition: border-color 0.2s; }
    input:focus { border-color: #d4af37; }
    .toggle-pwd { position: absolute; right: 12px; top: 50%%; transform: translateY(-50%%); background: none; border: none; color: #8e8e93; font-size: 12px; cursor: pointer; padding: 4px; }
    .toggle-pwd:hover { color: #d4af37; }
    .checklist { background-color: #0b0b0c; border: 1px solid #2a2a2e; border-radius: 8px; padding: 12px 14px; margin-bottom: 18px; }
    .checklist-title { font-size: 11px; font-weight: 600; color: #8e8e93; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
    .checklist-item { font-size: 12px; color: #8e8e93; margin: 4px 0; display: flex; align-items: center; }
    .checklist-item.valid { color: #4ade80; }
    .checklist-icon { width: 16px; font-weight: 700; margin-right: 6px; }
    .submit-btn { width: 100%%; background-color: #d4af37; color: #0b0b0c; font-weight: 700; font-size: 15px; padding: 14px; border: none; border-radius: 8px; cursor: pointer; transition: opacity 0.2s; }
    .submit-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .alert { display: none; padding: 12px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; text-align: center; line-height: 1.4; }
    .alert-error { background-color: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #fca5a5; }
    .success-view { display: none; text-align: center; padding: 16px 0; }
    .success-badge { width: 60px; height: 60px; border-radius: 30px; border: 2px solid #4ade80; color: #4ade80; font-size: 32px; line-height: 56px; margin: 0 auto 16px auto; }
    .success-title { font-size: 20px; font-weight: 600; color: #f5f5f7; margin-bottom: 10px; }
    .success-desc { font-size: 14px; color: #a1a1a6; line-height: 1.6; margin-bottom: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="monogram">A</div>
      <div class="brand">AURA</div>
      <div class="tagline">Exclusive LGBTQ+ Dating</div>
    </div>

    <!-- Active Reset View -->
    <div id="reset-view">
      <h1>Account Recovery</h1>
      <p class="subtitle">Open in Aura or reset password below</p>

      <div class="app-box">
        <div class="app-title">📱 Open in Aura Mobile App</div>
        <a href="%s" class="btn-expo">Open in Expo Go</a>
        <a href="%s" class="btn-standalone">Open in Aura App (Standalone)</a>
      </div>

      <div class="divider"><span>OR RESET IN BROWSER</span></div>

      <div id="alert-error" class="alert alert-error"></div>

      <form id="reset-form" onsubmit="handleFormSubmit(event)">
        <input type="hidden" id="token" value="%s">

        <div class="form-group">
          <label for="new_password">New Password</label>
          <div class="input-wrapper">
            <input type="password" id="new_password" placeholder="••••••••••••" autocomplete="new-password" required oninput="validateForm()">
            <button type="button" class="toggle-pwd" onclick="togglePasswordVisibility('new_password', this)">Show</button>
          </div>
        </div>

        <div class="form-group">
          <label for="confirm_password">Confirm New Password</label>
          <div class="input-wrapper">
            <input type="password" id="confirm_password" placeholder="••••••••••••" autocomplete="new-password" required oninput="validateForm()">
            <button type="button" class="toggle-pwd" onclick="togglePasswordVisibility('confirm_password', this)">Show</button>
          </div>
        </div>

        <div class="checklist">
          <div class="checklist-title">Password Requirements:</div>
          <div id="chk-len" class="checklist-item"><span class="checklist-icon">○</span> At least 8 characters (max 128)</div>
          <div id="chk-num" class="checklist-item"><span class="checklist-icon">○</span> At least one numeric digit (0–9)</div>
          <div id="chk-spec" class="checklist-item"><span class="checklist-icon">○</span> At least one special character (!@#$...)</div>
          <div id="chk-match" class="checklist-item"><span class="checklist-icon">○</span> Passwords match</div>
        </div>

        <button type="submit" id="submit-btn" class="submit-btn" disabled>Update Password</button>
      </form>
    </div>

    <!-- Success View -->
    <div id="success-view" class="success-view">
      <div class="success-badge">✓</div>
      <div class="success-title">Password Updated!</div>
      <div class="success-desc">Your password has been changed securely and all active sessions have been invalidated. You can now open Aura and sign in with your new password.</div>
      <a href="aura://login" class="btn-expo" style="margin-bottom: 10px;">Sign In via Aura App</a>
      <a href="exp://192.168.29.15:8081/--/login" class="btn-standalone">Sign In via Expo Go</a>
    </div>
  </div>

  <script>
    function togglePasswordVisibility(id, btn) {
      var input = document.getElementById(id);
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'Hide';
      } else {
        input.type = 'password';
        btn.textContent = 'Show';
      }
    }

    function validateForm() {
      var pwd = document.getElementById('new_password').value;
      var conf = document.getElementById('confirm_password').value;

      var hasLen = pwd.length >= 8 && pwd.length <= 128;
      var hasNum = /\d/.test(pwd);
      var hasSpec = /[!@#$%%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd);
      var hasMatch = pwd.length > 0 && pwd === conf;

      updateChecklistItem('chk-len', hasLen);
      updateChecklistItem('chk-num', hasNum);
      updateChecklistItem('chk-spec', hasSpec);
      updateChecklistItem('chk-match', hasMatch);

      var isValid = hasLen && hasNum && hasSpec && hasMatch;
      document.getElementById('submit-btn').disabled = !isValid;
      return isValid;
    }

    function updateChecklistItem(id, valid) {
      var el = document.getElementById(id);
      if (!el) return;
      if (valid) {
        el.className = 'checklist-item valid';
        el.querySelector('.checklist-icon').textContent = '✓';
      } else {
        el.className = 'checklist-item';
        el.querySelector('.checklist-icon').textContent = '○';
      }
    }

    async function handleFormSubmit(e) {
      e.preventDefault();
      if (!validateForm()) return;

      var submitBtn = document.getElementById('submit-btn');
      var alertError = document.getElementById('alert-error');
      var token = document.getElementById('token').value;
      var newPassword = document.getElementById('new_password').value;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Updating Password...';
      alertError.style.display = 'none';

      try {
        var resp = await fetch('/api/v1/auth/password-reset/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, new_password: newPassword })
        });

        if (resp.ok) {
          document.getElementById('reset-view').style.display = 'none';
          document.getElementById('success-view').style.display = 'block';
        } else {
          var errData = {};
          try { errData = await resp.json(); } catch (_) {}
          var msg = errData.message || 'The reset token is invalid or has expired. Please request a new recovery link in Aura.';
          alertError.textContent = msg;
          alertError.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Update Password';
        }
      } catch (err) {
        alertError.textContent = 'Network connection failed. Please ensure the Aura server is reachable.';
        alertError.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Update Password';
      }
    }
  </script>
</body>
</html>`, expoGoURL, standaloneURL, safeToken)
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
