-- 000019_discovery_messaging_quota.up.sql
-- Discovery profile messaging quota: 2 distinct profiles, 10-minute cooldown, rewarded ad unlock for 2 bonus slots.

CREATE TABLE IF NOT EXISTS discovery_message_quotas (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    cycle_start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    free_profile_ids TEXT[] NOT NULL DEFAULT '{}',
    cooldown_expires_at TIMESTAMPTZ,
    ad_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
    bonus_profile_ids TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_message_quotas_cooldown
    ON discovery_message_quotas (user_id, cooldown_expires_at);
