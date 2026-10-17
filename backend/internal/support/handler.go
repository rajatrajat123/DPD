package support

import (
	"encoding/json"
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

// PublicSubmitTicket handles POST /api/v1/support/tickets/public
func (h *Handler) PublicSubmitTicket(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	if r.Method != http.MethodPost {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST allowed"))
		return
	}

	var req struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Subject  string `json:"subject"`
		Category string `json:"category"`
		Body     string `json:"body"`
	}

	if apiErr := validator.DecodeAndValidate(w, r, 64*1024, &req); apiErr != nil {
		apperror.WriteError(w, reqID, apiErr)
		return
	}

	ticket, err := h.svc.CreatePublicTicket(r.Context(), req.Email, req.Name, req.Subject, req.Category, req.Body)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusCreated, map[string]any{
		"status":        "CREATED",
		"ticket_id":     ticket.ID,
		"ticket_number": ticket.TicketNumber,
		"message":       "Your inquiry has been received. Our team will review and respond promptly.",
	})
}

// MemberTickets handles GET & POST /api/v1/support/tickets
func (h *Handler) MemberTickets(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		tickets, err := h.svc.ListMemberTickets(r.Context(), authUser.ID)
		if err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
			return
		}
		apperror.WriteJSON(w, http.StatusOK, map[string]any{
			"tickets": tickets,
			"count":   len(tickets),
		})

	case http.MethodPost:
		var req struct {
			Subject  string `json:"subject"`
			Category string `json:"category"`
			Priority string `json:"priority"`
			Body     string `json:"body"`
		}
		if apiErr := validator.DecodeAndValidate(w, r, 64*1024, &req); apiErr != nil {
			apperror.WriteError(w, reqID, apiErr)
			return
		}

		ticket, err := h.svc.CreateMemberTicket(r.Context(), authUser.ID, authUser.Email, req.Subject, req.Category, req.Priority, req.Body)
		if err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
			return
		}

		apperror.WriteJSON(w, http.StatusCreated, map[string]any{
			"status":        "CREATED",
			"ticket_id":     ticket.ID,
			"ticket_number": ticket.TicketNumber,
		})

	default:
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
	}
}

// MemberTicketDetail handles GET & POST /api/v1/support/tickets/{id} and /api/v1/support/tickets/{id}/messages
func (h *Handler) MemberTicketDetail(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	pathRem := strings.TrimPrefix(r.URL.Path, "/api/v1/support/tickets/")
	parts := strings.Split(pathRem, "/")
	ticketID := parts[0]
	if ticketID == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Ticket ID required"))
		return
	}

	// Sub-route: /messages
	if len(parts) > 1 && parts[1] == "messages" {
		if r.Method != http.MethodPost {
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST allowed"))
			return
		}
		var req struct {
			Body string `json:"body"`
		}
		if apiErr := validator.DecodeAndValidate(w, r, 64*1024, &req); apiErr != nil {
			apperror.WriteError(w, reqID, apiErr)
			return
		}

		msg, err := h.svc.AddMessage(r.Context(), ticketID, authUser.ID, "Member", false, false, req.Body)
		if err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
			return
		}
		apperror.WriteJSON(w, http.StatusCreated, msg)
		return
	}

	if r.Method != http.MethodGet {
		apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET allowed"))
		return
	}

	detail, err := h.svc.GetTicket(r.Context(), ticketID, authUser.ID, authUser.Role)
	if err != nil {
		if errors.Is(err, ErrTicketNotFound) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Ticket not found"))
			return
		}
		if errors.Is(err, ErrUnauthorized) {
			apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Access denied to this ticket"))
			return
		}
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, detail)
}

// AdminTickets handles GET /api/v1/admin/support/tickets
func (h *Handler) AdminTickets(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	if !isSupportStaff(authUser.Role) {
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Support staff permissions required"))
		return
	}

	filter := make(map[string]any)
	if cat := r.URL.Query().Get("category"); cat != "" {
		filter["category"] = cat
	}
	if status := r.URL.Query().Get("status"); status != "" {
		filter["status"] = status
	}
	if agentID := r.URL.Query().Get("agent_id"); agentID != "" {
		filter["assigned_agent_id"] = agentID
	}
	if teamID := r.URL.Query().Get("team_id"); teamID != "" {
		filter["assigned_team_id"] = teamID
	}

	limit := 50
	offset := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 100 {
			limit = v
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = v
		}
	}

	tickets, total, err := h.svc.ListAdminTickets(r.Context(), filter, limit, offset)
	if err != nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
		return
	}

	apperror.WriteJSON(w, http.StatusOK, map[string]any{
		"tickets": tickets,
		"total":   total,
		"limit":   limit,
		"offset":  offset,
	})
}

