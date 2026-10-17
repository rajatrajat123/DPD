package support

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrTicketNotFound = errors.New("support ticket not found")
	ErrTeamNotFound   = errors.New("support team not found")
)

type Repository interface {
	CreateTicket(ctx context.Context, t *SupportTicket) error
	GetTicket(ctx context.Context, ticketID string) (*SupportTicket, error)
	GetTicketByNumber(ctx context.Context, ticketNumber string) (*SupportTicket, error)
	ListTickets(ctx context.Context, filter map[string]any, limit, offset int) ([]SupportTicket, int, error)
	UpdateTicket(ctx context.Context, t *SupportTicket) error
	CreateMessage(ctx context.Context, m *SupportTicketMessage) error
	ListMessages(ctx context.Context, ticketID string, includeInternal bool) ([]SupportTicketMessage, error)
	CreateTeam(ctx context.Context, team *SupportTeam) error
	GetTeam(ctx context.Context, teamID string) (*SupportTeam, error)
	ListTeams(ctx context.Context) ([]SupportTeam, error)
	AddTeamMember(ctx context.Context, member *SupportTeamMember) error
	GetTeamMembers(ctx context.Context, teamID string) ([]SupportTeamMember, error)
	GetEligibleAgents(ctx context.Context, teamID string) ([]SupportTeamMember, error)
	IncrementAgentWorkload(ctx context.Context, teamID, agentID string, delta int) error
}

type MemoryRepository struct {
	mu       sync.RWMutex
	tickets  map[string]*SupportTicket
	messages map[string][]*SupportTicketMessage
	teams    map[string]*SupportTeam
	members  map[string][]*SupportTeamMember
}

func NewMemoryRepository() *MemoryRepository {
	m := &MemoryRepository{
		tickets:  make(map[string]*SupportTicket),
		messages: make(map[string][]*SupportTicketMessage),
		teams:    make(map[string]*SupportTeam),
		members:  make(map[string][]*SupportTeamMember),
	}
	m.seedDefaults()
	return m
}

func (m *MemoryRepository) seedDefaults() {
	defaultTeam := &SupportTeam{
		ID:          "team_general_support",
		Name:        "Tier 1 General Support",
		Description: "General customer queries, account assistance and feedback",
		IsActive:    true,
		RoutingRule: "WORKLOAD",
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	m.teams[defaultTeam.ID] = defaultTeam
}

func (m *MemoryRepository) CreateTicket(_ context.Context, t *SupportTicket) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cloned := *t
	m.tickets[cloned.ID] = &cloned
	return nil
}

func (m *MemoryRepository) GetTicket(_ context.Context, ticketID string) (*SupportTicket, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	t, ok := m.tickets[ticketID]
	if !ok {
		return nil, ErrTicketNotFound
	}
	cloned := *t
	return &cloned, nil
}

func (m *MemoryRepository) GetTicketByNumber(_ context.Context, ticketNumber string) (*SupportTicket, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, t := range m.tickets {
		if t.TicketNumber == ticketNumber {
			cloned := *t
			return &cloned, nil
		}
	}
	return nil, ErrTicketNotFound
}

func (m *MemoryRepository) ListTickets(_ context.Context, filter map[string]any, limit, offset int) ([]SupportTicket, int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []SupportTicket
	for _, t := range m.tickets {
		if uid, ok := filter["user_id"].(string); ok && (t.UserID == nil || *t.UserID != uid) {
			continue
		}
		if cat, ok := filter["category"].(string); ok && t.Category != cat {
			continue
		}
		if status, ok := filter["status"].(string); ok && t.Status != status {
			continue
		}
		if agentID, ok := filter["assigned_agent_id"].(string); ok && (t.AssignedAgentID == nil || *t.AssignedAgentID != agentID) {
			continue
		}
		result = append(result, *t)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})

	total := len(result)
	if offset >= total {
		return []SupportTicket{}, total, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return result[offset:end], total, nil
}

func (m *MemoryRepository) UpdateTicket(_ context.Context, t *SupportTicket) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cloned := *t
	cloned.UpdatedAt = time.Now().UTC()
	m.tickets[cloned.ID] = &cloned
	return nil
}

func (m *MemoryRepository) CreateMessage(_ context.Context, msg *SupportTicketMessage) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cloned := *msg
	m.messages[msg.TicketID] = append(m.messages[msg.TicketID], &cloned)
	return nil
}

