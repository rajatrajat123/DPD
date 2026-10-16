package safety

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/auradating/platform/backend/internal/identity"
)

type HubDisconnecter interface {
	DisconnectUser(userID string)
}

type ModerationCaseDetails struct {
	Case    *ModerationCase    `json:"case"`
	Reports []ModerationReport `json:"reports"`
	Actions []ModerationAction `json:"actions"`
}

type Service struct {
	repo           Repository
	identityRepo   identity.Repository
	provider       AgeAssuranceProvider
	audit          *ServiceAuditLogger
	fraud          *FraudManager
	stepUpVerifier StepUpVerifier
	hub            HubDisconnecter
	logger         *slog.Logger
}

func NewService(
	repo Repository,
	identityRepo identity.Repository,
	provider AgeAssuranceProvider,
	hub HubDisconnecter,
	logger *slog.Logger,
) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	audit := NewServiceAuditLogger(repo)
	fraud := NewFraudManager(repo)
	return &Service{
		repo:         repo,
		identityRepo: identityRepo,
		provider:     provider,
		audit:        audit,
		fraud:        fraud,
		hub:          hub,
		logger:       logger,
	}
}

func (s *Service) SetStepUpVerifier(v StepUpVerifier) {
	s.stepUpVerifier = v
}

// -----------------------------------------------------------------------------
// Age Assurance Workflows
// -----------------------------------------------------------------------------

func (s *Service) CreateAgeVerificationSession(ctx context.Context, userID, email, clientIP string, mediaID ...string) (*AgeAssuranceSessionResult, error) {
	if s.provider == nil {
		return nil, errors.New("age assurance provider not configured")
	}

	result, err := s.provider.CreateSession(ctx, userID, email)
	if err != nil {
		return nil, fmt.Errorf("provider session creation failed: %w", err)
	}

	// Lookup existing record to preserve metadata or previous attributes
	existing, _ := s.repo.GetAgeAssuranceByUserID(ctx, userID)

	// Persist or update verification row
	aa := &AgeAssurance{
		UserID:            userID,
		Provider:          s.provider.Name(),
		ProviderSessionID: result.SessionID,
		Status:            AgePending,
		ExpiresAt:         &result.ExpiresAt,
	}
	if existing != nil {
		aa.ID = existing.ID
		aa.Metadata = existing.Metadata
	}
	if aa.Metadata == nil {
		aa.Metadata = make(map[string]any)
	}
	if len(mediaID) > 0 && strings.TrimSpace(mediaID[0]) != "" {
		aa.Metadata["media_id"] = strings.TrimSpace(mediaID[0])
	}

	if err := s.repo.UpsertAgeAssurance(ctx, aa); err != nil {
		return nil, fmt.Errorf("failed to persist age assurance session: %w", err)
	}

	return result, nil
}

func (s *Service) ProcessAgeVerificationWebhook(ctx context.Context, payload []byte, signature string) (*AgeAssuranceWebhookResult, error) {
	if s.provider == nil {
		return nil, errors.New("age assurance provider not configured")
	}

	result, err := s.provider.VerifyWebhook(ctx, payload, signature)
	if err != nil {
		return nil, err
	}

	// Lookup current record
	aa, err := s.repo.GetAgeAssuranceBySessionID(ctx, s.provider.Name(), result.SessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to lookup age assurance: %w", err)
	}
	if aa == nil {
		// Session not found by ID, attempt lookup by UserID
		if result.UserID != "" {
			aa, _ = s.repo.GetAgeAssuranceByUserID(ctx, result.UserID)
		}
	}

	if aa == nil {
		aa = &AgeAssurance{
			UserID:            result.UserID,
			Provider:          s.provider.Name(),
			ProviderSessionID: result.SessionID,
		}
	}

	aa.Status = result.Status
	aa.RiskScore = result.RiskScore
	aa.VerifiedAt = result.VerifiedAt
	if result.Status == AgeVerified {
		exp := time.Now().UTC().Add(365 * 24 * time.Hour) // 1-year verification validity
		aa.ExpiresAt = &exp
	}

	if err := s.repo.UpsertAgeAssurance(ctx, aa); err != nil {
		return nil, fmt.Errorf("failed to update age assurance status: %w", err)
	}

	// If rejected or suspected underage, restrict account immediately
	if result.Status == AgeRejected {
		_ = s.handleSuspectedUnderage(ctx, aa.UserID, "Provider verification returned REJECTED")
	}

	// Audit log
	_ = s.audit.Record(ctx, &SecurityAuditLog{
		ActorRole:  "AGE_PROVIDER",
		Action:     "age_assurance.webhook_processed",
		TargetType: "USER",
		TargetID:   aa.UserID,
		Outcome:    AuditSuccess,
		Reason:     fmt.Sprintf("status=%s risk_score=%d", aa.Status, aa.RiskScore),
	})

	return result, nil
}

