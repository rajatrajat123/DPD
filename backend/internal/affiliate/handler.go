package affiliate

import (
	"encoding/json"
	"errors"
	"fmt"
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

type StepUpVerifier interface {
	VerifyStepUpToken(tokenStr string, expectedUserID string) error
}

type Handler struct {
	svc            *Service
	stepUpVerifier StepUpVerifier
	logger         *slog.Logger
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

func (h *Handler) SetStepUpVerifier(v StepUpVerifier) {
	h.stepUpVerifier = v
}

// Register handles POST /api/v1/affiliates/register.
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
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

	var req RegisterAffiliateRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed request body"))
		return
	}

	aff, err := h.svc.RegisterAffiliate(r.Context(), authUser.ID, req)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusCreated, aff)
}

// Me handles GET /api/v1/affiliates/me.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
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

	aff, err := h.svc.repo.GetAffiliateByUserID(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	summary, err := h.svc.GetAffiliateSummary(r.Context(), aff.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, summary)
}

// UpdatePayoutSettings handles PUT /api/v1/affiliates/me/payout-settings.
func (h *Handler) UpdatePayoutSettings(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPut {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only PUT is allowed"))
		return
	}

	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	aff, err := h.svc.repo.GetAffiliateByUserID(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	var req UpdateAffiliatePayoutSettingsRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed request body"))
		return
	}

	if err := h.svc.repo.UpdateAffiliatePayoutSettings(r.Context(), aff.ID, req); err != nil {
		h.handleError(w, reqID, err)
		return
	}

	updated, _ := h.svc.repo.GetAffiliateByID(r.Context(), aff.ID)
	apperror.WriteJSON(w, http.StatusOK, updated)
}

// Campaigns handles GET and POST on /api/v1/affiliates/campaigns.
func (h *Handler) Campaigns(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	aff, err := h.svc.repo.GetAffiliateByUserID(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	switch r.Method {
	case http.MethodGet:
		camps, err := h.svc.repo.ListCampaigns(r.Context(), aff.ID)
		if err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, map[string]any{"campaigns": camps, "count": len(camps)})

	case http.MethodPost:
		var req CreateCampaignRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed request body"))
			return
		}
		slug := strings.ToLower(strings.TrimSpace(req.CampaignSlug))
		if slug == "" {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeValidationFailed, "campaign_slug is required"))
			return
		}
		dest := req.DestinationURL
		if dest == "" {
			dest = "https://auradating.com"
		}
		camp := &AffiliateCampaign{
			AffiliateID:    aff.ID,
			CampaignSlug:   slug,
			Name:           req.Name,
			DestinationURL: dest,
			IsActive:       true,
		}
		if err := h.svc.repo.CreateCampaign(r.Context(), camp); err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusCreated, camp)

	default:
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
	}
}

// ConversionsReport handles GET /api/v1/affiliates/reports/conversions.
func (h *Handler) ConversionsReport(w http.ResponseWriter, r *http.Request) {
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

	aff, err := h.svc.repo.GetAffiliateByUserID(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	limit := 50
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	comms, err := h.svc.repo.ListCommissionsByAffiliate(r.Context(), aff.ID, limit)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	// Anonymized reporting: privacy-preserving for users
	items := make([]ConversionReportItem, 0, len(comms))
	for _, c := range comms {
		items = append(items, ConversionReportItem{
			CommissionID:     c.ID,
			OccurredAt:       c.CreatedAt,
			CycleIndex:       c.BillingCycleIndex,
			GrossAmount:      c.GrossAmountCents,
			CommissionAmount: c.CommissionAmountCents,
			Currency:         c.Currency,
			Status:           c.Status,
			MaturesAt:        c.MaturesAt,
		})
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"conversions": items,
		"count":       len(items),
	})
}

