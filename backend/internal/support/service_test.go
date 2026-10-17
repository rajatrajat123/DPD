package support_test

import (
	"context"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/support"
)

func TestSupportService_EndToEnd(t *testing.T) {
	ctx := context.Background()
	repo := support.NewMemoryRepository()
	identRepo := identity.NewMemoryRepository()
	svc := support.NewService(repo)

	// Create Member User
	member := &identity.User{
		ID:        "member-101",
		Email:     "member@example.com",
		Role:      identity.RoleMember,
		Status:    identity.StatusActive,
		CreatedAt: time.Now().UTC(),
	}
	_ = identRepo.CreateUser(ctx, member)

	// Create Support Agent User
	agent := &identity.User{
		ID:        "agent-201",
		Email:     "agent@ndp.app",
		Role:      identity.RoleCustomerSupport,
		Status:    identity.StatusActive,
		CreatedAt: time.Now().UTC(),
	}
	_ = identRepo.CreateUser(ctx, agent)

	// 1. Member creates a support ticket
	ticket, err := svc.CreateMemberTicket(ctx, "member-101", "member@example.com", "Billing Question", "BILLING", "NORMAL", "I need help with my invoice.")
	if err != nil {
		t.Fatalf("failed to create member ticket: %v", err)
	}
	if ticket.TicketNumber == "" {
		t.Errorf("expected generated ticket number")
	}
	if ticket.Status != "OPEN" {
		t.Errorf("expected OPEN status, got %s", ticket.Status)
	}

	// 2. Member lists their tickets
	myTickets, err := svc.ListMemberTickets(ctx, "member-101")
	if err != nil {
		t.Fatalf("failed to list member tickets: %v", err)
	}
	if len(myTickets) != 1 {
		t.Errorf("expected 1 ticket, got %d", len(myTickets))
	}

	// 3. Agent adds an internal note (hidden from member)
	_, err = svc.AddMessage(ctx, ticket.ID, "agent-201", "agent@ndp.app", true, true, "Checked Stripe - invoice was re-sent.")
	if err != nil {
		t.Fatalf("failed to add internal note: %v", err)
	}

	// Agent replies to member (visible to member)
	_, err = svc.AddMessage(ctx, ticket.ID, "agent-201", "agent@ndp.app", true, false, "Hello! We have resent your invoice to member@example.com.")
	if err != nil {
		t.Fatalf("failed to add public reply: %v", err)
	}

	// 4. Member views ticket details: internal notes should NOT be visible to Member
	memberView, err := svc.GetTicket(ctx, ticket.ID, "member-101", identity.RoleMember)
	if err != nil {
		t.Fatalf("failed to get ticket as member: %v", err)
	}
	if len(memberView.Messages) != 2 { // Initial body + agent public reply (internal note omitted)
		t.Errorf("expected 2 visible messages for member, got %d", len(memberView.Messages))
	}
	for _, m := range memberView.Messages {
		if m.IsInternalNote {
			t.Errorf("security violation: internal note leaked to regular member!")
		}
	}

	// 5. Agent views ticket details: all messages including internal note visible
	agentView, err := svc.GetTicket(ctx, ticket.ID, "agent-201", identity.RoleCustomerSupport)
	if err != nil {
		t.Fatalf("failed to get ticket as agent: %v", err)
	}
	if len(agentView.Messages) != 3 {
		t.Errorf("expected 3 total messages for staff view, got %d", len(agentView.Messages))
	}

	// 6. Update ticket status to RESOLVED
	err = svc.UpdateStatus(ctx, ticket.ID, "RESOLVED", "Issue answered satisfactorily")
	if err != nil {
		t.Fatalf("failed to update ticket status: %v", err)
	}

	// Verify resolution
	resolvedView, _ := svc.GetTicket(ctx, ticket.ID, "agent-201", identity.RoleCustomerSupport)
	if resolvedView.Ticket.Status != "RESOLVED" {
		t.Errorf("expected status RESOLVED, got %s", resolvedView.Ticket.Status)
	}
}
