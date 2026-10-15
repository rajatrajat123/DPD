-- 000009_admin_moderation_audit_and_age_assurance.down.sql

DROP TABLE IF EXISTS login_attempts CASCADE;
DROP TABLE IF EXISTS security_audit_logs CASCADE;
DROP TABLE IF EXISTS moderation_appeals CASCADE;
DROP TABLE IF EXISTS moderation_actions CASCADE;
DROP TABLE IF EXISTS moderation_cases CASCADE;
DROP TABLE IF EXISTS moderation_reports CASCADE;
DROP TABLE IF EXISTS age_assurances CASCADE;
