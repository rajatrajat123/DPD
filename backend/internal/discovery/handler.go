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

// Search handles GET /api/v1/discovery/search.
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
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

	q := r.URL.Query().Get("q")
	if q == "" {
		q = r.URL.Query().Get("query")
	}

	resp, err := h.svc.SearchProfiles(r.Context(), authUser.ID, q, limit)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, resp)
}

// GetPublicProfile handles GET /api/v1/profiles/{id}.
func (h *Handler) GetPublicProfile(w http.ResponseWriter, r *http.Request, targetID string) {
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

	cand, err := h.svc.GetPublicProfile(r.Context(), authUser.ID, targetID)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, cand)
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
	case errors.Is(err, ErrSelfFavourite):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Cannot add yourself to favourites"))
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
	case errors.Is(err, ErrBirthdateRequired), errors.Is(err, ErrAgeVerificationRequired):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "AGE_ASSURANCE_REQUIRED", err.Error()))
	case errors.Is(err, ErrUnderageProhibited):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "UNDERAGE_PROHIBITED", err.Error()))
	case errors.Is(err, ErrDiscoveryMessageUsageLimitReached):
		apperror.WriteError(w, reqID, apperror.New(http.StatusTooManyRequests, "USAGE_LIMIT_REACHED", "You've reached your usage limit. Please try again in 3 hours."))
	case errors.Is(err, ErrDiscoveryMessageAwaitingReply):
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "AWAITING_REPLY", "cannot send another message until recipient replies"))
	case errors.Is(err, ErrDiscoveryMessageMaxAdsReached):
		apperror.WriteError(w, reqID, apperror.New(http.StatusTooManyRequests, "MAX_ADS_REACHED", "maximum rewarded ad unlocks reached for current cycle"))
	case errors.Is(err, ErrDiscoveryMessageQuotaLocked):
		apperror.WriteError(w, reqID, apperror.New(http.StatusTooManyRequests, "DISCOVERY_MESSAGE_QUOTA_LOCKED", "Discovery profile messaging quota reached. Watch a rewarded ad to unlock the next 4 profiles."))
	case errors.Is(err, ErrDiscoveryMessageAdAlreadyUnlocked):
		apperror.WriteError(w, reqID, apperror.New(http.StatusConflict, "AD_ALREADY_UNLOCKED", "Rewarded ad bonus has already been unlocked for the current cooldown window."))
	case errors.Is(err, ErrDiscoveryMessageCooldownNotActive):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, "COOLDOWN_NOT_ACTIVE", "Discovery messaging cooldown is not currently active."))
	case errors.Is(err, ErrDuplicateSSVReward):
		apperror.WriteError(w, reqID, apperror.New(http.StatusConflict, apperror.CodeConflict, "Reward transaction already processed (replay blocked)"))
	case errors.Is(err, ErrExpiredSSVCallback), errors.Is(err, ErrInvalidSSVSignature), errors.Is(err, ErrMissingSSVParam):
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
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

// LikesYou handles GET /api/v1/discovery/likes-you.
func (h *Handler) LikesYou(w http.ResponseWriter, r *http.Request) {
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
	offset := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 50 {
			limit = v
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = v
		}
	}

	resp, err := h.svc.GetLikesYou(r.Context(), authUser.ID, limit, offset)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, resp)
}

// RevealLike handles POST /api/v1/discovery/likes-you/reveal.
func (h *Handler) RevealLike(w http.ResponseWriter, r *http.Request) {
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

	var req RevealLikeRequest
	if apiErr := validator.DecodeAndValidate(w, r, 16*1024, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	card, source, err := h.svc.RevealLike(r.Context(), authUser.ID, req.TargetUserID)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, RevealLikeResponse{
		Status: "REVEALED",
		Card:   *card,
		Source: source,
	})
}

