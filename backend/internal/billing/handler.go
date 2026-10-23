package billing

import (
	"context"
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
)

type AuditLogger interface {
	RecordAudit(ctx context.Context, actorUserID *string, actorRole, action, targetType, targetID, outcome string, metadata map[string]any) error
}

type Handler struct {
	svc    *Service
	logger *slog.Logger
	audit  AuditLogger
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

func (h *Handler) SetAuditLogger(audit AuditLogger) {
	h.audit = audit
}

// Plans handles GET /api/v1/billing/plans.
func (h *Handler) Plans(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET is allowed"))
		return
	}

	products, err := h.svc.ListProducts(r.Context(), true)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"plans": products,
		"count": len(products),
	})
}

// Policy handles GET /api/v1/billing/policy.
func (h *Handler) Policy(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET is allowed"))
		return
	}

	platform := r.URL.Query().Get("platform")
	storefront := r.URL.Query().Get("storefront")
	hasEntitlement := r.URL.Query().Get("has_external_purchase_entitlement") == "true"

	policy := ResolveStorefrontPolicy(platform, storefront, hasEntitlement, "")
	apperror.WriteJSON(w, http.StatusOK, policy)
}

// Checkout handles POST /api/v1/billing/checkout.
func (h *Handler) Checkout(w http.ResponseWriter, r *http.Request) {
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

	var req CheckoutRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&req); err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed request body"))
		return
	}

	req.PlanCode = strings.TrimSpace(req.PlanCode)
	if req.PlanCode == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, "plan_code is required"))
		return
	}
	if req.Provider == "" {
		req.Provider = ProviderStripe
	}

	session, err := h.svc.CreateCheckout(r.Context(), authUser.ID, authUser.Email, req)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, session)
}

// Verify handles POST /api/v1/billing/verify.
func (h *Handler) Verify(w http.ResponseWriter, r *http.Request) {
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

	var req VerifyPurchaseRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&req); err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed request body"))
		return
	}

	req.PlanCode = strings.TrimSpace(req.PlanCode)
	if req.PlanCode == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, "plan_code is required"))
		return
	}
	if req.Provider == "" {
		req.Provider = ProviderStripe
	}
	req.UserID = authUser.ID

	verified, err := h.svc.VerifyPurchase(r.Context(), authUser.ID, req, reqID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"verified":    true,
		"transaction": verified,
	})
}

// Subscription handles GET /api/v1/billing/subscription.
func (h *Handler) Subscription(w http.ResponseWriter, r *http.Request) {
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

	status, err := h.svc.GetSubscriptionStatus(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, status)
}

// CancelSubscription handles POST /api/v1/billing/subscription/cancel.
func (h *Handler) CancelSubscription(w http.ResponseWriter, r *http.Request) {
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

	sub, err := h.svc.CancelSubscription(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"message":      "Subscription will cancel at current period end",
		"subscription": sub,
	})
}

// Transactions handles GET /api/v1/billing/transactions.
func (h *Handler) Transactions(w http.ResponseWriter, r *http.Request) {
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

	txs, err := h.svc.ListUserTransactions(r.Context(), authUser.ID, limit)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"transactions": txs,
		"count":        len(txs),
	})
}

// Entitlements handles GET /api/v1/billing/entitlements.
func (h *Handler) Entitlements(w http.ResponseWriter, r *http.Request) {
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

	ents, err := h.svc.repo.GetActiveEntitlements(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	if ents == nil {
		ents = make([]UserEntitlement, 0)
	}

	entCodes := make([]string, 0, len(ents))
	seen := make(map[string]struct{})
	for _, e := range ents {
		if _, ok := seen[e.EntitlementCode]; !ok {
			seen[e.EntitlementCode] = struct{}{}
			entCodes = append(entCodes, e.EntitlementCode)
		}
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"entitlements":     entCodes,
		"raw_entitlements": ents,
		"count":            len(entCodes),
	})
}

// BoostStatus handles GET /api/v1/boosts/status.
func (h *Handler) BoostStatus(w http.ResponseWriter, r *http.Request) {
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

	status, err := h.svc.GetBoostStatus(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, status)
}

// ActivateBoost handles POST /api/v1/boosts/activate.
func (h *Handler) ActivateBoost(w http.ResponseWriter, r *http.Request) {
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

	var req ActivateBoostRequest
	_ = json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req)

	res, err := h.svc.ActivateBoost(r.Context(), authUser.ID, req.DurationMinutes)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, res)
}

// SuperLikes handles GET /api/v1/billing/super-likes.
func (h *Handler) SuperLikes(w http.ResponseWriter, r *http.Request) {
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

	credits, err := h.svc.GetSuperLikeCredits(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"credits_remaining": credits,
	})
}

// Webhook handles POST /api/v1/billing/webhooks/{provider}.
func (h *Handler) Webhook(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST is allowed"))
		return
	}

	// Extract provider from URL path (e.g. /api/v1/billing/webhooks/stripe)
	prefix := "/api/v1/billing/webhooks/"
	provider := strings.TrimPrefix(r.URL.Path, prefix)
	provider = strings.Trim(provider, "/")
	if provider == "" {
		provider = ProviderStripe
	}

	rawBody, err := io.ReadAll(io.LimitReader(r.Body, 512*1024))
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Failed to read webhook payload"))
		return
	}

	sig := r.Header.Get("Stripe-Signature")
	if sig == "" {
		sig = r.Header.Get("X-Provider-Signature")
	}
	if sig == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Invalid webhook signature: missing signature header"))
		return
	}

	if err := h.svc.ProcessWebhook(r.Context(), provider, rawBody, sig); err != nil {
		h.logger.Warn("webhook_processing_failed", slog.String("provider", provider), slog.String("error", err.Error()))
		if errors.Is(err, ErrInvalidWebhookSignature) || errors.Is(err, ErrProviderNotConfigured) || strings.Contains(strings.ToLower(err.Error()), "signature") {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Invalid webhook signature"))
			return
		}
		if errors.Is(err, ErrInvalidProvider) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, err.Error()))
			return
		}
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, "Webhook processing error"))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{"received": true})
}

