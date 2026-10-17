package support

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/auradating/platform/backend/internal/identity"
)

var (
	ErrUnauthorized = errors.New("unauthorized to access this support ticket")
	ErrInvalidInput = errors.New("invalid support ticket input")
)

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func generateTicketNumber() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(900000))
	return fmt.Sprintf("NDP-%06d", n.Int64()+100000)
}

func generateUUIDv4() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func (s *Service) CreatePublicTicket(ctx context.Context, email, name, subject, category, body string) (*SupportTicket, error) {
	email = strings.TrimSpace(email)
	subject = strings.TrimSpace(subject)
	body = strings.TrimSpace(body)

	if email == "" || !strings.Contains(email, "@") {
		return nil, fmt.Errorf("%w: valid email required", ErrInvalidInput)
	}
	if subject == "" || body == "" {
		return nil, fmt.Errorf("%w: subject and body are required", ErrInvalidInput)
	}

	if category == "" {
		category = string(CategoryGeneral)
	}

	ticket := &SupportTicket{
		ID:           generateUUIDv4(),
		TicketNumber: generateTicketNumber(),
		GuestEmail:   &email,
		GuestName:    &name,
		Subject:      subject,
		Category:     category,
		Priority:     string(PriorityMedium),
		Status:       string(StatusOpen),
		CreatedAt:    time.Now().UTC(),
		UpdatedAt:    time.Now().UTC(),
	}

	// Auto-route ticket to appropriate team & agent
	s.autoRouteTicket(ctx, ticket)

	if err := s.repo.CreateTicket(ctx, ticket); err != nil {
		return nil, fmt.Errorf("failed to create support ticket: %w", err)
	}

	msg := &SupportTicketMessage{
		ID:             generateUUIDv4(),
		TicketID:       ticket.ID,
		SenderName:     name,
		IsStaff:        false,
		IsInternalNote: false,
		Body:           body,
		CreatedAt:      time.Now().UTC(),
	}
	_ = s.repo.CreateMessage(ctx, msg)

	return ticket, nil
}

func (s *Service) CreateMemberTicket(ctx context.Context, userID, userEmail, subject, category, priority, body string) (*SupportTicket, error) {
	subject = strings.TrimSpace(subject)
	body = strings.TrimSpace(body)

	if subject == "" || body == "" {
		return nil, fmt.Errorf("%w: subject and body are required", ErrInvalidInput)
	}

	if category == "" {
		category = string(CategoryGeneral)
	}
	if priority == "" {
		priority = string(PriorityMedium)
	}

	ticket := &SupportTicket{
		ID:           generateUUIDv4(),
		TicketNumber: generateTicketNumber(),
		UserID:       &userID,
		GuestEmail:   &userEmail,
		Subject:      subject,
		Category:     category,
		Priority:     priority,
		Status:       string(StatusOpen),
		CreatedAt:    time.Now().UTC(),
		UpdatedAt:    time.Now().UTC(),
	}

	s.autoRouteTicket(ctx, ticket)

	if err := s.repo.CreateTicket(ctx, ticket); err != nil {
		return nil, fmt.Errorf("failed to create member support ticket: %w", err)
	}

	msg := &SupportTicketMessage{
		ID:             generateUUIDv4(),
		TicketID:       ticket.ID,
		SenderUserID:   &userID,
		SenderName:     "Member",
		IsStaff:        false,
		IsInternalNote: false,
		Body:           body,
		CreatedAt:      time.Now().UTC(),
	}
	_ = s.repo.CreateMessage(ctx, msg)

	return ticket, nil
}

func (s *Service) autoRouteTicket(ctx context.Context, ticket *SupportTicket) {
	teams, err := s.repo.ListTeams(ctx)
	if err != nil || len(teams) == 0 {
		return
	}

	var targetTeam *SupportTeam
	catLower := strings.ToLower(ticket.Category)

	for i, t := range teams {
		if !t.IsActive {
			continue
		}
		tNameLower := strings.ToLower(t.Name)
		if (catLower == "payment" || catLower == "subscription") && (strings.Contains(tNameLower, "billing") || strings.Contains(tNameLower, "payment") || strings.Contains(tNameLower, "finance")) {
			targetTeam = &teams[i]
			break
		}
		if catLower == "safety" && (strings.Contains(tNameLower, "safety") || strings.Contains(tNameLower, "trust")) {
			targetTeam = &teams[i]
			break
		}
		if catLower == "affiliate" && strings.Contains(tNameLower, "affiliate") {
			targetTeam = &teams[i]
			break
		}
	}

	if targetTeam == nil {
		for i, t := range teams {
			if t.IsActive {
				targetTeam = &teams[i]
				break
			}
		}
	}

	if targetTeam == nil {
		return
	}

	ticket.AssignedTeamID = &targetTeam.ID

	// Pick eligible agent
	agents, err := s.repo.GetEligibleAgents(ctx, targetTeam.ID)
	if err == nil && len(agents) > 0 {
		// Workload routing: agents are already sorted by current_workload ASC
		chosen := agents[0]
		ticket.AssignedAgentID = &chosen.AgentID
		_ = s.repo.IncrementAgentWorkload(ctx, targetTeam.ID, chosen.AgentID, 1)
	}
}