func (s *Service) GetAgeAssuranceStatus(ctx context.Context, userID string) (*AgeAssurance, error) {
	return s.repo.GetAgeAssuranceByUserID(ctx, userID)
}

func (s *Service) IsAgeVerified(ctx context.Context, userID string) (bool, error) {
	aa, err := s.repo.GetAgeAssuranceByUserID(ctx, userID)
	if err != nil {
		return false, err
	}
	if aa == nil {
		return false, nil
	}
	if aa.Status != AgeVerified {
		return false, nil
	}
	if aa.ExpiresAt != nil && time.Now().UTC().After(*aa.ExpiresAt) {
		return false, nil
	}
	return true, nil
}

func (s *Service) AdminOverrideAgeAssurance(
	ctx context.Context,
	adminUser *identity.AuthUser,
	targetUserID string,
	req AdminAgeOverrideRequest,
	clientIP, reqID string,
) error {
	if !HasPermission(adminUser.Role, PermAgeReview) {
		_ = s.audit.Record(ctx, &SecurityAuditLog{
			ActorUserID: &adminUser.ID,
			ActorRole:   string(adminUser.Role),
			Action:      "age_assurance.override",
			TargetType:  "USER",
			TargetID:    targetUserID,
			Outcome:     AuditDenied,
			Reason:      "insufficient permissions",
			IPAddress:   clientIP,
			RequestID:   reqID,
		})
		return ErrForbidden
	}

	if err := ValidateNonSelfAction(adminUser.ID, targetUserID); err != nil {
		return err
	}

	aa, err := s.repo.GetAgeAssuranceByUserID(ctx, targetUserID)
	if err != nil {
		return err
	}
	if aa == nil {
		aa = &AgeAssurance{
			UserID:            targetUserID,
			Provider:          "ADMIN_OVERRIDE",
			ProviderSessionID: fmt.Sprintf("ovr_%s_%d", targetUserID, time.Now().UnixNano()),
		}
	}

	aa.Status = req.Status
	now := time.Now().UTC()
	if req.Status == AgeVerified {
		aa.VerifiedAt = &now
		exp := now.Add(365 * 24 * time.Hour)
		aa.ExpiresAt = &exp
	} else if req.Status == AgeRejected {
		_ = s.handleSuspectedUnderage(ctx, targetUserID, req.Reason)
	}

	if err := s.repo.UpsertAgeAssurance(ctx, aa); err != nil {
		return err
	}

	_ = s.audit.Record(ctx, &SecurityAuditLog{
		ActorUserID: &adminUser.ID,
		ActorRole:   string(adminUser.Role),
		Action:      "age_assurance.override",
		TargetType:  "USER",
		TargetID:    targetUserID,
		Outcome:     AuditSuccess,
		Reason:      fmt.Sprintf("override to %s: %s", req.Status, req.Reason),
		IPAddress:   clientIP,
		RequestID:   reqID,
	})

	return nil
}

