-- 000010_dealbreakers_notifications_and_analytics.up.sql
-- Lifestyle habits, dealbreakers, notification preferences, push token status, and event deduplication.

-- 1. Profiles: Lifestyle habits for compatibility & dealbreaker filtering
ALTER TABLE profiles 
    ADD COLUMN IF NOT EXISTS smoking_habit VARCHAR(32) NOT NULL DEFAULT 'NON_SMOKER'
        CHECK (smoking_habit IN ('NON_SMOKER', 'SOCIAL_SMOKER', 'REGULAR_SMOKER', 'CANNABIS_ONLY', 'PREFER_NOT_TO_SAY')),
    ADD COLUMN IF NOT EXISTS drinking_habit VARCHAR(32) NOT NULL DEFAULT 'SOCIALLY'
        CHECK (drinking_habit IN ('NEVER', 'SOCIALLY', 'FREQUENTLY', 'SOBER', 'PREFER_NOT_TO_SAY'));

-- 2. Dating Preferences: Strict dealbreakers and notification preferences
ALTER TABLE dating_preferences
    ADD COLUMN IF NOT EXISTS dealbreakers JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{"matches":true,"messages":true,"discovery_updates":false,"billing":true,"security":true,"quiet_hours_enabled":false,"quiet_hours_start":22,"quiet_hours_end":8}';

-- 3. Push Tokens: Active status and invalidation tracking for provider feedback
ALTER TABLE user_push_tokens
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_active
    ON user_push_tokens (user_id, is_active);

-- 4. Notification Logs: Event ID for deduplication and delivery loops prevention
ALTER TABLE notification_logs
    ADD COLUMN IF NOT EXISTS event_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_dedup
    ON notification_logs (user_id, event_id)
    WHERE event_id IS NOT NULL;

-- 5. Analytics query support indexes
CREATE INDEX IF NOT EXISTS idx_swipes_created_actor
    ON swipes (created_at, actor_user_id);

CREATE INDEX IF NOT EXISTS idx_matches_created
    ON matches (matched_at);
