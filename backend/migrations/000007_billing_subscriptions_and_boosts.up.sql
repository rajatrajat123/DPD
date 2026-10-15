-- 000007_billing_subscriptions_and_boosts.up.sql
-- Product catalog, user boost credits, and active profile boost boosts.

CREATE TABLE IF NOT EXISTS billing_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_code VARCHAR(32) UNIQUE NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    product_type VARCHAR(32) NOT NULL CHECK (product_type IN ('SUBSCRIPTION', 'CONSUMABLE')),
    tier VARCHAR(32) NOT NULL DEFAULT 'FREE',
    billing_period VARCHAR(32) NOT NULL DEFAULT 'NONE' CHECK (billing_period IN ('MONTHLY', 'ANNUAL', 'NONE')),
    price_cents BIGINT NOT NULL CHECK (price_cents >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    entitlements JSONB NOT NULL DEFAULT '[]',
    boost_credits INT NOT NULL DEFAULT 0 CHECK (boost_credits >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_products_active ON billing_products (is_active, product_type);

CREATE TABLE IF NOT EXISTS user_boost_credits (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    credits_remaining INT NOT NULL DEFAULT 0 CHECK (credits_remaining >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profile_boosts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    duration_minutes INT NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
    multiplier NUMERIC(3, 1) NOT NULL DEFAULT 2.5 CHECK (multiplier >= 1.0),
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_profile_boosts_active
    ON profile_boosts (user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
    ON subscriptions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user
    ON payment_transactions (user_id, occurred_at DESC);

-- Seed authoritative billing catalog
INSERT INTO billing_products (plan_code, name, description, product_type, tier, billing_period, price_cents, currency, entitlements, boost_credits, is_active)
VALUES
    ('AURA_PLUS_MONTHLY', 'Aura Plus (Monthly)', 'Unlimited swipes, see who liked you, rewind last swipe, and travel passport.', 'SUBSCRIPTION', 'PLUS', 'MONTHLY', 1999, 'USD', '["UNLIMITED_SWIPES", "SEE_WHO_LIKED_YOU", "REWIND", "TRAVEL_MODE"]'::jsonb, 1, TRUE),
    ('AURA_PLUS_ANNUAL', 'Aura Plus (Annual)', 'Save 50% with annual Aura Plus billing. Includes 1 free boost per month.', 'SUBSCRIPTION', 'PLUS', 'ANNUAL', 11988, 'USD', '["UNLIMITED_SWIPES", "SEE_WHO_LIKED_YOU", "REWIND", "TRAVEL_MODE"]'::jsonb, 12, TRUE),
    ('AURA_BLACK_MONTHLY', 'Aura Black (Monthly)', 'VIP features: read receipts, incognito browsing, priority likes, and all Plus benefits.', 'SUBSCRIPTION', 'BLACK', 'MONTHLY', 3499, 'USD', '["UNLIMITED_SWIPES", "SEE_WHO_LIKED_YOU", "REWIND", "TRAVEL_MODE", "READ_RECEIPTS", "PRIORITY_LIKES", "INCOGNITO_BROWSING"]'::jsonb, 3, TRUE),
    ('AURA_BLACK_ANNUAL', 'Aura Black (Annual)', 'VIP annual membership with 36 boost credits and priority ranking in discovery.', 'SUBSCRIPTION', 'BLACK', 'ANNUAL', 20988, 'USD', '["UNLIMITED_SWIPES", "SEE_WHO_LIKED_YOU", "REWIND", "TRAVEL_MODE", "READ_RECEIPTS", "PRIORITY_LIKES", "INCOGNITO_BROWSING"]'::jsonb, 36, TRUE),
    ('BOOST_SINGLE', 'Single Profile Boost', '30-minute 2.5x profile visibility boost in local discovery.', 'CONSUMABLE', 'CONSUMABLE', 'NONE', 499, 'USD', '[]'::jsonb, 1, TRUE),
    ('BOOST_5PACK', '5-Pack Profile Boosts', 'Bundle of five 30-minute profile visibility boosts.', 'CONSUMABLE', 'CONSUMABLE', 'NONE', 1799, 'USD', '[]'::jsonb, 5, TRUE),
    ('SUPERSPARK_5PACK', '5-Pack Super Sparks', 'Send 5 high-intent sparks with instant personalized direct messaging.', 'CONSUMABLE', 'CONSUMABLE', 'NONE', 999, 'USD', '["SUPER_SPARK"]'::jsonb, 0, TRUE)
ON CONFLICT (plan_code) DO NOTHING;
