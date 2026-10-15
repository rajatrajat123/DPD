-- 000002_identity_profiles_and_postgis.up.sql
-- Core identity, LGBTQ+ profile taxonomy, PostGIS geospatial locations, matching, and messaging tables.

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email CITEXT UNIQUE NOT NULL,
    phone_e164 VARCHAR(20) UNIQUE,
    password_hash TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'BANNED', 'DEACTIVATED', 'DELETED')),
    role VARCHAR(32) NOT NULL DEFAULT 'MEMBER'
        CHECK (role IN ('MEMBER', 'TRUST_AND_SAFETY', 'FINANCE_ADMIN', 'EDITORIAL_CMS', 'SUPER_ADMIN')),
    email_verified_at TIMESTAMPTZ,
    phone_verified_at TIMESTAMPTZ,
    last_active_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash BYTEA UNIQUE NOT NULL,
    device_fingerprint VARCHAR(128),
    user_agent TEXT,
    ip_address INET,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id);

CREATE TABLE IF NOT EXISTS profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(64) NOT NULL,
    birthdate DATE NOT NULL
        CHECK (birthdate <= (CURRENT_DATE - INTERVAL '18 years')),
    bio TEXT,
    pronouns VARCHAR(64)[] NOT NULL DEFAULT '{}',
    gender_identities VARCHAR(64)[] NOT NULL,
    sexual_orientations VARCHAR(64)[] NOT NULL,
    relationship_intents VARCHAR(64)[] NOT NULL,
    relationship_structure VARCHAR(32)
        CHECK (relationship_structure IN ('MONOGAMOUS', 'ENM', 'POLYAMOROUS', 'OPEN', 'EXPLORING')),
    visibility_settings JSONB NOT NULL DEFAULT '{}',
    is_photo_verified BOOLEAN NOT NULL DEFAULT FALSE,
    discrete_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    incognito_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profile_locations (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    coordinates GEOGRAPHY(Point, 4326) NOT NULL,
    passport_coordinates GEOGRAPHY(Point, 4326),
    city_name VARCHAR(120),
    country_code CHAR(2) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_locations_geog
    ON profile_locations USING GIST (coordinates);

CREATE TABLE IF NOT EXISTS dating_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    min_age SMALLINT NOT NULL DEFAULT 18 CHECK (min_age >= 18),
    max_age SMALLINT NOT NULL DEFAULT 99 CHECK (max_age >= min_age),
    max_distance_km SMALLINT NOT NULL DEFAULT 50 CHECK (max_distance_km BETWEEN 1 AND 500),
    preferred_genders VARCHAR(64)[] NOT NULL DEFAULT '{}',
    preferred_intents VARCHAR(64)[] NOT NULL DEFAULT '{}',
    verified_profiles_only BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS swipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    direction VARCHAR(16) NOT NULL CHECK (direction IN ('LIKE', 'PASS', 'SUPER_SPARK')),
    intro_note TEXT,
    undone_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_swipe_pair UNIQUE (actor_user_id, target_user_id),
    CONSTRAINT chk_no_self_swipe CHECK (actor_user_id <> target_user_id)
);

CREATE INDEX IF NOT EXISTS idx_swipes_target_actor
    ON swipes (target_user_id, actor_user_id)
    WHERE direction IN ('LIKE', 'SUPER_SPARK') AND undone_at IS NULL;

CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_low_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_high_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'UNMATCHED', 'BLOCKED')),
    matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unmatched_at TIMESTAMPTZ,
    CONSTRAINT chk_ordered_match_pair CHECK (user_low_id < user_high_id),
    CONSTRAINT uq_match_pair UNIQUE (user_low_id, user_high_id)
);

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID UNIQUE NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    last_message_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_message_id UUID NOT NULL,
    body TEXT,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sender_client_msg UNIQUE (sender_user_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
    ON messages (conversation_id, created_at DESC);
