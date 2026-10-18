-- 000020_messaging_trial_and_global_quota.down.sql

DROP INDEX IF EXISTS idx_discovery_message_quotas_trial;

ALTER TABLE discovery_message_quotas
    DROP COLUMN IF EXISTS trial_started_at,
    DROP COLUMN IF EXISTS trial_ends_at,
    DROP COLUMN IF EXISTS trial_discovery_profile_ids,
    DROP COLUMN IF EXISTS trial_discovery_allowed_count,
    DROP COLUMN IF EXISTS trial_discovery_ads_watched,
    DROP COLUMN IF EXISTS post_trial_outgoing_count,
    DROP COLUMN IF EXISTS post_trial_ad_unlocked,
    DROP COLUMN IF EXISTS post_trial_bonus_outgoing_count;