func (m *MemoryRepository) ListMessages(_ context.Context, ticketID string, includeInternal bool) ([]SupportTicketMessage, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	msgs := m.messages[ticketID]
	var result []SupportTicketMessage
	for _, msg := range msgs {
		if msg.IsInternalNote && !includeInternal {
			continue
		}
		result = append(result, *msg)
	}
	return result, nil
}

func (m *MemoryRepository) CreateTeam(_ context.Context, team *SupportTeam) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cloned := *team
	m.teams[cloned.ID] = &cloned
	return nil
}

func (m *MemoryRepository) GetTeam(_ context.Context, teamID string) (*SupportTeam, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	t, ok := m.teams[teamID]
	if !ok {
		return nil, ErrTeamNotFound
	}
	cloned := *t
	return &cloned, nil
}

func (m *MemoryRepository) ListTeams(_ context.Context) ([]SupportTeam, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var res []SupportTeam
	for _, t := range m.teams {
		res = append(res, *t)
	}
	return res, nil
}

func (m *MemoryRepository) AddTeamMember(_ context.Context, member *SupportTeamMember) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cloned := *member
	m.members[member.TeamID] = append(m.members[member.TeamID], &cloned)
	return nil
}

func (m *MemoryRepository) GetTeamMembers(_ context.Context, teamID string) ([]SupportTeamMember, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var res []SupportTeamMember
	for _, mem := range m.members[teamID] {
		res = append(res, *mem)
	}
	return res, nil
}

func (m *MemoryRepository) GetEligibleAgents(_ context.Context, teamID string) ([]SupportTeamMember, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var res []SupportTeamMember
	for _, mem := range m.members[teamID] {
		if mem.IsAvailable {
			res = append(res, *mem)
		}
	}
	return res, nil
}

func (m *MemoryRepository) IncrementAgentWorkload(_ context.Context, teamID, agentID string, delta int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, mem := range m.members[teamID] {
		if mem.AgentID == agentID {
			mem.CurrentWorkload += delta
			if mem.CurrentWorkload < 0 {
				mem.CurrentWorkload = 0
			}
			return nil
		}
	}
	return nil
}

// PostgresRepository
type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (p *PostgresRepository) CreateTicket(ctx context.Context, t *SupportTicket) error {
	query := `
		INSERT INTO support_tickets (
			id, ticket_number, user_id, guest_email, guest_name, subject,
			category, priority, status, assigned_team_id, assigned_agent_id,
			internal_notes, escalation_reason, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
	`
	_, err := p.pool.Exec(ctx, query,
		t.ID, t.TicketNumber, t.UserID, t.GuestEmail, t.GuestName, t.Subject,
		t.Category, t.Priority, t.Status, t.AssignedTeamID, t.AssignedAgentID,
		t.InternalNotes, t.EscalationReason, t.CreatedAt, t.UpdatedAt,
	)
	return err
}

func (p *PostgresRepository) GetTicket(ctx context.Context, ticketID string) (*SupportTicket, error) {
	query := `
		SELECT id, ticket_number, user_id, guest_email, guest_name, subject,
		       category, priority, status, assigned_team_id, assigned_agent_id,
		       internal_notes, escalation_reason, created_at, updated_at, resolved_at
		FROM support_tickets WHERE id = $1
	`
	var t SupportTicket
	err := p.pool.QueryRow(ctx, query, ticketID).Scan(
		&t.ID, &t.TicketNumber, &t.UserID, &t.GuestEmail, &t.GuestName, &t.Subject,
		&t.Category, &t.Priority, &t.Status, &t.AssignedTeamID, &t.AssignedAgentID,
		&t.InternalNotes, &t.EscalationReason, &t.CreatedAt, &t.UpdatedAt, &t.ResolvedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrTicketNotFound
	}
	return &t, err
}

func (p *PostgresRepository) GetTicketByNumber(ctx context.Context, ticketNumber string) (*SupportTicket, error) {
	query := `
		SELECT id, ticket_number, user_id, guest_email, guest_name, subject,
		       category, priority, status, assigned_team_id, assigned_agent_id,
		       internal_notes, escalation_reason, created_at, updated_at, resolved_at
		FROM support_tickets WHERE ticket_number = $1
	`
	var t SupportTicket
	err := p.pool.QueryRow(ctx, query, ticketNumber).Scan(
		&t.ID, &t.TicketNumber, &t.UserID, &t.GuestEmail, &t.GuestName, &t.Subject,
		&t.Category, &t.Priority, &t.Status, &t.AssignedTeamID, &t.AssignedAgentID,
		&t.InternalNotes, &t.EscalationReason, &t.CreatedAt, &t.UpdatedAt, &t.ResolvedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrTicketNotFound
	}
	return &t, err
}

