-- 000006_chat_messaging_and_notifications.down.sql

DROP TABLE IF EXISTS notification_logs CASCADE;
DROP TABLE IF EXISTS user_push_tokens CASCADE;
ALTER TABLE messages DROP COLUMN IF EXISTS message_type;
ALTER TABLE messages DROP COLUMN IF EXISTS media_asset_id;
