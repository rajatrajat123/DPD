-- 000016_platform_config_likes_reveals_support.down.sql
DROP TABLE IF EXISTS support_ticket_messages;
DROP TABLE IF EXISTS support_tickets;
DROP TABLE IF EXISTS support_team_members;
DROP TABLE IF EXISTS support_teams;
DROP TABLE IF EXISTS user_likes_unlock_state;
DROP TABLE IF EXISTS likes_reveals;
DROP TABLE IF EXISTS platform_configurations;

ALTER TABLE dating_preferences
    DROP COLUMN IF EXISTS preferred_languages,
    DROP COLUMN IF EXISTS preferred_interests;

ALTER TABLE profiles
    DROP COLUMN IF EXISTS languages,
    DROP COLUMN IF EXISTS interests;

ALTER TABLE affiliate_commissions
    DROP COLUMN IF EXISTS rule_version;

ALTER TABLE commission_rules
    DROP COLUMN IF EXISTS affiliate_id,
    DROP COLUMN IF EXISTS country_code,
    DROP COLUMN IF EXISTS plan_code,
    DROP COLUMN IF EXISTS first_payment_only,
    DROP COLUMN IF EXISTS max_qualifying_renewals,
    DROP COLUMN IF EXISTS effective_from,
    DROP COLUMN IF EXISTS effective_until,
    DROP COLUMN IF EXISTS version,
    DROP COLUMN IF EXISTS is_active;