// MessageRequests handles GET and POST for /api/v1/discovery/message-requests.
func (h *Handler) MessageRequests(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		folder := r.URL.Query().Get("folder")
		if folder == "" {
			folder = "received"
		}
		requests, err := h.svc.ListMessageRequests(r.Context(), authUser.ID, folder)
		if err != nil {
			h.handleServiceError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, map[string]any{
			"folder":   folder,
			"count":    len(requests),
			"requests": requests,
		})

	case http.MethodPost:
		var req SendMessageRequestPayload
		if apiErr := validator.DecodeAndValidate(w, r, 32*1024, &req); apiErr != nil {
			apperror.WriteError(w, reqID, apiErr)
			return
		}

		created, err := h.svc.SendMessageRequest(r.Context(), authUser.ID, req)
		if err != nil {
			h.handleServiceError(w, reqID, err)
			return
		}

		apperror.WriteJSON(w, http.StatusCreated, created)

	default:
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
	}
}

// RespondMessageRequest handles POST /api/v1/discovery/message-requests/{id}/respond.
func (h *Handler) RespondMessageRequest(w http.ResponseWriter, r *http.Request) {
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

	pathRem := strings.TrimPrefix(r.URL.Path, "/api/v1/discovery/message-requests/")
	parts := strings.Split(pathRem, "/")
	if len(parts) == 0 || parts[0] == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Message request ID required in path"))
		return
	}
	requestID := parts[0]

	var body struct {
		Action string `json:"action"`
	}
	if apiErr := validator.DecodeAndValidate(w, r, 8*1024, &body); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	if err := h.svc.RespondMessageRequest(r.Context(), authUser.ID, requestID, body.Action); err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"id":     requestID,
		"status": strings.ToUpper(strings.TrimSpace(body.Action)),
	})
}

// MessagingQuota handles GET /api/v1/discovery/messaging-quota.
func (h *Handler) MessagingQuota(w http.ResponseWriter, r *http.Request) {
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

	quota, err := h.svc.GetDiscoveryMessageQuota(r.Context(), authUser.ID)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, quota)
}

// UnlockMessagingQuotaAd handles POST /api/v1/discovery/messaging-quota/unlock-ad.
func (h *Handler) UnlockMessagingQuotaAd(w http.ResponseWriter, r *http.Request) {
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

	var req UnlockAdQuotaRequest
	if r.Body != nil && r.ContentLength > 0 {
		_ = validator.DecodeAndValidate(w, r, 16*1024, &req)
	}

	quota, err := h.svc.UnlockDiscoveryMessageAdBonus(r.Context(), authUser.ID, req.RawQuery, req.TransactionID)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, quota)
}

// Favourites handles GET, POST, and DELETE /api/v1/discovery/favourites.
func (h *Handler) Favourites(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		resp, err := h.svc.ListFavourites(r.Context(), authUser.ID)
		if err != nil {
			h.handleServiceError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, resp)

	case http.MethodPost:
		var req AddFavouriteRequest
		if err := validator.DecodeAndValidate(w, r, 16*1024, &req); err != nil {
			apperror.WriteError(w, reqID, err)
			return
		}
		resp, err := h.svc.AddFavourite(r.Context(), authUser.ID, req.TargetUserID)
		if err != nil {
			h.handleServiceError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusCreated, resp)

	case http.MethodDelete:
		targetID := r.URL.Query().Get("target_user_id")
		if targetID == "" {
			var req AddFavouriteRequest
			_ = validator.DecodeAndValidate(w, r, 16*1024, &req)
			targetID = req.TargetUserID
		}
		if targetID == "" {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "target_user_id is required"))
			return
		}
		resp, err := h.svc.RemoveFavourite(r.Context(), authUser.ID, targetID)
		if err != nil {
			h.handleServiceError(w, reqID, err)
			return
		}
		apperror.WriteJSON(w, http.StatusOK, resp)

	default:
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
	}
}

// FavouriteDetail handles DELETE /api/v1/discovery/favourites/{id}.
func (h *Handler) FavouriteDetail(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	targetID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/discovery/favourites/"), "/")
	if targetID == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Target user ID required in path"))
		return
	}

	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only DELETE is allowed"))
		return
	}

	resp, err := h.svc.RemoveFavourite(r.Context(), authUser.ID, targetID)
	if err != nil {
		h.handleServiceError(w, reqID, err)
		return
	}

	apperror.WriteJSON(w, http.StatusOK, resp)
}