func (h *Handler) handleError(w http.ResponseWriter, reqID string, err error) {
	switch {
	case errors.Is(err, ErrProductNotFound):
		apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Product not found"))
	case errors.Is(err, ErrSubscriptionNotFound):
		apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "No active subscription found"))
	case errors.Is(err, ErrInsufficientBoostCredits):
		apperror.WriteError(w, reqID, apperror.New(http.StatusPaymentRequired, apperror.CodeBusinessRuleViolation, "Insufficient boost credits"))
	case errors.Is(err, ErrInsufficientSuperLikeCredits):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "INSUFFICIENT_SUPER_LIKES", "Insufficient super like credits remaining"))
	case errors.Is(err, ErrActiveBoostRunning):
		apperror.WriteError(w, reqID, apperror.New(http.StatusConflict, apperror.CodeConflict, "A profile boost is already active"))
	case errors.Is(err, ErrInvalidProvider):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, err.Error()))
	case errors.Is(err, ErrInvalidWebhookSignature):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Invalid webhook signature"))
	case errors.Is(err, ErrProviderNotConfigured):
		apperror.WriteError(w, reqID, apperror.New(http.StatusServiceUnavailable, "PROVIDER_NOT_CONFIGURED", "Payment provider credentials not configured (BLOCKED): Stripe test API key (STRIPE_SECRET_KEY) is unconfigured in this environment"))
	case errors.Is(err, ErrTermsConsentRequired):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, "Explicit acceptance of subscription terms and auto-renewal is required"))
	case errors.Is(err, ErrIndiaMandateNotCompliant):
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnprocessableEntity, "INDIA_MANDATE_NON_COMPLIANT", "India recurring e-mandate requires verified pre-debit notification sink (BLOCKED)"))
	case errors.Is(err, ErrDuplicateTransaction):
		apperror.WriteError(w, reqID, apperror.New(http.StatusConflict, apperror.CodeConflict, "Duplicate payment transaction or already claimed by another user"))
	case errors.Is(err, ErrPurchaseUserMismatch):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "PURCHASE_USER_MISMATCH", "Store purchase is bound to a different user account"))
	case errors.Is(err, ErrReceiptValidationFailed), errors.Is(err, ErrInvalidReceiptData):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, err.Error()))
	default:
		h.logger.Error("billing_handler_error", slog.String("error", err.Error()), slog.String("req_id", reqID))
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, "Internal billing error"))
	}
}

func (h *Handler) AdminSubscriptions(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		return
	}

	statusFilter := r.URL.Query().Get("status")
	planFilter := r.URL.Query().Get("plan")
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

	subs, total, err := h.svc.AdminListSubscriptions(r.Context(), statusFilter, planFilter, limit, offset)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"subscriptions": subs,
		"total":         total,
		"limit":         limit,
		"offset":        offset,
	})
}

func (h *Handler) AdminTransactions(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		return
	}

	txTypeFilter := r.URL.Query().Get("type")
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

	txs, total, err := h.svc.AdminListTransactions(r.Context(), txTypeFilter, limit, offset)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"transactions": txs,
		"total":        total,
		"limit":        limit,
		"offset":       offset,
	})
}

func (h *Handler) AdminRefund(w http.ResponseWriter, r *http.Request) {
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
		TransactionID string `json:"transaction_id"`
		Reason        string `json:"reason"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil || strings.TrimSpace(req.TransactionID) == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "transaction_id is required"))
		return
	}

	tx, err := h.svc.AdminRefund(r.Context(), authUser.ID, req.TransactionID, req.Reason)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"refund":  tx,
		"message": "Refund processed successfully and outbox audit event emitted",
	})
}

func (h *Handler) AdminUpdateProduct(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPut && r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		return
	}

	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil || authUser.Role != identity.RoleSuperAdmin {
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Super Admin privilege required to modify catalog pricing"))
		return
	}

	planCode := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/billing/products/")
	planCode = strings.Trim(planCode, "/")
	if planCode == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Plan code missing from path"))
		return
	}

	var req struct {
		PriceCents int64  `json:"price_cents"`
		Currency   string `json:"currency"`
		IsActive   *bool  `json:"is_active,omitempty"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed request body"))
		return
	}

	updated, err := h.svc.UpdateProduct(r.Context(), planCode, req.PriceCents, req.Currency, req.IsActive)
	if err != nil {
		if errors.Is(err, ErrProductNotFound) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Product not found in catalog"))
			return
		}
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, err.Error()))
		return
	}

	if h.audit != nil {
		_ = h.audit.RecordAudit(r.Context(), &authUser.ID, string(authUser.Role), "admin.pricing_updated", "BILLING_PRODUCT", planCode, "SUCCESS", map[string]any{
			"new_price_cents": req.PriceCents,
			"currency":        req.Currency,
			"is_active":       updated.IsActive,
		})
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"product": updated,
		"message": "Product catalog pricing updated successfully. Changes to store products must also be configured in Google Play Console and Apple App Store Connect.",
	})
}