func (s *Service) handleSuspectedUnderage(ctx context.Context, targetUserID, reason string) error {
	s.logger.Warn("suspected_underage_detected", slog.String("user_id", targetUserID), slog.String("reason", reason))

	// Suspend identity account immediately
	if s.identityRepo != nil {
		_ = s.identityRepo.UpdateUserStatus(ctx, targetUserID, identity.StatusSuspended)
	}

	// Disconnect real-time WebSocket connection
	if s.hub != nil {
		s.hub.DisconnectUser(targetUserID)
	}

	// Create or escalate critical moderation case
	existingCase, _ := s.repo.GetOpenCaseByTargetUser(ctx, targetUserID)
	if existingCase != nil {
		existingCase.Priority = PriorityCritical
		existingCase.PrimaryCategory = CategoryUnderageSuspicion
		existingCase.SLADueAt = time.Now().UTC().Add(2 * time.Hour)
		_ = s.repo.UpdateCase(ctx, existingCase)
	} else {
		_ = s.repo.CreateCase(ctx, &ModerationCase{
			TargetUserID:    targetUserID,
			PrimaryCategory: CategoryUnderageSuspicion,
			Priority:        PriorityCritical,
			Status:          CaseOpen,
			SLADueAt:        time.Now().UTC().Add(2 * time.Hour),
		})
	}
	return nil
}

// -----------------------------------------------------------------------------
// Moderation & Reporting Workflows
// -----------------------------------------------------------------------------

func (s *Service) SubmitReport(
	ctx context.Context,
	reporter *identity.AuthUser,
	req CreateReportRequest,
	clientIP, reqID string,
) (*ModerationReport, error) {
	if err := ValidateNonSelfAction(reporter.ID, req.ReportedUserID); err != nil {
		return nil, errors.New("cannot report your own account")
	}

	report := &ModerationReport{
		ReporterUserID: reporter.ID,
		ReportedUserID: req.ReportedUserID,
		TargetType:     req.TargetType,
		TargetID:       req.TargetID,
		Category:       req.Category,
		Reason:         strings.TrimSpace(req.Reason),
		Status:         ReportPending,
	}

	if err := s.repo.CreateReport(ctx, report); err != nil {
		return nil, fmt.Errorf("failed to create report: %w", err)
	}

	// Determine case priority and SLA based on category
	var priority CasePriority
	var slaDuration time.Duration

	switch req.Category {
	case CategoryUnderageSuspicion:
		priority = PriorityCritical
		slaDuration = 2 * time.Hour
		// Auto-restrict suspected underage pending immediate verification
		_ = s.handleSuspectedUnderage(ctx, req.ReportedUserID, "Member report: suspected underage")
	case CategoryHarassment, CategoryHateSpeech:
		priority = PriorityHigh
		slaDuration = 12 * time.Hour
	case CategoryScamOrFraud, CategoryImpersonation:
		priority = PriorityMedium
		slaDuration = 24 * time.Hour
	default:
		priority = PriorityLow
		slaDuration = 48 * time.Hour
	}

	// Check if case already exists for target user
	existingCase, err := s.repo.GetOpenCaseByTargetUser(ctx, req.ReportedUserID)
	if err != nil {
		s.logger.Error("failed_lookup_open_case", slog.String("error", err.Error()))
	}

	now := time.Now().UTC()
	if existingCase != nil {
		// Escalate priority if higher
		if priorityWeight(priority) > priorityWeight(existingCase.Priority) {
			existingCase.Priority = priority
			existingCase.PrimaryCategory = req.Category
			existingCase.SLADueAt = now.Add(slaDuration)
			_ = s.repo.UpdateCase(ctx, existingCase)
		}
	} else {
		newCase := &ModerationCase{
			TargetUserID:    req.ReportedUserID,
			PrimaryCategory: req.Category,
			Priority:        priority,
			Status:          CaseOpen,
			SLADueAt:        now.Add(slaDuration),
		}
		_ = s.repo.CreateCase(ctx, newCase)
	}

	_ = s.audit.Record(ctx, &SecurityAuditLog{
		ActorUserID: &reporter.ID,
		ActorRole:   string(reporter.Role),
		Action:      "moderation.report_submitted",
		TargetType:  string(req.TargetType),
		TargetID:    req.TargetID,
		Outcome:     AuditSuccess,
		Reason:      string(req.Category),
		IPAddress:   clientIP,
		RequestID:   reqID,
	})

	return report, nil
}

