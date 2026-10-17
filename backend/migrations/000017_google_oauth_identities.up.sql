-- 000017_google_oauth_identities.up.sql
-- Persistent identity mapping for Google Sign-In and OAuth providers

CREATE TABLE IF NOT EXISTS user_oauth_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    email CITEXT NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_oauth_provider_subject UNIQUE (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_oauth_user_provider
    ON user_oauth_identities (user_id, provider);

CREATE INDEX IF NOT EXISTS idx_oauth_email
    ON user_oauth_identities (email);
