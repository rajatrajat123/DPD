package safety

import (
	"errors"
	"strings"
	"time"

	"github.com/auradating/platform/backend/internal/identity"
)

// Common errors
var (
	ErrUnauthorized            = errors.New("unauthorized")
	ErrForbidden               = errors.New("forbidden")
	ErrSelfActionProhibited    = errors.New("self-action or self-approval is prohibited")
	ErrStepUpRequired          = errors.New("step-up authentication required for sensitive action")
	ErrAgeNotVerified          = errors.New("age verification required")
	ErrAccountRestricted       = errors.New("account is restricted, suspended, or banned")
	ErrAccountLocked           = errors.New("account temporarily locked due to excessive failed attempts")
	ErrReportNotFound          = errors.New("report not found")
	ErrCaseNotFound            = errors.New("moderation case not found")
	ErrAppealNotFound          = errors.New("appeal not found")
	ErrInvalidWebhookSignature = errors.New("invalid webhook signature")
	ErrProviderDisabledInProd  = errors.New("development mock age assurance provider cannot be used in production")
)

// Permission represents granular admin permissions
type Permission string

const (
	PermModerationRead   Permission = "moderation:read"
	PermModerationAction Permission = "moderation:action"
	PermFinanceRead      Permission = "finance:read"
	PermFinanceApprove   Permission = "finance:approve"
	PermAgeReview        Permission = "age_assurance:review"
	PermSuperAdmin       Permission = "super_admin:all"
	PermAuditRead        Permission = "audit:read"
	PermCMSWrite         Permission = "cms:write"
	PermCMSPublish       Permission = "cms:publish"
	PermSupportRead      Permission = "support:read"
	PermSupportAction    Permission = "support:action"
)

// HasPermission checks if a given user role possesses the requested permission.
func HasPermission(role identity.UserRole, perm Permission) bool {
	switch role {
	case identity.RoleSuperAdmin:
		return true // SuperAdmin has all permissions
	case identity.RoleTrustAndSafety:
		switch perm {
		case PermModerationRead, PermModerationAction, PermAgeReview, PermAuditRead, PermSupportRead, PermSupportAction:
			return true
		default:
			return false
		}
	case identity.RoleFinanceAdmin:
		switch perm {
		case PermFinanceRead, PermFinanceApprove, PermAuditRead:
			return true
		default:
			return false
		}
	case identity.RoleEditorialCMS:
		switch perm {
		case PermCMSWrite, PermCMSPublish, PermAuditRead:
			return true
		default:
			return false
		}
	case identity.RoleCustomerSupport:
		switch perm {
		case PermSupportRead, PermSupportAction, PermModerationRead, PermAuditRead:
			return true
		default:
			return false
		}
	case identity.RoleAffiliateManager:
		switch perm {
		case PermFinanceRead, PermFinanceApprove, PermAuditRead:
			return true
		default:
			return false
		}
	default:
		return false
	}
}

// ValidateNonSelfAction ensures an administrative user cannot act upon their own account.
func ValidateNonSelfAction(actorID, targetID string) error {
	if strings.TrimSpace(actorID) == "" || strings.TrimSpace(targetID) == "" {
		return errors.New("actor and target IDs must not be empty")
	}
	if strings.EqualFold(strings.TrimSpace(actorID), strings.TrimSpace(targetID)) {
		return ErrSelfActionProhibited
	}
	return nil
}

// Age Assurance Statuses
type AgeAssuranceStatus string

const (
	AgePending      AgeAssuranceStatus = "PENDING"
	AgeVerified     AgeAssuranceStatus = "VERIFIED"
	AgeRejected     AgeAssuranceStatus = "REJECTED"
	AgeExpired      AgeAssuranceStatus = "EXPIRED"
	AgeManualReview AgeAssuranceStatus = "MANUAL_REVIEW"
)

type AgeAssurance struct {
	ID                string             `json:"id"`
	UserID            string             `json:"user_id"`
	Provider          string             `json:"provider"`
	ProviderSessionID string             `json:"provider_session_id"`
	Status            AgeAssuranceStatus `json:"status"`
	RiskScore         int                `json:"risk_score"`
	VerifiedAt        *time.Time         `json:"verified_at,omitempty"`
	ExpiresAt         *time.Time         `json:"expires_at,omitempty"`
	Metadata          map[string]any     `json:"metadata,omitempty"`
	CreatedAt         time.Time          `json:"created_at"`
	UpdatedAt         time.Time          `json:"updated_at"`
}

// Moderation Report Target & Category
type ReportTargetType string

const (
	TargetUser    ReportTargetType = "USER"
	TargetProfile ReportTargetType = "PROFILE"
	TargetMessage ReportTargetType = "MESSAGE"
	TargetMedia   ReportTargetType = "MEDIA"
)

type ReportCategory string

const (
	CategoryUnderageSuspicion   ReportCategory = "UNDERAGE_SUSPICION"
	CategoryHarassment          ReportCategory = "HARASSMENT"
	CategoryHateSpeech          ReportCategory = "HATE_SPEECH"
	CategoryImpersonation       ReportCategory = "IMPERSONATION"
	CategoryScamOrFraud         ReportCategory = "SCAM_OR_FRAUD"
	CategoryInappropriateContent ReportCategory = "INAPPROPRIATE_CONTENT"
	CategoryOther               ReportCategory = "OTHER"
)

type ReportStatus string

