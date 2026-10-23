package safety

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository specifies all safety, moderation, age-assurance, and audit data access operations.
type Repository interface {
	// Age Assurance
	UpsertAgeAssurance(ctx context.Context, aa *AgeAssurance) error
	GetAgeAssuranceByUserID(ctx context.Context, userID string) (*AgeAssurance, error)
	GetAgeAssuranceBySessionID(ctx context.Context, provider, sessionID string) (*AgeAssurance, error)

	// Passport Trial
	GetPassportTrial(ctx context.Context, userID string) (*PassportVerificationTrial, error)
	SavePassportTrial(ctx context.Context, trial *PassportVerificationTrial) error

	// Reports & Moderation Cases
	CreateReport(ctx context.Context, report *ModerationReport) error
	GetReportByID(ctx context.Context, id string) (*ModerationReport, error)
	ListReportsByTargetUser(ctx context.Context, targetUserID string, limit int) ([]ModerationReport, error)
	CreateCase(ctx context.Context, c *ModerationCase) error
	GetCaseByID(ctx context.Context, id string) (*ModerationCase, error)
	GetOpenCaseByTargetUser(ctx context.Context, targetUserID string) (*ModerationCase, error)
	ListCases(ctx context.Context, status *CaseStatus, priority *CasePriority, limit int) ([]ModerationCase, error)
	UpdateCase(ctx context.Context, c *ModerationCase) error
	CreateModerationAction(ctx context.Context, action *ModerationAction) error
	ListActionsByTargetUser(ctx context.Context, targetUserID string, limit int) ([]ModerationAction, error)

	// Appeals
	CreateAppeal(ctx context.Context, appeal *ModerationAppeal) error
	GetAppealByID(ctx context.Context, id string) (*ModerationAppeal, error)
	ListAppeals(ctx context.Context, status *AppealStatus, limit int) ([]ModerationAppeal, error)
	ListAppealsByUserID(ctx context.Context, userID string) ([]ModerationAppeal, error)
	UpdateAppeal(ctx context.Context, appeal *ModerationAppeal) error

	// Audit Logs
	InsertAuditLog(ctx context.Context, log *SecurityAuditLog) error
	ListAuditLogs(ctx context.Context, actorID, action, targetType string, limit int) ([]SecurityAuditLog, error)

	// Login Attempts
	GetLoginAttempt(ctx context.Context, email, ipAddress string) (*LoginAttempt, error)
	RecordFailedLogin(ctx context.Context, email, ipAddress string, maxAttempts int, lockDuration time.Duration) (int, *time.Time, error)
	ResetLoginAttempts(ctx context.Context, email, ipAddress string) error
}

// MemoryRepository provides a thread-safe in-memory storage for unit and router testing.
type MemoryRepository struct {
	mu             sync.RWMutex
	seq            uint64
	ageAssurances  map[string]*AgeAssurance // userID -> aa
	aaBySession    map[string]string        // provider:sessionID -> userID
	passportTrials map[string]*PassportVerificationTrial
	reports        map[string]*ModerationReport // id -> report
	cases          map[string]*ModerationCase   // id -> case
	actions        map[string]*ModerationAction // id -> action
	appeals        map[string]*ModerationAppeal // id -> appeal
	auditLogs      []SecurityAuditLog
	loginAttempts  map[string]*LoginAttempt // email:ip -> attempt
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		ageAssurances:  make(map[string]*AgeAssurance),
		aaBySession:    make(map[string]string),
		passportTrials: make(map[string]*PassportVerificationTrial),
		reports:        make(map[string]*ModerationReport),
		cases:          make(map[string]*ModerationCase),
		actions:        make(map[string]*ModerationAction),
		appeals:        make(map[string]*ModerationAppeal),
		loginAttempts:  make(map[string]*LoginAttempt),
	}
}