// LedgerBalance handles GET /api/v1/affiliates/ledger/balance.
func (h *Handler) LedgerBalance(w http.ResponseWriter, r *http.Request) {
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

	aff, err := h.svc.repo.GetAffiliateByUserID(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	pendingEscrow, payable, lifetimePaid, err := h.svc.repo.GetAffiliateBalances(r.Context(), aff.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, AffiliateBalanceSummary{
		PendingEscrowCents: pendingEscrow,
		PayableCents:       payable,
		LifetimePaidCents:  lifetimePaid,
		Currency:           aff.PayoutCurrency,
	})
}

// RequestPayout handles POST /api/v1/affiliates/payouts/request.
func (h *Handler) RequestPayout(w http.ResponseWriter, r *http.Request) {
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

	aff, err := h.svc.repo.GetAffiliateByUserID(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	var req RequestPayoutRequest
	_ = json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req)

	batch, err := h.svc.RequestPayout(r.Context(), aff.ID, req)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusAccepted, batch)
}

// Payouts handles GET /api/v1/affiliates/payouts.
func (h *Handler) Payouts(w http.ResponseWriter, r *http.Request) {
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

	aff, err := h.svc.repo.GetAffiliateByUserID(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	limit := 50
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	payouts, err := h.svc.repo.ListPayoutsByAffiliate(r.Context(), aff.ID, limit)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{"payouts": payouts, "count": len(payouts)})
}

// ReferralRedirect handles GET /r/{partner_code} and records click.
func (h *Handler) ReferralRedirect(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET is allowed"))
		return
	}

	// Extract partner_code from URL path (e.g. /r/AURA1234)
	prefix := "/r/"
	if !strings.HasPrefix(r.URL.Path, prefix) {
		prefix = "/api/v1/affiliates/r/"
	}
	partnerCode := strings.TrimPrefix(r.URL.Path, prefix)
	partnerCode = strings.Trim(partnerCode, "/")

	subID := r.URL.Query().Get("sub_id")
	if subID == "" {
		subID = r.URL.Query().Get("campaign")
	}

	clientIP := r.RemoteAddr
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		clientIP = strings.Split(forwarded, ",")[0]
	}

	resp, err := h.svc.TrackClick(r.Context(), TrackClickRequest{
		PartnerCode:  partnerCode,
		CampaignSlug: subID,
		LandingURL:   r.URL.String(),
		ClientIP:     clientIP,
		UserAgent:    r.UserAgent(),
	})
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	// Set signed 30-day first-party cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "aura_ref",
		Value:    fmt.Sprintf("%s:%s", partnerCode, resp.ClickToken),
		Path:     "/",
		MaxAge:   30 * 24 * 3600, // 30 days
		HttpOnly: true,
		Secure:   false, // local dev compatible
		SameSite: http.SameSiteLaxMode,
	})

	if r.Header.Get("Accept") == "application/json" {
		apperror.WriteJSON(w, http.StatusOK, resp)
		return
	}

	http.Redirect(w, r, resp.DestinationURL, http.StatusFound)
}

// ValidatePartner handles GET /api/v1/affiliates/validate/{partner_code}.
func (h *Handler) ValidatePartner(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET is allowed"))
		return
	}

	prefix := "/api/v1/affiliates/validate/"
	code := strings.TrimPrefix(r.URL.Path, prefix)
	code = strings.Trim(code, "/")
	if err := h.svc.ValidatePartnerCode(r.Context(), code); err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"valid":        true,
		"partner_code": strings.ToUpper(strings.TrimSpace(code)),
	})
}

// Referrals handles GET /api/v1/affiliates/referrals.
func (h *Handler) Referrals(w http.ResponseWriter, r *http.Request) {
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

	aff, err := h.svc.repo.GetAffiliateByUserID(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	limit := 50
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	attrs, err := h.svc.repo.ListAttributionsByAffiliate(r.Context(), aff.ID, limit)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	type ReferralItem struct {
		ID           string    `json:"id"`
		PartnerCode  string    `json:"partner_code"`
		SubCampaign  *string   `json:"sub_campaign,omitempty"`
		AttributedAt time.Time `json:"attributed_at"`
	}

	items := make([]ReferralItem, 0, len(attrs))
	for _, a := range attrs {
		items = append(items, ReferralItem{
			ID:           a.ID,
			PartnerCode:  a.PartnerCode,
			SubCampaign:  a.SubCampaign,
			AttributedAt: a.AttributedAt,
		})
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"referrals": items,
		"count":     len(items),
	})
}

