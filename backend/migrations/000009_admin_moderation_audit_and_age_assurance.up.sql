-- 000009_admin_moderation_audit_and_age_assurance.up.sql
-- Mandatory 18+ age assurance, moderation reporting & case queue, appeals, security audit logs, and fraud login tracking.

CREATE TABLE IF NOT EXISTS age_assurances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    provider_session_id VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'MANUAL_REVIEW')),
    risk_score INT DEFAULT 0,
    verified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_age_assurance_user UNIQUE (user_id),
    CONSTRAINT uq_age_assurance_session UNIQUE (provider, provider_session_id)
);

CREATE INDEX IF NOT EXISTS idx_age_assurances_user_status
    ON age_assurances (user_id, status);

CREATE TABLE IF NOT EXISTS moderation_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(32) NOT NULL
        CHECK (target_type IN ('USER', 'PROFILE', 'MESSAGE', 'MEDIA')),
    target_id VARCHAR(128) NOT NULL,
    category VARCHAR(32) NOT NULL
        CHECK (category IN ('UNDERAGE_SUSPICION', 'HARASSMENT', 'HATE_SPEECH', 'IMPERSONATION', 'SCAM_OR_FRAUD', 'INAPPROPRIATE_CONTENT', 'OTHER')),
    reason TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'TRIAGED', 'ACTIONED', 'DISMISSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_no_self_report CHECK (reporter_user_id <> reported_user_id)
);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_reported
    ON moderation_reports (reported_user_id, status);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_category
    ON moderation_reports (category, status);

CREATE TABLE IF NOT EXISTS moderation_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    primary_category VARCHAR(32) NOT NULL,
    priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM'
        CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED')),
    assigned_admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution_note TEXT,
    sla_due_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_cases_status_prio
    ON moderation_cases (status, priority, sla_due_at);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_target
    ON moderation_cases (target_user_id);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_assignee
    ON moderation_cases (assigned_admin_id);

CREATE TABLE IF NOT EXISTS moderation_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES moderation_cases(id) ON DELETE SET NULL,
    target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action_type VARCHAR(32) NOT NULL
        CHECK (action_type IN ('WARN', 'RESTRICT', 'SUSPEND', 'BAN', 'REMOVE_CONTENT', 'CLEAR')),
    reason TEXT NOT NULL,
    duration_hours INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_target
    ON moderation_actions (target_user_id);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_admin
    ON moderation_actions (admin_user_id);

CREATE TABLE IF NOT EXISTS moderation_appeals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_id UUID REFERENCES moderation_actions(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_by_admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
    review_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_appeals_user
    ON moderation_appeals (user_id, status);

CREATE TABLE IF NOT EXISTS security_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role VARCHAR(32) NOT NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NOT NULL,
    target_id VARCHAR(128) NOT NULL,
    outcome VARCHAR(16) NOT NULL
        CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILURE')),
    reason TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    request_id VARCHAR(64),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
    ON security_audit_logs (actor_user_id, action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_time
    ON security_audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target
    ON security_audit_logs (target_type, target_id);

CREATE TABLE IF NOT EXISTS login_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email CITEXT NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    attempt_count INT NOT NULL DEFAULT 1,
    locked_until TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_login_attempt_key UNIQUE (email, ip_address)
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email_lock
    ON login_attempts (email, locked_until);