func (m *MemoryRepository) UpsertAgeAssurance(ctx context.Context, aa *AgeAssurance) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	if aa.ID == "" {
		m.seq++
		aa.ID = fmt.Sprintf("aa_%d_%d", now.UnixNano(), m.seq)
		aa.CreatedAt = now
	}
	aa.UpdatedAt = now

	cp := *aa
	m.ageAssurances[aa.UserID] = &cp
	sessionKey := fmt.Sprintf("%s:%s", aa.Provider, aa.ProviderSessionID)
	m.aaBySession[sessionKey] = aa.UserID
	return nil
}

func (m *MemoryRepository) GetAgeAssuranceByUserID(ctx context.Context, userID string) (*AgeAssurance, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	aa, ok := m.ageAssurances[userID]
	if !ok {
		return nil, nil
	}
	cp := *aa
	return &cp, nil
}

func (m *MemoryRepository) GetAgeAssuranceBySessionID(ctx context.Context, provider, sessionID string) (*AgeAssurance, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	sessionKey := fmt.Sprintf("%s:%s", provider, sessionID)
	userID, ok := m.aaBySession[sessionKey]
	if !ok {
		return nil, nil
	}
	aa := m.ageAssurances[userID]
	if aa == nil {
		return nil, nil
	}
	cp := *aa
	return &cp, nil
}

func (m *MemoryRepository) GetPassportTrial(ctx context.Context, userID string) (*PassportVerificationTrial, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	trial, ok := m.passportTrials[userID]
	if !ok {
		return nil, nil
	}
	cp := *trial
	return &cp, nil
}

func (m *MemoryRepository) SavePassportTrial(ctx context.Context, trial *PassportVerificationTrial) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cp := *trial
	m.passportTrials[trial.UserID] = &cp
	return nil
}

func (m *MemoryRepository) CreateReport(ctx context.Context, report *ModerationReport) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	if report.ID == "" {
		m.seq++
		report.ID = fmt.Sprintf("rep_%d_%d", now.UnixNano(), m.seq)
	}
	report.CreatedAt = now
	report.UpdatedAt = now

	cp := *report
	m.reports[report.ID] = &cp
	return nil
}

func (m *MemoryRepository) GetReportByID(ctx context.Context, id string) (*ModerationReport, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	r, ok := m.reports[id]
	if !ok {
		return nil, ErrReportNotFound
	}
	cp := *r
	return &cp, nil
}

func (m *MemoryRepository) ListReportsByTargetUser(ctx context.Context, targetUserID string, limit int) ([]ModerationReport, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []ModerationReport
	for _, r := range m.reports {
		if r.ReportedUserID == targetUserID {
			list = append(list, *r)
		}
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.After(list[j].CreatedAt)
	})
	if limit > 0 && len(list) > limit {
		list = list[:limit]
	}
	return list, nil
}

func (m *MemoryRepository) CreateCase(ctx context.Context, c *ModerationCase) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	if c.ID == "" {
		m.seq++
		c.ID = fmt.Sprintf("case_%d_%d", now.UnixNano(), m.seq)
	}
	c.CreatedAt = now
	c.UpdatedAt = now

	cp := *c
	m.cases[c.ID] = &cp
	return nil
}

func (m *MemoryRepository) GetCaseByID(ctx context.Context, id string) (*ModerationCase, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	c, ok := m.cases[id]
	if !ok {
		return nil, ErrCaseNotFound
	}
	cp := *c
	return &cp, nil
}

func (m *MemoryRepository) GetOpenCaseByTargetUser(ctx context.Context, targetUserID string) (*ModerationCase, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, c := range m.cases {
		if c.TargetUserID == targetUserID && (c.Status == CaseOpen || c.Status == CaseInvestigating) {
			cp := *c
			return &cp, nil
		}
	}
	return nil, nil
}

