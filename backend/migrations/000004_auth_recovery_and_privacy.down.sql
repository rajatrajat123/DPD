-- 000004_auth_recovery_and_privacy.down.sql
-- Rollback account verification codes, password resets, and session family tracking.

DROP TABLE IF EXISTS password_resets;
DROP TABLE IF EXISTS account_verifications;

DROP INDEX IF EXISTS idx_user_sessions_family_id;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS family_id;
