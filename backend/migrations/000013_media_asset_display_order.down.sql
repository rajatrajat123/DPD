-- 000013_media_asset_display_order.down.sql
DROP INDEX IF EXISTS idx_media_assets_owner_order;
ALTER TABLE media_assets DROP COLUMN IF EXISTS display_order;