func (m *MemoryRepository) ListCases(ctx context.Context, status *CaseStatus, priority *CasePriority, limit int) ([]ModerationCase, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []ModerationCase
	for _, c := range m.cases {
		if status != nil && c.Status != *status {
			continue
		}
		if priority != nil && c.Priority != *priority {
			continue
		}
		list = append(list, *c)
	}
	sort.Slice(list, func(i, j int) bool {
		// Critical first, then by earliest SLA
		if list[i].Priority != list[j].Priority {
			return priorityWeight(list[i].Priority) > priorityWeight(list[j].Priority)
		}
		return list[i].SLADueAt.Before(list[j].SLADueAt)
	})
	if limit > 0 && len(list) > limit {
		list = list[:limit]
	}
	return list, nil
}

func priorityWeight(p CasePriority) int {
	switch p {
	case PriorityCritical:
		return 4
	case PriorityHigh:
		return 3
	case PriorityMedium:
		return 2
	default:
		return 1
	}
}

func (m *MemoryRepository) UpdateCase(ctx context.Context, c *ModerationCase) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.cases[c.ID]
	if !ok {
		return ErrCaseNotFound
	}
	c.UpdatedAt = time.Now().UTC()
	*existing = *c
	return nil
}

func (m *MemoryRepository) CreateModerationAction(ctx context.Context, action *ModerationAction) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	if action.ID == "" {
		m.seq++
		action.ID = fmt.Sprintf("act_%d_%d", now.UnixNano(), m.seq)
	}
	action.CreatedAt = now

	cp := *action
	m.actions[action.ID] = &cp
	return nil
}

func (m *MemoryRepository) ListActionsByTargetUser(ctx context.Context, targetUserID string, limit int) ([]ModerationAction, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []ModerationAction
	for _, a := range m.actions {
		if a.TargetUserID == targetUserID {
			list = append(list, *a)
		}
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.After(list[j].CreatedAt)
	})
	if limit > 0 && len(list) > limit {
		list = list[:limit]
	}
	return list, nil
}

func (m *MemoryRepository) CreateAppeal(ctx context.Context, appeal *ModerationAppeal) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	if appeal.ID == "" {
		m.seq++
		appeal.ID = fmt.Sprintf("app_%d_%d", now.UnixNano(), m.seq)
	}
	appeal.CreatedAt = now
	appeal.UpdatedAt = now

	cp := *appeal
	m.appeals[appeal.ID] = &cp
	return nil
}

func (m *MemoryRepository) GetAppealByID(ctx context.Context, id string) (*ModerationAppeal, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	a, ok := m.appeals[id]
	if !ok {
		return nil, ErrAppealNotFound
	}
	cp := *a
	return &cp, nil
}

func (m *MemoryRepository) ListAppeals(ctx context.Context, status *AppealStatus, limit int) ([]ModerationAppeal, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []ModerationAppeal
	for _, a := range m.appeals {
		if status != nil && a.Status != *status {
			continue
		}
		list = append(list, *a)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.After(list[j].CreatedAt)
	})
	if limit > 0 && len(list) > limit {
		list = list[:limit]
	}
	return list, nil
}

func (m *MemoryRepository) ListAppealsByUserID(ctx context.Context, userID string) ([]ModerationAppeal, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []ModerationAppeal
	for _, a := range m.appeals {
		if a.UserID == userID {
			list = append(list, *a)
		}
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.After(list[j].CreatedAt)
	})
	return list, nil
}

func (m *MemoryRepository) UpdateAppeal(ctx context.Context, appeal *ModerationAppeal) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.appeals[appeal.ID]
	if !ok {
		return ErrAppealNotFound
	}
	appeal.UpdatedAt = time.Now().UTC()
	*existing = *appeal
	return nil
}

func (m *MemoryRepository) InsertAuditLog(ctx context.Context, log *SecurityAuditLog) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	if log.ID == "" {
		m.seq++
		log.ID = fmt.Sprintf("aud_%d_%d", now.UnixNano(), m.seq)
	}
	if log.CreatedAt.IsZero() {
		log.CreatedAt = now
	}

	m.auditLogs = append(m.auditLogs, *log)
	return nil
}