// AdminTicketOperations handles /api/v1/admin/support/tickets/{id}/*
func (h *Handler) AdminTicketOperations(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	if !isSupportStaff(authUser.Role) {
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Support staff permissions required"))
		return
	}

	pathRem := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/support/tickets/")
	parts := strings.Split(pathRem, "/")
	ticketID := parts[0]
	if ticketID == "" {
		apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Ticket ID required"))
		return
	}

	// GET detail
	if len(parts) == 1 && r.Method == http.MethodGet {
		detail, err := h.svc.GetTicket(r.Context(), ticketID, authUser.ID, authUser.Role)
		if err != nil {
			if errors.Is(err, ErrTicketNotFound) {
				apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Ticket not found"))
				return
			}
			apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
			return
		}
		apperror.WriteJSON(w, http.StatusOK, detail)
		return
	}

	if len(parts) > 1 {
		action := parts[1]
		switch action {
		case "messages":
			if r.Method != http.MethodPost {
				apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only POST allowed"))
				return
			}
			var req struct {
				Body           string `json:"body"`
				IsInternalNote bool   `json:"is_internal_note"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Invalid message body"))
				return
			}
			msg, err := h.svc.AddMessage(r.Context(), ticketID, authUser.ID, authUser.Email, true, req.IsInternalNote, req.Body)
			if err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, err.Error()))
				return
			}
			apperror.WriteJSON(w, http.StatusCreated, msg)
			return

		case "assign":
			if r.Method != http.MethodPut && r.Method != http.MethodPost {
				apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only PUT/POST allowed"))
				return
			}
			var req struct {
				TeamID  *string `json:"team_id"`
				AgentID *string `json:"agent_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Invalid assign payload"))
				return
			}
			if err := h.svc.AssignTicket(r.Context(), ticketID, req.TeamID, req.AgentID); err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
				return
			}
			apperror.WriteJSON(w, http.StatusOK, map[string]string{"status": "ASSIGNED"})
			return

		case "status":
			if r.Method != http.MethodPut && r.Method != http.MethodPost {
				apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only PUT/POST allowed"))
				return
			}
			var req struct {
				Status string `json:"status"`
				Note   string `json:"note"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Invalid status payload"))
				return
			}
			if err := h.svc.UpdateStatus(r.Context(), ticketID, req.Status, req.Note); err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
				return
			}
			apperror.WriteJSON(w, http.StatusOK, map[string]string{"status": req.Status})
			return
		}
	}

	apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Route not found"))
}

// AdminTeams handles /api/v1/admin/support/teams and /api/v1/admin/support/teams/{id}/members
func (h *Handler) AdminTeams(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetRequestID(r.Context())
	authUser, ok := identity.GetAuthUser(r.Context())
	if !ok || authUser == nil {
		apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
		return
	}

	if !isSupportStaff(authUser.Role) {
		apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Support staff permissions required"))
		return
	}

	pathRem := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/support/teams")
	pathRem = strings.TrimPrefix(pathRem, "/")

	if pathRem == "" {
		switch r.Method {
		case http.MethodGet:
			teams, err := h.svc.ListTeams(r.Context())
			if err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
				return
			}
			apperror.WriteJSON(w, http.StatusOK, map[string]any{"teams": teams})
			return

		case http.MethodPost:
			var req struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				RoutingRule string `json:"routing_rule"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Invalid team payload"))
				return
			}
			team, err := h.svc.CreateTeam(r.Context(), req.Name, req.Description, authUser.ID, req.RoutingRule)
			if err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
				return
			}
			apperror.WriteJSON(w, http.StatusCreated, team)
			return
		default:
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
			return
		}
	}

	parts := strings.Split(pathRem, "/")
	teamID := parts[0]
	if len(parts) > 1 && parts[1] == "members" {
		switch r.Method {
		case http.MethodGet:
			members, err := h.svc.GetTeamMembers(r.Context(), teamID)
			if err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
				return
			}
			apperror.WriteJSON(w, http.StatusOK, map[string]any{"members": members})
			return

		case http.MethodPost:
			var req struct {
				AgentID string `json:"agent_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Invalid member payload"))
				return
			}
			if err := h.svc.AddTeamMember(r.Context(), teamID, req.AgentID); err != nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, err.Error()))
				return
			}
			apperror.WriteJSON(w, http.StatusCreated, map[string]string{"status": "MEMBER_ADDED"})
			return
		}
	}

	apperror.WriteError(w, reqID, apperror.New(http.StatusNotFound, apperror.CodeNotFound, "Route not found"))
}

func isSupportStaff(role identity.UserRole) bool {
	return role == identity.RoleSuperAdmin ||
		role == identity.RoleCustomerSupport ||
		role == identity.RoleFinanceAdmin ||
		role == identity.RoleTrustAndSafety ||
		role == identity.RoleAffiliateManager
}