func (s *Service) GetTicket(ctx context.Context, ticketID, requesterUserID string, requesterRole identity.UserRole) (*SupportTicketDetail, error) {
	ticket, err := s.repo.GetTicket(ctx, ticketID)
	if err != nil {
		return nil, err
	}

	isStaff := requesterRole == identity.RoleSuperAdmin ||
		requesterRole == identity.RoleCustomerSupport ||
		requesterRole == identity.RoleFinanceAdmin ||
		requesterRole == identity.RoleTrustAndSafety ||
		requesterRole == identity.RoleAffiliateManager

	if !isStaff {
		// Non-staff must own the ticket
		if ticket.UserID == nil || *ticket.UserID != requesterUserID {
			return nil, ErrUnauthorized
		}
	}

	messages, err := s.repo.ListMessages(ctx, ticketID, isStaff)
	if err != nil {
		return nil, err
	}

	return &SupportTicketDetail{
		Ticket:   *ticket,
		Messages: messages,
	}, nil
}

func (s *Service) ListMemberTickets(ctx context.Context, userID string) ([]SupportTicket, error) {
	tickets, _, err := s.repo.ListTickets(ctx, map[string]any{"user_id": userID}, 50, 0)
	return tickets, err
}

func (s *Service) ListAdminTickets(ctx context.Context, filter map[string]any, limit, offset int) ([]SupportTicket, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.repo.ListTickets(ctx, filter, limit, offset)
}

func (s *Service) AddMessage(ctx context.Context, ticketID, senderUserID, senderName string, isStaff, isInternal bool, body string) (*SupportTicketMessage, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, fmt.Errorf("%w: message body required", ErrInvalidInput)
	}

	ticket, err := s.repo.GetTicket(ctx, ticketID)
	if err != nil {
		return nil, err
	}

	msg := &SupportTicketMessage{
		ID:             generateUUIDv4(),
		TicketID:       ticketID,
		SenderUserID:   &senderUserID,
		SenderName:     senderName,
		IsStaff:        isStaff,
		IsInternalNote: isInternal,
		Body:           body,
		CreatedAt:      time.Now().UTC(),
	}

	if err := s.repo.CreateMessage(ctx, msg); err != nil {
		return nil, err
	}

	// Update ticket status based on message author
	if isStaff && !isInternal {
		ticket.Status = string(StatusWaitingUser)
		_ = s.repo.UpdateTicket(ctx, ticket)
	} else if !isStaff {
		ticket.Status = string(StatusInProgress)
		_ = s.repo.UpdateTicket(ctx, ticket)
	}

	return msg, nil
}

func (s *Service) AssignTicket(ctx context.Context, ticketID string, teamID, agentID *string) error {
	ticket, err := s.repo.GetTicket(ctx, ticketID)
	if err != nil {
		return err
	}

	ticket.AssignedTeamID = teamID
	ticket.AssignedAgentID = agentID
	if ticket.Status == string(StatusOpen) && agentID != nil {
		ticket.Status = string(StatusInProgress)
	}

	return s.repo.UpdateTicket(ctx, ticket)
}

func (s *Service) UpdateStatus(ctx context.Context, ticketID, status, note string) error {
	ticket, err := s.repo.GetTicket(ctx, ticketID)
	if err != nil {
		return err
	}

	ticket.Status = status
	if note != "" {
		if ticket.InternalNotes != "" {
			ticket.InternalNotes += "\n" + note
		} else {
			ticket.InternalNotes = note
		}
	}
	if status == string(StatusResolved) || status == string(StatusClosed) {
		now := time.Now().UTC()
		ticket.ResolvedAt = &now
		if ticket.AssignedTeamID != nil && ticket.AssignedAgentID != nil {
			_ = s.repo.IncrementAgentWorkload(ctx, *ticket.AssignedTeamID, *ticket.AssignedAgentID, -1)
		}
	}

	return s.repo.UpdateTicket(ctx, ticket)
}

func (s *Service) ListTeams(ctx context.Context) ([]SupportTeam, error) {
	return s.repo.ListTeams(ctx)
}

func (s *Service) CreateTeam(ctx context.Context, name, description, managerID, routingRule string) (*SupportTeam, error) {
	if routingRule == "" {
		routingRule = "WORKLOAD"
	}
	team := &SupportTeam{
		ID:          generateUUIDv4(),
		Name:        name,
		Description: description,
		ManagerID:   &managerID,
		IsActive:    true,
		RoutingRule: routingRule,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if err := s.repo.CreateTeam(ctx, team); err != nil {
		return nil, err
	}
	return team, nil
}

func (s *Service) AddTeamMember(ctx context.Context, teamID, agentID string) error {
	member := &SupportTeamMember{
		TeamID:          teamID,
		AgentID:         agentID,
		IsAvailable:     true,
		CurrentWorkload: 0,
	}
	return s.repo.AddTeamMember(ctx, member)
}

func (s *Service) GetTeamMembers(ctx context.Context, teamID string) ([]SupportTeamMember, error) {
	return s.repo.GetTeamMembers(ctx, teamID)
}