func (m *MemoryRepository) ListAuditLogs(ctx context.Context, actorID, action, targetType string, limit int) ([]SecurityAuditLog, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []SecurityAuditLog
	for i := len(m.auditLogs) - 1; i >= 0; i-- {
		l := m.auditLogs[i]
		if actorID != "" && (l.ActorUserID == nil || *l.ActorUserID != actorID) {
			continue
		}
		if action != "" && l.Action != action {
			continue
		}
		if targetType != "" && l.TargetType != targetType {
			continue
		}
		list = append(list, l)
		if limit > 0 && len(list) >= limit {
			break
		}
	}
	return list, nil
}

func (m *MemoryRepository) GetLoginAttempt(ctx context.Context, email, ipAddress string) (*LoginAttempt, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	key := fmt.Sprintf("%s:%s", email, ipAddress)
	att, ok := m.loginAttempts[key]
	if !ok {
		return nil, nil
	}
	cp := *att
	return &cp, nil
}

func (m *MemoryRepository) RecordFailedLogin(ctx context.Context, email, ipAddress string, maxAttempts int, lockDuration time.Duration) (int, *time.Time, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := fmt.Sprintf("%s:%s", email, ipAddress)
	now := time.Now().UTC()
	att, ok := m.loginAttempts[key]
	if !ok {
		m.seq++
		att = &LoginAttempt{
			ID:            fmt.Sprintf("att_%d_%d", now.UnixNano(), m.seq),
			Email:         email,
			IPAddress:     ipAddress,
			AttemptCount:  1,
			LastAttemptAt: now,
		}
		m.loginAttempts[key] = att
		return 1, nil, nil
	}

	att.AttemptCount++
	att.LastAttemptAt = now

	var lockedUntil *time.Time
	if att.AttemptCount >= maxAttempts {
		until := now.Add(lockDuration)
		att.LockedUntil = &until
		lockedUntil = &until
	}

	return att.AttemptCount, lockedUntil, nil
}

func (m *MemoryRepository) ResetLoginAttempts(ctx context.Context, email, ipAddress string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := fmt.Sprintf("%s:%s", email, ipAddress)
	delete(m.loginAttempts, key)
	return nil
}

// PostgresRepository provides full PostgreSQL pgxpool storage.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (p *PostgresRepository) UpsertAgeAssurance(ctx context.Context, aa *AgeAssurance) error {
	metaJSON, _ := json.Marshal(aa.Metadata)
	query := `
		INSERT INTO age_assurances (
			user_id, provider, provider_session_id, status, risk_score, verified_at, expires_at, metadata, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			provider = EXCLUDED.provider,
			provider_session_id = EXCLUDED.provider_session_id,
			status = EXCLUDED.status,
			risk_score = EXCLUDED.risk_score,
			verified_at = EXCLUDED.verified_at,
			expires_at = EXCLUDED.expires_at,
			metadata = EXCLUDED.metadata,
			updated_at = NOW()
		RETURNING id, created_at, updated_at;
	`
	return p.pool.QueryRow(ctx, query,
		aa.UserID, aa.Provider, aa.ProviderSessionID, aa.Status, aa.RiskScore, aa.VerifiedAt, aa.ExpiresAt, metaJSON,
	).Scan(&aa.ID, &aa.CreatedAt, &aa.UpdatedAt)
}