const (
	ReportPending   ReportStatus = "PENDING"
	ReportTriaged   ReportStatus = "TRIAGED"
	ReportActioned  ReportStatus = "ACTIONED"
	ReportDismissed ReportStatus = "DISMISSED"
)

type ModerationReport struct {
	ID             string           `json:"id"`
	ReporterUserID string           `json:"reporter_user_id"`
	ReportedUserID string           `json:"reported_user_id"`
	TargetType     ReportTargetType `json:"target_type"`
	TargetID       string           `json:"target_id"`
	Category       ReportCategory   `json:"category"`
	Reason         string           `json:"reason"`
	Status         ReportStatus     `json:"status"`
	CreatedAt      time.Time        `json:"created_at"`
	UpdatedAt      time.Time        `json:"updated_at"`
}

// Moderation Case & SLA
type CasePriority string

const (
	PriorityLow      CasePriority = "LOW"
	PriorityMedium   CasePriority = "MEDIUM"
	PriorityHigh     CasePriority = "HIGH"
	PriorityCritical CasePriority = "CRITICAL"
)

type CaseStatus string

const (
	CaseOpen         CaseStatus = "OPEN"
	CaseInvestigating CaseStatus = "INVESTIGATING"
	CaseResolved     CaseStatus = "RESOLVED"
	CaseDismissed    CaseStatus = "DISMISSED"
)

type ModerationCase struct {
	ID              string         `json:"id"`
	TargetUserID    string         `json:"target_user_id"`
	PrimaryCategory ReportCategory `json:"primary_category"`
	Priority        CasePriority   `json:"priority"`
	Status          CaseStatus     `json:"status"`
	AssignedAdminID *string        `json:"assigned_admin_id,omitempty"`
	ResolutionNote  *string        `json:"resolution_note,omitempty"`
	SLADueAt        time.Time      `json:"sla_due_at"`
	ResolvedAt      *time.Time     `json:"resolved_at,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
}

// Moderation Action Types
type ActionType string

const (
	ActionWarn          ActionType = "WARN"
	ActionRestrict      ActionType = "RESTRICT"
	ActionSuspend       ActionType = "SUSPEND"
	ActionBan           ActionType = "BAN"
	ActionRemoveContent ActionType = "REMOVE_CONTENT"
	ActionClear         ActionType = "CLEAR"
)

type ModerationAction struct {
	ID            string     `json:"id"`
	CaseID        *string    `json:"case_id,omitempty"`
	TargetUserID  string     `json:"target_user_id"`
	AdminUserID   string     `json:"admin_user_id"`
	ActionType    ActionType `json:"action_type"`
	Reason        string     `json:"reason"`
	DurationHours int        `json:"duration_hours,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

// Appeals
type AppealStatus string

const (
	AppealPending  AppealStatus = "PENDING"
	AppealApproved AppealStatus = "APPROVED"
	AppealRejected AppealStatus = "REJECTED"
)

type ModerationAppeal struct {
	ID                 string       `json:"id"`
	UserID             string       `json:"user_id"`
	ActionID           *string      `json:"action_id,omitempty"`
	Reason             string       `json:"reason"`
	Status             AppealStatus `json:"status"`
	ReviewedByAdminID  *string      `json:"reviewed_by_admin_id,omitempty"`
	ReviewNotes        *string      `json:"review_notes,omitempty"`
	CreatedAt          time.Time    `json:"created_at"`
	UpdatedAt          time.Time    `json:"updated_at"`
}

// Security Audit Log
type AuditOutcome string

const (
	AuditSuccess AuditOutcome = "SUCCESS"
	AuditDenied  AuditOutcome = "DENIED"
	AuditFailure AuditOutcome = "FAILURE"
)

type SecurityAuditLog struct {
	ID          string         `json:"id"`
	ActorUserID *string        `json:"actor_user_id,omitempty"`
	ActorRole   string         `json:"actor_role"`
	Action      string         `json:"action"`
	TargetType  string         `json:"target_type"`
	TargetID    string         `json:"target_id"`
	Outcome     AuditOutcome   `json:"outcome"`
	Reason      string         `json:"reason,omitempty"`
	IPAddress   string         `json:"ip_address,omitempty"`
	UserAgent   string         `json:"user_agent,omitempty"`
	RequestID   string         `json:"request_id,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
}

// Login Attempt tracking for brute-force protection
type LoginAttempt struct {
	ID            string     `json:"id"`
	Email         string     `json:"email"`
	IPAddress     string     `json:"ip_address"`
	AttemptCount  int        `json:"attempt_count"`
	LockedUntil   *time.Time `json:"locked_until,omitempty"`
	LastAttemptAt time.Time  `json:"last_attempt_at"`
}

// Request and Response DTOs
type CreateReportRequest struct {
	ReportedUserID string           `json:"reported_user_id"`
	TargetType     ReportTargetType `json:"target_type"`
	TargetID       string           `json:"target_id"`
	Category       ReportCategory   `json:"category"`
	Reason         string           `json:"reason"`
}

type CreateModerationActionRequest struct {
	ActionType    ActionType `json:"action_type"`
	Reason        string     `json:"reason"`
	DurationHours int        `json:"duration_hours,omitempty"`
}

type CreateAppealRequest struct {
	ActionID *string `json:"action_id,omitempty"`
	Reason   string  `json:"reason"`
}

type DecideAppealRequest struct {
	Approved    bool   `json:"approved"`
	ReviewNotes string `json:"review_notes"`
}

type AdminAgeOverrideRequest struct {
	Status AgeAssuranceStatus `json:"status"`
	Reason string             `json:"reason"`
}
