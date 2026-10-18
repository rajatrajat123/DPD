-- 000021_user_favourites.up.sql
-- Authenticated user favourites persistence with deduplication and ownership guarantees

CREATE TABLE IF NOT EXISTS user_favourites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_favourite UNIQUE (user_id, target_user_id),
    CONSTRAINT chk_no_self_favourite CHECK (user_id <> target_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favourites_user_created 
    ON user_favourites (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_favourites_target 
    ON user_favourites (target_user_id);
