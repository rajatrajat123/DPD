-- 000020_messaging_trial_and_global_quota.up.sql
-- 30-day trial: unlimited conversation chat, 4-profile Discovery initiation quota + rewarded ad unlock for next 4.
-- Post-trial: 2 outgoing messages across Discovery & chat + rewarded ad unlock for 2 additional messages.

ALTER TABLE discovery_message_quotas
    ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    ADD COLUMN IF NOT EXISTS trial_discovery_profile_ids TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS trial_discovery_allowed_count INT NOT NULL DEFAULT 4,
    ADD COLUMN IF NOT EXISTS trial_discovery_ads_watched INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS post_trial_outgoing_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS post_trial_ad_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS post_trial_bonus_outgoing_count INT NOT NULL DEFAULT 0;

-- Ensure existing development and test accounts receive an active 30-day trial from migration time
UPDATE discovery_message_quotas
SET trial_started_at = NOW(),
    trial_ends_at = NOW() + INTERVAL '30 days',
    trial_discovery_allowed_count = 4,
    trial_discovery_profile_ids = '{}'
WHERE trial_ends_at <= NOW();

CREATE INDEX IF NOT EXISTS idx_discovery_message_quotas_trial
    ON discovery_message_quotas (user_id, trial_ends_at);
