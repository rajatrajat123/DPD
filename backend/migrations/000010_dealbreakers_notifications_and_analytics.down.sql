-- 000010_dealbreakers_notifications_and_analytics.down.sql

DROP INDEX IF EXISTS idx_matches_created;
DROP INDEX IF EXISTS idx_swipes_created_actor;
DROP INDEX IF EXISTS idx_notification_dedup;
DROP INDEX IF EXISTS idx_user_push_tokens_active;

ALTER TABLE notification_logs
    DROP COLUMN IF EXISTS correlation_id,
    DROP COLUMN IF EXISTS event_id;

ALTER TABLE user_push_tokens
    DROP COLUMN IF EXISTS invalidated_at,
    DROP COLUMN IF EXISTS is_active;

ALTER TABLE dating_preferences
    DROP COLUMN IF EXISTS notification_preferences,
    DROP COLUMN IF EXISTS dealbreakers;

ALTER TABLE profiles
    DROP COLUMN IF EXISTS drinking_habit,
    DROP COLUMN IF EXISTS smoking_habit;