// Admin handlers
func (h *Handler) AdminListAffiliates(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if !h.checkAdmin(w, r, reqID) {
		return
	}

	affs, err := h.svc.repo.ListAffiliates(r.Context(), 100)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{"affiliates": affs, "count": len(affs)})
}

func (h *Handler) AdminUpdateAffiliateStatus(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if !h.checkAdmin(w, r, reqID) {
		return
	}

	prefix := "/api/v1/admin/affiliates/"
	affID := strings.TrimPrefix(r.URL.Path, prefix)
	affID = strings.TrimSuffix(affID, "/status")
	affID = strings.Trim(affID, "/")

	authUser, _ := identity.GetAuthUser(r.Context())
	targetAff, err := h.svc.repo.GetAffiliateByID(r.Context(), affID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}
	if authUser != nil && targetAff.UserID == authUser.ID {
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Self-modification of affiliate status or tier is prohibited"))
		return
	}

	var req AdminUpdateAffiliateStatusRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed request body"))
		return
	}

	if err := h.svc.repo.UpdateAffiliateStatus(r.Context(), affID, req.Status, req.Tier, req.TaxFormVerified); err != nil {
		h.handleError(w, reqID, err)
		return
	}

	updated, _ := h.svc.repo.GetAffiliateByID(r.Context(), affID)
	apperror.WriteJSON(w, http.StatusOK, updated)
}

func (h *Handler) AdminCommissionRules(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if !h.checkAdmin(w, r, reqID) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		rules, err := h.svc.repo.ListCommissionRules(r.Context())
		if err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, map[string]any{"rules": rules, "count": len(rules)})

	case http.MethodPost:
		var req AdminCommissionRuleRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Malformed request body"))
			return
		}
		rule := &CommissionRule{
			Name:               req.Name,
			AffiliateTier:      req.AffiliateTier,
			Model:              req.Model,
			CPAAmountCents:     req.CPAAmountCents,
			RevshareBps:        req.RevshareBps,
			RecurringEnabled:   req.RecurringEnabled,
			MaxRecurringMonths: req.MaxRecurringMonths,
			EscrowHoldDays:     req.EscrowHoldDays,
		}
		if err := h.svc.repo.UpsertCommissionRule(r.Context(), rule); err != nil {
			h.handleError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, rule)

	default:
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
	}
}

func (h *Handler) AdminPayouts(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if !h.checkAdmin(w, r, reqID) {
		return
	}

	// Check if approve or reject action
	if strings.HasSuffix(r.URL.Path, "/approve") {
		h.adminApprovePayout(w, r, reqID)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/reject") {
		h.adminRejectPayout(w, r, reqID)
		return
	}

	payouts, err := h.svc.repo.ListPendingPayouts(r.Context(), 50)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{"payouts": payouts, "count": len(payouts)})
}

func (h *Handler) adminApprovePayout(w http.ResponseWriter, r *http.Request, reqID string) {
	prefix := "/api/v1/admin/payouts/"
	batchID := strings.TrimPrefix(r.URL.Path, prefix)
	batchID = strings.TrimSuffix(batchID, "/approve")
	batchID = strings.Trim(batchID, "/")

	authUser, _ := identity.GetAuthUser(r.Context())
	stepUp := r.Header.Get("X-Aura-Step-Up")
	if h.stepUpVerifier != nil {
		userID := ""
		if authUser != nil {
			userID = authUser.ID
		}
		if err := h.stepUpVerifier.VerifyStepUpToken(stepUp, userID); err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "STEP_UP_REQUIRED", "Valid, server-verified step-up authentication required for financial disbursement"))
			return
		}
	} else if stepUp != "verified" && stepUp != "step-up-pass" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "STEP_UP_REQUIRED", "Step-up authentication required for financial disbursement"))
		return
	}

	batchRecord, err := h.svc.repo.GetPayoutBatchByID(r.Context(), batchID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}
	aff, err := h.svc.repo.GetAffiliateByID(r.Context(), batchRecord.AffiliateID)
	if err == nil && aff != nil && authUser != nil && aff.UserID == authUser.ID {
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Self-approval of payout batches is strictly prohibited"))
		return
	}

	batch, err := h.svc.ApproveAndDisbursePayout(r.Context(), batchID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, batch)
}