func (s *Service) ListCases(
	ctx context.Context,
	adminUser *identity.AuthUser,
	status *CaseStatus,
	priority *CasePriority,
	limit int,
) ([]ModerationCase, error) {
	if !HasPermission(adminUser.Role, PermModerationRead) {
		return nil, ErrForbidden
	}
	return s.repo.ListCases(ctx, status, priority, limit)
}

func (s *Service) GetCaseDetails(
	ctx context.Context,
	adminUser *identity.AuthUser,
	caseID, clientIP, reqID string,
) (*ModerationCaseDetails, error) {
	if !HasPermission(adminUser.Role, PermModerationRead) {
		return nil, ErrForbidden
	}

	c, err := s.repo.GetCaseByID(ctx, caseID)
	if err != nil {
		return nil, err
	}

	reports, err := s.repo.ListReportsByTargetUser(ctx, c.TargetUserID, 50)
	if err != nil {
		return nil, err
	}

	actions, err := s.repo.ListActionsByTargetUser(ctx, c.TargetUserID, 50)
	if err != nil {
		return nil, err
	}

	// Audit access to moderation evidence (Privacy rule: evidence access is tracked)
	_ = s.audit.Record(ctx, &SecurityAuditLog{
		ActorUserID: &adminUser.ID,
		ActorRole:   string(adminUser.Role),
		Action:      "moderation.case_evidence_viewed",
		TargetType:  "CASE",
		TargetID:    caseID,
		Outcome:     AuditSuccess,
		Reason:      fmt.Sprintf("viewed case for target %s", c.TargetUserID),
		IPAddress:   clientIP,
		RequestID:   reqID,
	})

	return &ModerationCaseDetails{
		Case:    c,
		Reports: reports,
		Actions: actions,
	}, nil
}

func (s *Service) AssignCase(
	ctx context.Context,
	adminUser *identity.AuthUser,
	caseID, assigneeID, clientIP, reqID string,
) (*ModerationCase, error) {
	if !HasPermission(adminUser.Role, PermModerationAction) {
		return nil, ErrForbidden
	}

	c, err := s.repo.GetCaseByID(ctx, caseID)
	if err != nil {
		return nil, err
	}

	c.AssignedAdminID = &assigneeID
	c.Status = CaseInvestigating
	if err := s.repo.UpdateCase(ctx, c); err != nil {
		return nil, err
	}

	_ = s.audit.Record(ctx, &SecurityAuditLog{
		ActorUserID: &adminUser.ID,
		ActorRole:   string(adminUser.Role),
		Action:      "moderation.case_assigned",
		TargetType:  "CASE",
		TargetID:    caseID,
		Outcome:     AuditSuccess,
		Reason:      fmt.Sprintf("assigned to admin %s", assigneeID),
		IPAddress:   clientIP,
		RequestID:   reqID,
	})

	return c, nil
}