func (p *PostgresRepository) ListTickets(ctx context.Context, filter map[string]any, limit, offset int) ([]SupportTicket, int, error) {
	var conditions []string
	var args []any
	argIdx := 1

	if uid, ok := filter["user_id"].(string); ok && uid != "" {
		conditions = append(conditions, fmt.Sprintf("user_id = $%d", argIdx))
		args = append(args, uid)
		argIdx++
	}
	if cat, ok := filter["category"].(string); ok && cat != "" {
		conditions = append(conditions, fmt.Sprintf("category = $%d", argIdx))
		args = append(args, cat)
		argIdx++
	}
	if status, ok := filter["status"].(string); ok && status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, status)
		argIdx++
	}
	if agentID, ok := filter["assigned_agent_id"].(string); ok && agentID != "" {
		conditions = append(conditions, fmt.Sprintf("assigned_agent_id = $%d", argIdx))
		args = append(args, agentID)
		argIdx++
	}
	if teamID, ok := filter["assigned_team_id"].(string); ok && teamID != "" {
		conditions = append(conditions, fmt.Sprintf("assigned_team_id = $%d", argIdx))
		args = append(args, teamID)
		argIdx++
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM support_tickets %s", whereClause)
	var total int
	if err := p.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT id, ticket_number, user_id, guest_email, guest_name, subject,
		       category, priority, status, assigned_team_id, assigned_agent_id,
		       internal_notes, escalation_reason, created_at, updated_at, resolved_at
		FROM support_tickets
		%s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d
	`, whereClause, argIdx, argIdx+1)

	args = append(args, limit, offset)
	rows, err := p.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var result []SupportTicket
	for rows.Next() {
		var t SupportTicket
		if err := rows.Scan(
			&t.ID, &t.TicketNumber, &t.UserID, &t.GuestEmail, &t.GuestName, &t.Subject,
			&t.Category, &t.Priority, &t.Status, &t.AssignedTeamID, &t.AssignedAgentID,
			&t.InternalNotes, &t.EscalationReason, &t.CreatedAt, &t.UpdatedAt, &t.ResolvedAt,
		); err != nil {
			return nil, 0, err
		}
		result = append(result, t)
	}
	return result, total, rows.Err()
}

func (p *PostgresRepository) UpdateTicket(ctx context.Context, t *SupportTicket) error {
	query := `
		UPDATE support_tickets SET
			status = $2,
			priority = $3,
			assigned_team_id = $4,
			assigned_agent_id = $5,
			internal_notes = $6,
			escalation_reason = $7,
			resolved_at = $8,
			updated_at = NOW()
		WHERE id = $1
	`
	_, err := p.pool.Exec(ctx, query,
		t.ID, t.Status, t.Priority, t.AssignedTeamID, t.AssignedAgentID,
		t.InternalNotes, t.EscalationReason, t.ResolvedAt,
	)
	return err
}

func (p *PostgresRepository) CreateMessage(ctx context.Context, msg *SupportTicketMessage) error {
	query := `
		INSERT INTO support_ticket_messages (
			id, ticket_id, sender_user_id, sender_name, is_staff, is_internal_note, body, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	_, err := p.pool.Exec(ctx, query,
		msg.ID, msg.TicketID, msg.SenderUserID, msg.SenderName,
		msg.IsStaff, msg.IsInternalNote, msg.Body, msg.CreatedAt,
	)
	return err
}

func (p *PostgresRepository) ListMessages(ctx context.Context, ticketID string, includeInternal bool) ([]SupportTicketMessage, error) {
	where := "WHERE ticket_id = $1"
	if !includeInternal {
		where += " AND is_internal_note = FALSE"
	}
	query := fmt.Sprintf(`
		SELECT id, ticket_id, sender_user_id, sender_name, is_staff, is_internal_note, body, created_at
		FROM support_ticket_messages
		%s
		ORDER BY created_at ASC
	`, where)

	rows, err := p.pool.Query(ctx, query, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []SupportTicketMessage
	for rows.Next() {
		var m SupportTicketMessage
		if err := rows.Scan(
			&m.ID, &m.TicketID, &m.SenderUserID, &m.SenderName,
			&m.IsStaff, &m.IsInternalNote, &m.Body, &m.CreatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

func (p *PostgresRepository) CreateTeam(ctx context.Context, team *SupportTeam) error {
	query := `
		INSERT INTO support_teams (id, name, description, manager_id, is_active, routing_rule, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	_, err := p.pool.Exec(ctx, query,
		team.ID, team.Name, team.Description, team.ManagerID,
		team.IsActive, team.RoutingRule, team.CreatedAt, team.UpdatedAt,
	)
	return err
}

func (p *PostgresRepository) GetTeam(ctx context.Context, teamID string) (*SupportTeam, error) {
	query := `SELECT id, name, description, manager_id, is_active, routing_rule, created_at, updated_at FROM support_teams WHERE id = $1`
	var t SupportTeam
	err := p.pool.QueryRow(ctx, query, teamID).Scan(
		&t.ID, &t.Name, &t.Description, &t.ManagerID,
		&t.IsActive, &t.RoutingRule, &t.CreatedAt, &t.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrTeamNotFound
	}
	return &t, err
}

func (p *PostgresRepository) ListTeams(ctx context.Context) ([]SupportTeam, error) {
	query := `SELECT id, name, description, manager_id, is_active, routing_rule, created_at, updated_at FROM support_teams ORDER BY name ASC`
	rows, err := p.pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var res []SupportTeam
	for rows.Next() {
		var t SupportTeam
		if err := rows.Scan(
			&t.ID, &t.Name, &t.Description, &t.ManagerID,
			&t.IsActive, &t.RoutingRule, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		res = append(res, t)
	}
	return res, rows.Err()
}

func (p *PostgresRepository) AddTeamMember(ctx context.Context, member *SupportTeamMember) error {
	query := `
		INSERT INTO support_team_members (team_id, agent_id, is_available, current_workload, created_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (team_id, agent_id) DO UPDATE SET
			is_available = EXCLUDED.is_available
	`
	_, err := p.pool.Exec(ctx, query, member.TeamID, member.AgentID, member.IsAvailable, member.CurrentWorkload)
	return err
}

func (p *PostgresRepository) GetTeamMembers(ctx context.Context, teamID string) ([]SupportTeamMember, error) {
	query := `
		SELECT m.team_id, m.agent_id, u.email, m.is_available, m.current_workload
		FROM support_team_members m
		JOIN users u ON u.id = m.agent_id
		WHERE m.team_id = $1
		ORDER BY m.current_workload ASC
	`
	rows, err := p.pool.Query(ctx, query, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var res []SupportTeamMember
	for rows.Next() {
		var mem SupportTeamMember
		if err := rows.Scan(&mem.TeamID, &mem.AgentID, &mem.AgentEmail, &mem.IsAvailable, &mem.CurrentWorkload); err != nil {
			return nil, err
		}
		res = append(res, mem)
	}
	return res, rows.Err()
}

func (p *PostgresRepository) GetEligibleAgents(ctx context.Context, teamID string) ([]SupportTeamMember, error) {
	query := `
		SELECT m.team_id, m.agent_id, u.email, m.is_available, m.current_workload
		FROM support_team_members m
		JOIN users u ON u.id = m.agent_id
		WHERE m.team_id = $1 AND m.is_available = TRUE
		ORDER BY m.current_workload ASC
	`
	rows, err := p.pool.Query(ctx, query, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var res []SupportTeamMember
	for rows.Next() {
		var mem SupportTeamMember
		if err := rows.Scan(&mem.TeamID, &mem.AgentID, &mem.AgentEmail, &mem.IsAvailable, &mem.CurrentWorkload); err != nil {
			return nil, err
		}
		res = append(res, mem)
	}
	return res, rows.Err()
}

func (p *PostgresRepository) IncrementAgentWorkload(ctx context.Context, teamID, agentID string, delta int) error {
	query := `
		UPDATE support_team_members
		SET current_workload = GREATEST(0, current_workload + $3)
		WHERE team_id = $1 AND agent_id = $2
	`
	_, err := p.pool.Exec(ctx, query, teamID, agentID, delta)
	return err
}
