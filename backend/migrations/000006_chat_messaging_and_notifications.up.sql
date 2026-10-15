-- 000006_chat_messaging_and_notifications.up.sql
-- Chat media attachments, push tokens, and notification dispatch logs.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_asset_id UUID REFERENCES media_assets(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(24) NOT NULL DEFAULT 'TEXT'
    CHECK (message_type IN ('TEXT', 'IMAGE', 'VIDEO', 'SYSTEM'));

CREATE TABLE IF NOT EXISTS user_push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform VARCHAR(16) NOT NULL CHECK (platform IN ('WEB', 'IOS', 'ANDROID')),
    device_id VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_device_token UNIQUE (user_id, token)
);

CREATE TABLE IF NOT EXISTS notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(64) NOT NULL,
    channel VARCHAR(24) NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL', 'WEB_PUSH', 'MOBILE_PUSH')),
    title TEXT NOT NULL,
    body_preview TEXT NOT NULL,
    status VARCHAR(24) NOT NULL CHECK (status IN ('QUEUED', 'DELIVERED', 'FAILED', 'SUPPRESSED')),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_id
    ON messages (conversation_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_match_id
    ON conversations (match_id);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user
    ON user_push_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_notification_logs_user_sent
    ON notification_logs (user_id, sent_at DESC);