func (s *Service) ExecuteModerationAction(
	ctx context.Context,
	adminUser *identity.AuthUser,
	caseID string,
	req CreateModerationActionRequest,
	clientIP, reqID string,
) (*ModerationAction, error) {
	if !HasPermission(adminUser.Role, PermModerationAction) {
		return nil, ErrForbidden
	}

	c, err := s.repo.GetCaseByID(ctx, caseID)
	if err != nil {
		return nil, err
	}

	if err := ValidateNonSelfAction(adminUser.ID, c.TargetUserID); err != nil {
		return nil, err
	}

	action := &ModerationAction{
		CaseID:        &caseID,
		TargetUserID:  c.TargetUserID,
		AdminUserID:   adminUser.ID,
		ActionType:    req.ActionType,
		Reason:        req.Reason,
		DurationHours: req.DurationHours,
	}

	if err := s.repo.CreateModerationAction(ctx, action); err != nil {
		return nil, fmt.Errorf("failed to create moderation action: %w", err)
	}

	// Apply sanctions to identity account
	switch req.ActionType {
	case ActionBan:
		if s.identityRepo != nil {
			_ = s.identityRepo.UpdateUserStatus(ctx, c.TargetUserID, identity.StatusBanned)
		}
		if s.hub != nil {
			s.hub.DisconnectUser(c.TargetUserID)
		}
	case ActionSuspend:
		if s.identityRepo != nil {
			_ = s.identityRepo.UpdateUserStatus(ctx, c.TargetUserID, identity.StatusSuspended)
		}
		if s.hub != nil {
			s.hub.DisconnectUser(c.TargetUserID)
		}
	case ActionClear:
		if s.identityRepo != nil {
			_ = s.identityRepo.UpdateUserStatus(ctx, c.TargetUserID, identity.StatusActive)
		}
	}

	// Mark case resolved
	now := time.Now().UTC()
	c.Status = CaseResolved
	c.ResolvedAt = &now
	c.ResolutionNote = &req.Reason
	_ = s.repo.UpdateCase(ctx, c)

	_ = s.audit.Record(ctx, &SecurityAuditLog{
		ActorUserID: &adminUser.ID,
		ActorRole:   string(adminUser.Role),
		Action:      fmt.Sprintf("moderation.action_%s", strings.ToLower(string(req.ActionType))),
		TargetType:  "USER",
		TargetID:    c.TargetUserID,
		Outcome:     AuditSuccess,
		Reason:      req.Reason,
		IPAddress:   clientIP,
		RequestID:   reqID,
	})

	return action, nil
}

func (s *Service) SubmitAppeal(ctx context.Context, user *identity.AuthUser, req CreateAppealRequest) (*ModerationAppeal, error) {
	appeal := &ModerationAppeal{
		UserID:   user.ID,
		ActionID: req.ActionID,
		Reason:   strings.TrimSpace(req.Reason),
		Status:   AppealPending,
	}

	if err := s.repo.CreateAppeal(ctx, appeal); err != nil {
		return nil, fmt.Errorf("failed to create appeal: %w", err)
	}

	_ = s.audit.Record(ctx, &SecurityAuditLog{
		ActorUserID: &user.ID,
		ActorRole:   string(user.Role),
		Action:      "moderation.appeal_submitted",
		TargetType:  "USER",
		TargetID:    user.ID,
		Outcome:     AuditSuccess,
		Reason:      req.Reason,
	})

	return appeal, nil
}

func (s *Service) ListAppeals(ctx context.Context, adminUser *identity.AuthUser, status *AppealStatus, limit int) ([]ModerationAppeal, error) {
	if !HasPermission(adminUser.Role, PermModerationRead) {
		return nil, ErrForbidden
	}
	return s.repo.ListAppeals(ctx, status, limit)
}

func (s *Service) GetMyAppeals(ctx context.Context, userID string) ([]ModerationAppeal, error) {
	return s.repo.ListAppealsByUserID(ctx, userID)
}

func (s *Service) DecideAppeal(
	ctx context.Context,
	adminUser *identity.AuthUser,
	appealID string,
	req DecideAppealRequest,
	clientIP, reqID string,
) (*ModerationAppeal, error) {
	if !HasPermission(adminUser.Role, PermModerationAction) {
		return nil, ErrForbidden
	}

	appeal, err := s.repo.GetAppealByID(ctx, appealID)
	if err != nil {
		return nil, err
	}

	if err := ValidateNonSelfAction(adminUser.ID, appeal.UserID); err != nil {
		return nil, err
	}

	appeal.ReviewedByAdminID = &adminUser.ID
	appeal.ReviewNotes = &req.ReviewNotes
	if req.Approved {
		appeal.Status = AppealApproved
		// Restore user account
		if s.identityRepo != nil {
			_ = s.identityRepo.UpdateUserStatus(ctx, appeal.UserID, identity.StatusActive)
		}
	} else {
		appeal.Status = AppealRejected
	}

	if err := s.repo.UpdateAppeal(ctx, appeal); err != nil {
		return nil, err
	}

	_ = s.audit.Record(ctx, &SecurityAuditLog{
		ActorUserID: &adminUser.ID,
		ActorRole:   string(adminUser.Role),
		Action:      fmt.Sprintf("moderation.appeal_decision_%s", strings.ToLower(string(appeal.Status))),
		TargetType:  "APPEAL",
		TargetID:    appealID,
		Outcome:     AuditSuccess,
		Reason:      req.ReviewNotes,
		IPAddress:   clientIP,
		RequestID:   reqID,
	})

	return appeal, nil
}

