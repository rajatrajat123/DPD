-- 000013_media_asset_display_order.up.sql
-- Add display_order column to media_assets for deterministic photo gallery ordering.

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_media_assets_owner_order
    ON media_assets (owner_user_id, display_order ASC, created_at DESC)
    WHERE status <> 'PURGED';
