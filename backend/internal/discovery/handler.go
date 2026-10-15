package discovery

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

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

// Feed handles GET /api/v1/discovery/feed.
func (h *Handler) Feed(w http.ResponseWriter, r *http.Request) {
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

	limit := 20
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 50 {
			limit = l
		}
	}
	cursor := r.URL.Query().Get("cursor")

	feed, err := h.svc.GetDiscoveryFeed(r.Context(), authUser.ID, cursor, limit)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, feed)
}

// MatchingSummary handles GET /api/v1/discovery/matching-summary.
func (h *Handler) MatchingSummary(w http.ResponseWriter, r *http.Request) {
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

	summary, err := h.svc.GetMatchingSummary(r.Context(), authUser.ID)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, summary)
}

// Swipe handles POST /api/v1/swipes.
func (h *Handler) Swipe(w http.ResponseWriter, r *http.Request) {
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

	var req SwipeRequest
	if apiErr := validator.DecodeAndValidate(w, r, 64*1024, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	resp, err := h.svc.Swipe(r.Context(), authUser.ID, req, reqID)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, resp)
}

// Matches handles GET /api/v1/matches.
func (h *Handler) Matches(w http.ResponseWriter, r *http.Request) {
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

	matches, err := h.svc.ListMatches(r.Context(), authUser.ID)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"count":   len(matches),
		"matches": matches,
	})
}

// MatchDetail handles GET /api/v1/matches/{id}.
func (h *Handler) MatchDetail(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	pathRem := strings.TrimPrefix(r.URL.Path, "/api/v1/matches/")
	parts := strings.Split(pathRem, "/")
	matchID := parts[0]
	if matchID == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Match ID required in path"))
		return
	}

	// Sub-action: /unmatch
	if len(parts) > 1 && parts[1] == "unmatch" {
		if r.Method != http.MethodPost {
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST allowed for unmatch"))
			return
		}
		if err := h.svc.Unmatch(r.Context(), matchID, authUser.ID); err != nil {
			h.handleServiceError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, map[string]any{
			"status":   "UNMATCHED",
			"match_id": matchID,
		})
		return
	}

	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET is allowed"))
		return
	}

	resp, err := h.svc.GetMatch(r.Context(), matchID, authUser.ID)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, resp)
}

// Block handles POST /api/v1/blocks.
func (h *Handler) Block(w http.ResponseWriter, r *http.Request) {
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

	var req BlockRequest
	if apiErr := validator.DecodeAndValidate(w, r, 64*1024, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	if err := h.svc.BlockUser(r.Context(), authUser.ID, req.TargetUserID, req.Reason); err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusCreated, map[string]any{
		"status":  "BLOCKED",
		"user_id": req.TargetUserID,
	})
}

func (h *Handler) handleServiceError(w http.ResponseWriter, reqID string, err error) {
	switch {
	case errors.Is(err, ErrMatchNotFound):
		apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Match not found or access denied"))
	case errors.Is(err, ErrSelfSwipe):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Cannot swipe on yourself"))
	case errors.Is(err, ErrCandidateBlocked):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Interaction between users is blocked"))
	case errors.Is(err, ErrSwipePhotoMinimumRequired):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, "PHOTO_MINIMUM_REQUIRED", err.Error()))
	case errors.Is(err, ErrCandidateInvalid):
		apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Candidate profile not found or inactive"))
	case errors.Is(err, ErrSwipeLimitReached):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeBusinessRuleViolation, "Daily free swipe limit reached; match reward or subscription boost required"))
	case errors.Is(err, ErrBonusLikesVerifiedOnly):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "BONUS_LIKES_VERIFIED_ONLY", err.Error()))
	default:
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
	}
}

// AdMobSSV handles GET /api/v1/ads/admob/ssv.
// Google AdMob servers deliver SSV callbacks via HTTP GET with cryptographic query parameters.
func (h *Handler) AdMobSSV(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		return
	}

	reward, err := h.svc.VerifyAndGrantAdReward(r.Context(), r.URL.RawQuery)
	if err != nil {
		switch {
		case errors.Is(err, ErrDuplicateSSVReward):
			apperror.WriteError(w, reqID, apperror.New(http.StatusConflict, apperror.CodeConflict, "Reward transaction already processed"))
		case errors.Is(err, ErrExpiredSSVCallback):
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Reward callback expired"))
		case errors.Is(err, ErrInvalidSSVSignature):
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Invalid cryptographic signature"))
		default:
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
		}
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"status":         "REWARD_VERIFIED",
		"user_id":        reward.UserID,
		"reward_amount":  reward.RewardAmount,
		"transaction_id": reward.TransactionID,
	})
}

// Allowance handles GET /api/v1/swipes/allowance.
func (h *Handler) Allowance(w http.ResponseWriter, r *http.Request) {
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

	detail, err := h.svc.GetSwipeAllowanceDetail(r.Context(), authUser.ID)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"user_id":                 authUser.ID,
		"daily_quota":             detail.DailyQuota,
		"remaining_likes":         detail.RemainingLikes,
		"remaining_regular_likes": detail.RemainingRegularLikes,
		"remaining_bonus_likes":   detail.RemainingBonusLikes,
		"is_unlimited":            detail.IsUnlimited,
		"is_introductory":         detail.IsIntroductory,
		"window_start":            detail.WindowStart,
		"window_reset_at":         detail.WindowResetAt,
	})
}

// Rewind handles POST /api/v1/swipes/rewind.
func (h *Handler) Rewind(w http.ResponseWriter, r *http.Request) {
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

	resp, err := h.svc.Rewind(r.Context(), authUser.ID)
	if err != nil {
		if errors.Is(err, ErrRewindNotEntitled) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, err.Error()))
			return
		}
		if errors.Is(err, ErrNoSwipeToRewind) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
			return
		}
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, resp)
}