// -----------------------------------------------------------------------------
// Security Audit Querying
// -----------------------------------------------------------------------------

func (s *Service) QueryAuditLogs(
	ctx context.Context,
	adminUser *identity.AuthUser,
	actorID, action, targetType string,
	limit int,
) ([]SecurityAuditLog, error) {
	if !HasPermission(adminUser.Role, PermAuditRead) {
		return nil, ErrForbidden
	}
	return s.repo.ListAuditLogs(ctx, actorID, action, targetType, limit)
}

// -----------------------------------------------------------------------------
// Fraud Protection Delegates
// -----------------------------------------------------------------------------

func (s *Service) CheckLoginAllowed(ctx context.Context, email, clientIP string) error {
	return s.fraud.CheckLoginAllowed(ctx, email, clientIP)
}

func (s *Service) RecordFailedLogin(ctx context.Context, email, clientIP string) (int, *time.Time, error) {
	return s.fraud.RecordFailedLogin(ctx, email, clientIP)
}

func (s *Service) RecordSuccessfulLogin(ctx context.Context, email, clientIP string) error {
	return s.fraud.RecordSuccessfulLogin(ctx, email, clientIP)
}

// -----------------------------------------------------------------------------
// Step-Up Authentication
// -----------------------------------------------------------------------------

func (s *Service) CreateStepUpToken(ctx context.Context, userID, password string, ttl time.Duration, clientIP, reqID string) (string, time.Time, error) {
	if s.stepUpVerifier == nil {
		return "", time.Time{}, errors.New("step-up verifier is not configured")
	}
	if s.identityRepo == nil {
		return "", time.Time{}, errors.New("identity repository is not configured")
	}

	user, err := s.identityRepo.GetUserByID(ctx, userID)
	if err != nil {
		return "", time.Time{}, identity.ErrUserNotFound
	}

	match, err := identity.VerifyPassword(password, user.PasswordHash)
	if err != nil || !match {
		_ = s.audit.Record(ctx, &SecurityAuditLog{
			ActorUserID: &userID,
			ActorRole:   string(user.Role),
			Action:      "auth.step_up_challenge",
			TargetType:  "USER",
			TargetID:    userID,
			Outcome:     AuditFailure,
			Reason:      "invalid password provided for step-up authentication",
			IPAddress:   clientIP,
			RequestID:   reqID,
		})
		return "", time.Time{}, errors.New("invalid credentials for step-up authentication")
	}

	if ttl <= 0 {
		ttl = StepUpTokenDefaultDuration
	}

	tokenStr, err := s.stepUpVerifier.GenerateStepUpToken(userID, ttl)
	if err != nil {
		return "", time.Time{}, err
	}

	exp := time.Now().UTC().Add(ttl)

	_ = s.audit.Record(ctx, &SecurityAuditLog{
		ActorUserID: &userID,
		ActorRole:   string(user.Role),
		Action:      "auth.step_up_challenge",
		TargetType:  "USER",
		TargetID:    userID,
		Outcome:     AuditSuccess,
		Reason:      "step-up token issued successfully",
		IPAddress:   clientIP,
		RequestID:   reqID,
	})

	return tokenStr, exp, nil
}