func (h *Handler) adminRejectPayout(w http.ResponseWriter, r *http.Request, reqID string) {
	prefix := "/api/v1/admin/payouts/"
	batchID := strings.TrimPrefix(r.URL.Path, prefix)
	batchID = strings.TrimSuffix(batchID, "/reject")
	batchID = strings.Trim(batchID, "/")

	var body struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&body)
	if body.Reason == "" {
		body.Reason = "Administrative rejection"
	}

	batch, err := h.svc.RejectPayout(r.Context(), batchID, body.Reason)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, batch)
}

func (h *Handler) checkAdmin(w http.ResponseWriter, r *http.Request, reqID string) bool {
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return false
	}
	if authUser.Role != identity.RoleFinanceAdmin && authUser.Role != identity.RoleSuperAdmin {
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Admin privileges required"))
		return false
	}
	return true
}

// UserReferralMe handles GET /api/v1/referrals/me.
func (h *Handler) UserReferralMe(w http.ResponseWriter, r *http.Request) {
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

	status, err := h.svc.GetUserReferralStatus(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, status)
}

// UserReferralRefresh handles POST /api/v1/referrals/refresh.
func (h *Handler) UserReferralRefresh(w http.ResponseWriter, r *http.Request) {
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

	status, err := h.svc.EvaluateUserReferralReward(r.Context(), authUser.ID)
	if err != nil {
		h.handleError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, status)
}

func (h *Handler) handleError(w http.ResponseWriter, reqID string, err error) {
	switch {
	case errors.Is(err, ErrAffiliateNotFound):
		apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Affiliate account not found"))
	case errors.Is(err, ErrAffiliateAlreadyExists):
		apperror.WriteError(w, reqID, apperror.New(http.StatusConflict, apperror.CodeConflict, "Affiliate account already exists"))
	case errors.Is(err, ErrInvalidPartnerCode):
		apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Invalid partner code"))
	case errors.Is(err, ErrAffiliateNotActive):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeBusinessRuleViolation, "Affiliate account is not active"))
	case errors.Is(err, ErrDuplicateAttribution):
		apperror.WriteError(w, reqID, apperror.New(http.StatusConflict, apperror.CodeConflict, "User has already been attributed to an affiliate"))
	case errors.Is(err, ErrSelfReferralBlocked):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeBusinessRuleViolation, "Self-referral is prohibited"))
	case errors.Is(err, ErrInsufficientPayable):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeBusinessRuleViolation, "Insufficient payable balance"))
	case errors.Is(err, ErrPayoutBelowMinimum):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeBusinessRuleViolation, "Payout amount below minimum threshold"))
	case errors.Is(err, ErrTaxFormUnverified):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Tax form verification required before payout"))
	case errors.Is(err, ErrPayoutBatchNotFound):
		apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Payout batch not found"))
	case errors.Is(err, ErrPayoutAlreadyProcessed):
		apperror.WriteError(w, reqID, apperror.New(http.StatusConflict, apperror.CodeConflict, "Payout batch already processed"))
	case errors.Is(err, ErrCryptoPayoutDisabled):
		apperror.WriteError(w, reqID, apperror.New(http.StatusServiceUnavailable, apperror.CodeDependencyUnavailable, "Crypto payouts are currently disabled"))
	default:
		h.logger.Error("affiliate_handler_error", slog.String("error", err.Error()), slog.String("req_id", reqID))
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, "Internal affiliate error"))
	}
}
