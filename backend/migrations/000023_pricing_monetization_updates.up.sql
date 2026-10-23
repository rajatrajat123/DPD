-- 000023_pricing_monetization_updates.up.sql
-- Aura pricing updates, Super Like credits, boost radius, and passport verification trial.

-- 1. Add radius columns to profile_boosts if not present
ALTER TABLE profile_boosts ADD COLUMN IF NOT EXISTS radius_miles NUMERIC(6, 2) NOT NULL DEFAULT 160.0;
ALTER TABLE profile_boosts ADD COLUMN IF NOT EXISTS max_radius_km NUMERIC(6, 2) NOT NULL DEFAULT 257.5;

-- 2. User Super Like credits table
CREATE TABLE IF NOT EXISTS user_super_like_credits (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    credits_remaining INT NOT NULL DEFAULT 0 CHECK (credits_remaining >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Passport verification 7-day free trial table
CREATE TABLE IF NOT EXISTS passport_verification_trials (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    trial_used BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_passport_trials_ends_at ON passport_verification_trials (ends_at);

-- 4. Deactivate legacy $19 tier product without deleting historical records
UPDATE billing_products
SET is_active = FALSE,
    updated_at = NOW()
WHERE plan_code = 'AURA_PLUS_MONTHLY' AND price_cents = 1999;

-- 5. Upsert active catalog products with updated pricing:
-- Aura Plus Monthly: $25.00 (2500 cents)
-- Aura Plus Annual: $200.00 (20000 cents)
-- Aura Extra Premium Monthly: $34.99 (3499 cents)
-- Aura Extra Premium Annual: $300.00 (30000 cents)
-- Profile Boost Single: $7.99 (799 cents)
-- 5-Pack Super Likes: $4.99 (499 cents)

INSERT INTO billing_products (plan_code, name, description, product_type, tier, billing_period, price_cents, currency, entitlements, boost_credits, is_active)
VALUES
    ('AURA_PLUS_MONTHLY', 'Aura Plus (Monthly)', 'Unlimited swipes, see who liked you, rewind, and travel passport mode.', 'SUBSCRIPTION', 'PLUS', 'MONTHLY', 2500, 'USD', '["UNLIMITED_SWIPES", "SEE_WHO_LIKED_YOU", "REWIND", "TRAVEL_MODE"]'::jsonb, 1, TRUE),
    ('AURA_PLUS_ANNUAL', 'Aura Plus (Annual)', 'Save on annual Aura Plus billing ($200/year). Includes 1 free boost per month.', 'SUBSCRIPTION', 'PLUS', 'ANNUAL', 20000, 'USD', '["UNLIMITED_SWIPES", "SEE_WHO_LIKED_YOU", "REWIND", "TRAVEL_MODE"]'::jsonb, 12, TRUE),
    ('AURA_BLACK_MONTHLY', 'Aura Extra Premium (Monthly)', 'VIP features: read receipts, incognito browsing, priority likes, and all Plus benefits.', 'SUBSCRIPTION', 'BLACK', 'MONTHLY', 3499, 'USD', '["UNLIMITED_SWIPES", "SEE_WHO_LIKED_YOU", "REWIND", "TRAVEL_MODE", "READ_RECEIPTS", "PRIORITY_LIKES", "INCOGNITO_BROWSING"]'::jsonb, 3, TRUE),
    ('AURA_BLACK_ANNUAL', 'Aura Extra Premium (Annual)', 'VIP annual membership ($300/year) with 36 boost credits and priority ranking in discovery.', 'SUBSCRIPTION', 'BLACK', 'ANNUAL', 30000, 'USD', '["UNLIMITED_SWIPES", "SEE_WHO_LIKED_YOU", "REWIND", "TRAVEL_MODE", "READ_RECEIPTS", "PRIORITY_LIKES", "INCOGNITO_BROWSING"]'::jsonb, 36, TRUE),
    ('BOOST_SINGLE', 'Single Profile Boost', '60-minute 5x profile visibility boost in local discovery up to 160 miles (257.5 km).', 'CONSUMABLE', 'CONSUMABLE', 'NONE', 799, 'USD', '[]'::jsonb, 1, TRUE),
    ('BOOST_5PACK', '5-Pack Profile Boosts', 'Bundle of five 60-minute 5x profile visibility boosts.', 'CONSUMABLE', 'CONSUMABLE', 'NONE', 2999, 'USD', '[]'::jsonb, 5, TRUE),
    ('SUPERSPARK_5PACK', '5-Pack Super Likes', 'Pack of 5 priority Super Likes with instant profile highlighting and mutual match priority.', 'CONSUMABLE', 'CONSUMABLE', 'NONE', 499, 'USD', '["SUPER_SPARK"]'::jsonb, 0, TRUE)
ON CONFLICT (plan_code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price_cents = EXCLUDED.price_cents,
    currency = EXCLUDED.currency,
    entitlements = EXCLUDED.entitlements,
    boost_credits = EXCLUDED.boost_credits,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();
