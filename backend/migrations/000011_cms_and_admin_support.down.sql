-- 000011_cms_and_admin_support.down.sql
-- Migration 000011 rollback

DROP TABLE IF EXISTS cms_audit_trail CASCADE;
DROP TABLE IF EXISTS cms_media_assets CASCADE;
DROP TABLE IF EXISTS cms_content_versions CASCADE;
DROP TABLE IF EXISTS cms_content_items CASCADE;
