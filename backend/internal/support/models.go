package support

import (
	"time"
)

type TicketCategory string

const (
	CategoryPayment      TicketCategory = "PAYMENT"
	CategorySubscription TicketCategory = "SUBSCRIPTION"
	CategoryAccount      TicketCategory = "ACCOUNT"
	CategoryTechnical    TicketCategory = "TECHNICAL"
	CategoryAffiliate    TicketCategory = "AFFILIATE"
	CategorySafety       TicketCategory = "SAFETY"
	CategoryGeneral      TicketCategory = "GENERAL"
)

type TicketPriority string

const (
	PriorityLow      TicketPriority = "LOW"
	PriorityMedium   TicketPriority = "MEDIUM"
	PriorityHigh     TicketPriority = "HIGH"
	PriorityCritical TicketPriority = "CRITICAL"
)

type TicketStatus string

const (
	StatusOpen        TicketStatus = "OPEN"
	StatusInProgress  TicketStatus = "IN_PROGRESS"
	StatusWaitingUser TicketStatus = "WAITING_USER"
	StatusResolved    TicketStatus = "RESOLVED"
	StatusClosed      TicketStatus = "CLOSED"
)

type SupportTeam struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	ManagerID   *string   `json:"manager_id,omitempty"`
	IsActive    bool      `json:"is_active"`
	RoutingRule string    `json:"routing_rule"` // WORKLOAD | ROUND_ROBIN
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type SupportTeamMember struct {
	TeamID          string `json:"team_id"`
	AgentID         string `json:"agent_id"`
	AgentEmail      string `json:"agent_email,omitempty"`
	IsAvailable     bool   `json:"is_available"`
	CurrentWorkload int    `json:"current_workload"`
}

type SupportTicket struct {
	ID               string     `json:"id"`
	TicketNumber     string     `json:"ticket_number"`
	UserID           *string    `json:"user_id,omitempty"`
	GuestEmail       *string    `json:"guest_email,omitempty"`
	GuestName        *string    `json:"guest_name,omitempty"`
	Subject          string     `json:"subject"`
	Category         string     `json:"category"`
	Priority         string     `json:"priority"`
	Status           string     `json:"status"`
	AssignedTeamID   *string    `json:"assigned_team_id,omitempty"`
	AssignedAgentID  *string    `json:"assigned_agent_id,omitempty"`
	InternalNotes    string     `json:"internal_notes,omitempty"`
	EscalationReason *string    `json:"escalation_reason,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	ResolvedAt       *time.Time `json:"resolved_at,omitempty"`
}

type SupportTicketMessage struct {
	ID             string    `json:"id"`
	TicketID       string    `json:"ticket_id"`
	SenderUserID   *string   `json:"sender_user_id,omitempty"`
	SenderName     string    `json:"sender_name"`
	IsStaff        bool      `json:"is_staff"`
	IsInternalNote bool      `json:"is_internal_note"`
	Body           string    `json:"body"`
	CreatedAt      time.Time `json:"created_at"`
}

type SupportTicketDetail struct {
	Ticket   SupportTicket          `json:"ticket"`
	Messages []SupportTicketMessage `json:"messages"`
}
