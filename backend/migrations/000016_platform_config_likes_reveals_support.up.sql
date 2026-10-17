-- 000016_platform_config_likes_reveals_support.up.sql
-- Platform configuration, Likes You reveals, Customer Support operations, languages, interests, and commission rules extensions.

-- 1. Support & Affiliate Manager Roles
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('MEMBER', 'TRUST_AND_SAFETY', 'FINANCE_ADMIN', 'EDITORIAL_CMS', 'CUSTOMER_SUPPORT', 'AFFILIATE_MANAGER', 'SUPER_ADMIN'));

-- 2. Profiles and Preferences: Languages and Interests
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS languages VARCHAR(32)[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS interests VARCHAR(64)[] NOT NULL DEFAULT '{}';

ALTER TABLE dating_preferences
    ADD COLUMN IF NOT EXISTS preferred_languages VARCHAR(32)[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS preferred_interests VARCHAR(64)[] NOT NULL DEFAULT '{}';

-- 3. Platform Dynamic Configurations (Super Admin business rules)
CREATE TABLE IF NOT EXISTS platform_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key VARCHAR(64) UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_configurations_key ON platform_configurations (config_key);

-- Seed Initial System Business Rules
INSERT INTO platform_configurations (config_key, config_value, description)
VALUES
('advertising', '{"swipe_feed_ad_interval": 11, "rewarded_ad_enabled": true, "banner_enabled": true, "ad_frequency_cap_hourly": 6}'::jsonb, 'Advertising frequency caps and native card intervals'),
('likes_reveals', '{"free_reveals_count": 1, "reveals_per_ad": 2, "cooldown_hours": 4, "daily_reveal_limit": 10, "premium_unlimited": true}'::jsonb, 'Likes You blurred reveals, rewarded ad unlock quotas and cooldowns'),
('boost_config', '{"price_cents": 500, "duration_minutes": 60, "max_radius_km": 200, "multiplier": 2.5, "is_active": true}'::jsonb, 'Profile Boost pricing, duration in minutes, and radius cap'),
('affiliate_config', '{"mode": "REVSHARE_PERCENT", "default_cpa_cents": 3500, "default_revshare_bps": 2500, "minimum_payout_cents": 5000, "manual_approval_required": true, "first_payment_only": false, "max_qualifying_renewals": 12, "escrow_hold_days": 30}'::jsonb, 'Affiliate commission calculation mode (REVSHARE_PERCENT or CPA_FIXED) and payout rules'),
('support_routing', '{"default_strategy": "WORKLOAD", "auto_assign": true, "escalation_hours": 24}'::jsonb, 'Customer support routing rules and auto-assignment configuration'),
('country_settings', '{"supported_countries": ["US", "CA", "GB", "DE", "FR", "ES", "NL", "AU", "NZ", "BR", "MX", "IN"], "restricted_countries": ["AE", "SA", "QA"], "default_currency": "USD"}'::jsonb, 'Country-specific feature availability and supported currencies')
ON CONFLICT (config_key) DO NOTHING;

-- 4. Likes You Reveals & Unlock Tracking
CREATE TABLE IF NOT EXISTS likes_reveals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liked_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source VARCHAR(32) NOT NULL CHECK (source IN ('FREE', 'REWARDED_AD', 'PREMIUM')),
    revealed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_revealed_like UNIQUE (user_id, liked_by_user_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_reveals_user ON likes_reveals (user_id, revealed_at DESC);

CREATE TABLE IF NOT EXISTS user_likes_unlock_state (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    free_reveals_used INT NOT NULL DEFAULT 0,
    ad_reveals_today INT NOT NULL DEFAULT 0,
    bonus_reveals_remaining INT NOT NULL DEFAULT 0,
    last_ad_reveal_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Customer Support Operations (Teams, Agents, Tickets, Messages)
CREATE TABLE IF NOT EXISTS support_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    routing_rule VARCHAR(32) NOT NULL DEFAULT 'WORKLOAD' CHECK (routing_rule IN ('ROUND_ROBIN', 'WORKLOAD')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_team_members (
    team_id UUID NOT NULL REFERENCES support_teams(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    current_workload INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (team_id, agent_id)
);

CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(32) UNIQUE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    guest_email VARCHAR(255),
    guest_name VARCHAR(120),
    subject VARCHAR(255) NOT NULL,
    category VARCHAR(32) NOT NULL
        CHECK (category IN ('PAYMENT', 'SUBSCRIPTION', 'ACCOUNT', 'TECHNICAL', 'AFFILIATE', 'SAFETY', 'GENERAL')),
    priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM'
        CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    status VARCHAR(24) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED')),
    assigned_team_id UUID REFERENCES support_teams(id) ON DELETE SET NULL,
    assigned_agent_id UUID REFERENCES users(id) ON DELETE SET NULL,
    internal_notes TEXT NOT NULL DEFAULT '',
    escalation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_prio ON support_tickets (status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assignee ON support_tickets (assigned_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_team ON support_tickets (assigned_team_id, status);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    sender_name VARCHAR(120) NOT NULL DEFAULT '',
    is_staff BOOLEAN NOT NULL DEFAULT FALSE,
    is_internal_note BOOLEAN NOT NULL DEFAULT FALSE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket ON support_ticket_messages (ticket_id, created_at ASC);

-- 6. Commission Rules Extensions
ALTER TABLE commission_rules
    ADD COLUMN IF NOT EXISTS affiliate_id UUID REFERENCES affiliates(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS country_code CHAR(2),
    ADD COLUMN IF NOT EXISTS plan_code VARCHAR(32),
    ADD COLUMN IF NOT EXISTS first_payment_only BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS max_qualifying_renewals INT NOT NULL DEFAULT 12,
    ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS effective_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE affiliate_commissions
    ADD COLUMN IF NOT EXISTS rule_version INT NOT NULL DEFAULT 1;