func (p *PostgresRepository) GetAgeAssuranceByUserID(ctx context.Context, userID string) (*AgeAssurance, error) {
	query := `
		SELECT id, user_id, provider, provider_session_id, status, risk_score, verified_at, expires_at, metadata, created_at, updated_at
		FROM age_assurances WHERE user_id = $1;
	`
	var aa AgeAssurance
	var metaBytes []byte
	err := p.pool.QueryRow(ctx, query, userID).Scan(
		&aa.ID, &aa.UserID, &aa.Provider, &aa.ProviderSessionID, &aa.Status, &aa.RiskScore,
		&aa.VerifiedAt, &aa.ExpiresAt, &metaBytes, &aa.CreatedAt, &aa.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(metaBytes) > 0 {
		_ = json.Unmarshal(metaBytes, &aa.Metadata)
	}
	return &aa, nil
}

func (p *PostgresRepository) GetAgeAssuranceBySessionID(ctx context.Context, provider, sessionID string) (*AgeAssurance, error) {
	query := `
		SELECT id, user_id, provider, provider_session_id, status, risk_score, verified_at, expires_at, metadata, created_at, updated_at
		FROM age_assurances WHERE provider = $1 AND provider_session_id = $2;
	`
	var aa AgeAssurance
	var metaBytes []byte
	err := p.pool.QueryRow(ctx, query, provider, sessionID).Scan(
		&aa.ID, &aa.UserID, &aa.Provider, &aa.ProviderSessionID, &aa.Status, &aa.RiskScore,
		&aa.VerifiedAt, &aa.ExpiresAt, &metaBytes, &aa.CreatedAt, &aa.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(metaBytes) > 0 {
		_ = json.Unmarshal(metaBytes, &aa.Metadata)
	}
	return &aa, nil
}

func (p *PostgresRepository) GetPassportTrial(ctx context.Context, userID string) (*PassportVerificationTrial, error) {
	query := `
		SELECT user_id, started_at, ends_at, trial_used, created_at, updated_at
		FROM passport_verification_trials
		WHERE user_id = $1;
	`
	var t PassportVerificationTrial
	err := p.pool.QueryRow(ctx, query, userID).Scan(
		&t.UserID, &t.StartedAt, &t.EndsAt, &t.TrialUsed, &t.CreatedAt, &t.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (p *PostgresRepository) SavePassportTrial(ctx context.Context, trial *PassportVerificationTrial) error {
	query := `
		INSERT INTO passport_verification_trials (user_id, started_at, ends_at, trial_used, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (user_id) DO UPDATE SET
			ends_at = EXCLUDED.ends_at,
			trial_used = EXCLUDED.trial_used,
			updated_at = NOW();
	`
	_, err := p.pool.Exec(ctx, query,
		trial.UserID, trial.StartedAt, trial.EndsAt, trial.TrialUsed, trial.CreatedAt, trial.UpdatedAt,
	)
	return err
}

func (p *PostgresRepository) CreateReport(ctx context.Context, report *ModerationReport) error {
	query := `
		INSERT INTO moderation_reports (
			reporter_user_id, reported_user_id, target_type, target_id, category, reason, status
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at, updated_at;
	`
	return p.pool.QueryRow(ctx, query,
		report.ReporterUserID, report.ReportedUserID, report.TargetType, report.TargetID, report.Category, report.Reason, report.Status,
	).Scan(&report.ID, &report.CreatedAt, &report.UpdatedAt)
}

func (p *PostgresRepository) GetReportByID(ctx context.Context, id string) (*ModerationReport, error) {
	query := `
		SELECT id, reporter_user_id, reported_user_id, target_type, target_id, category, reason, status, created_at, updated_at
		FROM moderation_reports WHERE id = $1;
	`
	var r ModerationReport
	err := p.pool.QueryRow(ctx, query, id).Scan(
		&r.ID, &r.ReporterUserID, &r.ReportedUserID, &r.TargetType, &r.TargetID, &r.Category, &r.Reason, &r.Status, &r.CreatedAt, &r.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrReportNotFound
	}
	return &r, err
}

func (p *PostgresRepository) ListReportsByTargetUser(ctx context.Context, targetUserID string, limit int) ([]ModerationReport, error) {
	query := `
		SELECT id, reporter_user_id, reported_user_id, target_type, target_id, category, reason, status, created_at, updated_at
		FROM moderation_reports WHERE reported_user_id = $1 ORDER BY created_at DESC LIMIT $2;
	`
	rows, err := p.pool.Query(ctx, query, targetUserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []ModerationReport
	for rows.Next() {
		var r ModerationReport
		if err := rows.Scan(
			&r.ID, &r.ReporterUserID, &r.ReportedUserID, &r.TargetType, &r.TargetID, &r.Category, &r.Reason, &r.Status, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, r)
	}
	return list, rows.Err()
}

func (p *PostgresRepository) CreateCase(ctx context.Context, c *ModerationCase) error {
	query := `
		INSERT INTO moderation_cases (
			target_user_id, primary_category, priority, status, assigned_admin_id, resolution_note, sla_due_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at, updated_at;
	`
	return p.pool.QueryRow(ctx, query,
		c.TargetUserID, c.PrimaryCategory, c.Priority, c.Status, c.AssignedAdminID, c.ResolutionNote, c.SLADueAt,
	).Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
}

func (p *PostgresRepository) GetCaseByID(ctx context.Context, id string) (*ModerationCase, error) {
	query := `
		SELECT id, target_user_id, primary_category, priority, status, assigned_admin_id, resolution_note, sla_due_at, resolved_at, created_at, updated_at
		FROM moderation_cases WHERE id = $1;
	`
	var c ModerationCase
	err := p.pool.QueryRow(ctx, query, id).Scan(
		&c.ID, &c.TargetUserID, &c.PrimaryCategory, &c.Priority, &c.Status, &c.AssignedAdminID, &c.ResolutionNote, &c.SLADueAt, &c.ResolvedAt, &c.CreatedAt, &c.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrCaseNotFound
	}
	return &c, err
}

func (p *PostgresRepository) GetOpenCaseByTargetUser(ctx context.Context, targetUserID string) (*ModerationCase, error) {
	query := `
		SELECT id, target_user_id, primary_category, priority, status, assigned_admin_id, resolution_note, sla_due_at, resolved_at, created_at, updated_at
		FROM moderation_cases WHERE target_user_id = $1 AND status IN ('OPEN', 'INVESTIGATING') LIMIT 1;
	`
	var c ModerationCase
	err := p.pool.QueryRow(ctx, query, targetUserID).Scan(
		&c.ID, &c.TargetUserID, &c.PrimaryCategory, &c.Priority, &c.Status, &c.AssignedAdminID, &c.ResolutionNote, &c.SLADueAt, &c.ResolvedAt, &c.CreatedAt, &c.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

func (p *PostgresRepository) ListCases(ctx context.Context, status *CaseStatus, priority *CasePriority, limit int) ([]ModerationCase, error) {
	query := `
		SELECT id, target_user_id, primary_category, priority, status, assigned_admin_id, resolution_note, sla_due_at, resolved_at, created_at, updated_at
		FROM moderation_cases
		WHERE ($1::text IS NULL OR status = $1)
		  AND ($2::text IS NULL OR priority = $2)
		ORDER BY 
			CASE priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
			sla_due_at ASC
		LIMIT $3;
	`
	var sStr, pStr *string
	if status != nil {
		s := string(*status)
		sStr = &s
	}
	if priority != nil {
		p := string(*priority)
		pStr = &p
	}

	rows, err := p.pool.Query(ctx, query, sStr, pStr, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []ModerationCase
	for rows.Next() {
		var c ModerationCase
		if err := rows.Scan(
			&c.ID, &c.TargetUserID, &c.PrimaryCategory, &c.Priority, &c.Status, &c.AssignedAdminID, &c.ResolutionNote, &c.SLADueAt, &c.ResolvedAt, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, c)
	}
	return list, rows.Err()
}

func (p *PostgresRepository) UpdateCase(ctx context.Context, c *ModerationCase) error {
	query := `
		UPDATE moderation_cases
		SET status = $2, assigned_admin_id = $3, resolution_note = $4, resolved_at = $5, updated_at = NOW()
		WHERE id = $1;
	`
	_, err := p.pool.Exec(ctx, query, c.ID, c.Status, c.AssignedAdminID, c.ResolutionNote, c.ResolvedAt)
	return err
}

func (p *PostgresRepository) CreateModerationAction(ctx context.Context, action *ModerationAction) error {
	query := `
		INSERT INTO moderation_actions (
			case_id, target_user_id, admin_user_id, action_type, reason, duration_hours
		) VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at;
	`
	return p.pool.QueryRow(ctx, query,
		action.CaseID, action.TargetUserID, action.AdminUserID, action.ActionType, action.Reason, action.DurationHours,
	).Scan(&action.ID, &action.CreatedAt)
}

func (p *PostgresRepository) ListActionsByTargetUser(ctx context.Context, targetUserID string, limit int) ([]ModerationAction, error) {
	query := `
		SELECT id, case_id, target_user_id, admin_user_id, action_type, reason, duration_hours, created_at
		FROM moderation_actions WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT $2;
	`
	rows, err := p.pool.Query(ctx, query, targetUserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []ModerationAction
	for rows.Next() {
		var a ModerationAction
		if err := rows.Scan(
			&a.ID, &a.CaseID, &a.TargetUserID, &a.AdminUserID, &a.ActionType, &a.Reason, &a.DurationHours, &a.CreatedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, rows.Err()
}

func (p *PostgresRepository) CreateAppeal(ctx context.Context, appeal *ModerationAppeal) error {
	query := `
		INSERT INTO moderation_appeals (
			user_id, action_id, reason, status
		) VALUES ($1, $2, $3, $4)
		RETURNING id, created_at, updated_at;
	`
	return p.pool.QueryRow(ctx, query,
		appeal.UserID, appeal.ActionID, appeal.Reason, appeal.Status,
	).Scan(&appeal.ID, &appeal.CreatedAt, &appeal.UpdatedAt)
}

func (p *PostgresRepository) GetAppealByID(ctx context.Context, id string) (*ModerationAppeal, error) {
	query := `
		SELECT id, user_id, action_id, reason, status, reviewed_by_admin_id, review_notes, created_at, updated_at
		FROM moderation_appeals WHERE id = $1;
	`
	var a ModerationAppeal
	err := p.pool.QueryRow(ctx, query, id).Scan(
		&a.ID, &a.UserID, &a.ActionID, &a.Reason, &a.Status, &a.ReviewedByAdminID, &a.ReviewNotes, &a.CreatedAt, &a.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAppealNotFound
	}
	return &a, err
}

func (p *PostgresRepository) ListAppeals(ctx context.Context, status *AppealStatus, limit int) ([]ModerationAppeal, error) {
	query := `
		SELECT id, user_id, action_id, reason, status, reviewed_by_admin_id, review_notes, created_at, updated_at
		FROM moderation_appeals
		WHERE ($1::text IS NULL OR status = $1)
		ORDER BY created_at DESC LIMIT $2;
	`
	var sStr *string
	if status != nil {
		s := string(*status)
		sStr = &s
	}
	rows, err := p.pool.Query(ctx, query, sStr, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []ModerationAppeal
	for rows.Next() {
		var a ModerationAppeal
		if err := rows.Scan(
			&a.ID, &a.UserID, &a.ActionID, &a.Reason, &a.Status, &a.ReviewedByAdminID, &a.ReviewNotes, &a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, rows.Err()
}

func (p *PostgresRepository) ListAppealsByUserID(ctx context.Context, userID string) ([]ModerationAppeal, error) {
	query := `
		SELECT id, user_id, action_id, reason, status, reviewed_by_admin_id, review_notes, created_at, updated_at
		FROM moderation_appeals WHERE user_id = $1 ORDER BY created_at DESC;
	`
	rows, err := p.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []ModerationAppeal
	for rows.Next() {
		var a ModerationAppeal
		if err := rows.Scan(
			&a.ID, &a.UserID, &a.ActionID, &a.Reason, &a.Status, &a.ReviewedByAdminID, &a.ReviewNotes, &a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, rows.Err()
}

func (p *PostgresRepository) UpdateAppeal(ctx context.Context, appeal *ModerationAppeal) error {
	query := `
		UPDATE moderation_appeals
		SET status = $2, reviewed_by_admin_id = $3, review_notes = $4, updated_at = NOW()
		WHERE id = $1;
	`
	_, err := p.pool.Exec(ctx, query, appeal.ID, appeal.Status, appeal.ReviewedByAdminID, appeal.ReviewNotes)
	return err
}

func (p *PostgresRepository) InsertAuditLog(ctx context.Context, log *SecurityAuditLog) error {
	metaJSON, _ := json.Marshal(log.Metadata)
	query := `
		INSERT INTO security_audit_logs (
			actor_user_id, actor_role, action, target_type, target_id, outcome, reason, ip_address, user_agent, request_id, metadata
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, created_at;
	`
	return p.pool.QueryRow(ctx, query,
		log.ActorUserID, log.ActorRole, log.Action, log.TargetType, log.TargetID, log.Outcome, log.Reason, log.IPAddress, log.UserAgent, log.RequestID, metaJSON,
	).Scan(&log.ID, &log.CreatedAt)
}

func (p *PostgresRepository) ListAuditLogs(ctx context.Context, actorID, action, targetType string, limit int) ([]SecurityAuditLog, error) {
	query := `
		SELECT id, actor_user_id, actor_role, action, target_type, target_id, outcome, reason, ip_address, user_agent, request_id, metadata, created_at
		FROM security_audit_logs
		WHERE ($1::uuid IS NULL OR actor_user_id = $1::uuid)
		  AND ($2::text = '' OR action = $2)
		  AND ($3::text = '' OR target_type = $3)
		ORDER BY created_at DESC LIMIT $4;
	`
	var actorParam *string
	if actorID != "" {
		actorParam = &actorID
	}

	rows, err := p.pool.Query(ctx, query, actorParam, action, targetType, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []SecurityAuditLog
	for rows.Next() {
		var l SecurityAuditLog
		var metaBytes []byte
		if err := rows.Scan(
			&l.ID, &l.ActorUserID, &l.ActorRole, &l.Action, &l.TargetType, &l.TargetID, &l.Outcome, &l.Reason, &l.IPAddress, &l.UserAgent, &l.RequestID, &metaBytes, &l.CreatedAt,
		); err != nil {
			return nil, err
		}
		if len(metaBytes) > 0 {
			_ = json.Unmarshal(metaBytes, &l.Metadata)
		}
		list = append(list, l)
	}
	return list, rows.Err()
}

func (p *PostgresRepository) GetLoginAttempt(ctx context.Context, email, ipAddress string) (*LoginAttempt, error) {
	query := `
		SELECT id, email, ip_address, attempt_count, locked_until, last_attempt_at
		FROM login_attempts WHERE email = $1 AND ip_address = $2;
	`
	var att LoginAttempt
	err := p.pool.QueryRow(ctx, query, email, ipAddress).Scan(
		&att.ID, &att.Email, &att.IPAddress, &att.AttemptCount, &att.LockedUntil, &att.LastAttemptAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &att, err
}

func (p *PostgresRepository) RecordFailedLogin(ctx context.Context, email, ipAddress string, maxAttempts int, lockDuration time.Duration) (int, *time.Time, error) {
	query := `
		INSERT INTO login_attempts (email, ip_address, attempt_count, last_attempt_at)
		VALUES ($1, $2, 1, NOW())
		ON CONFLICT (email, ip_address) DO UPDATE SET
			attempt_count = login_attempts.attempt_count + 1,
			last_attempt_at = NOW(),
			locked_until = CASE
				WHEN login_attempts.attempt_count + 1 >= $3 THEN NOW() + $4::interval
				ELSE login_attempts.locked_until
			END
		RETURNING attempt_count, locked_until;
	`
	var count int
	var lockedUntil *time.Time
	intervalStr := fmt.Sprintf("%d seconds", int(lockDuration.Seconds()))
	err := p.pool.QueryRow(ctx, query, email, ipAddress, maxAttempts, intervalStr).Scan(&count, &lockedUntil)
	return count, lockedUntil, err
}

func (p *PostgresRepository) ResetLoginAttempts(ctx context.Context, email, ipAddress string) error {
	query := `DELETE FROM login_attempts WHERE email = $1 AND ip_address = $2;`
	_, err := p.pool.Exec(ctx, query, email, ipAddress)
	return err
}
