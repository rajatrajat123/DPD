-- 000022_user_referral_rewards.up.sql
-- In-app user referral rewards and tracking

CREATE TABLE IF NOT EXISTS user_referral_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    partner_code VARCHAR(32) NOT NULL,
    verified_count INT NOT NULL DEFAULT 0,
    reward_tier INT NOT NULL DEFAULT 0,
    reward_status VARCHAR(24) NOT NULL DEFAULT 'NONE' CHECK (reward_status IN ('NONE', 'ACTIVE', 'EXPIRED')),
    activated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_referral_rewards_user ON user_referral_rewards (user_id);
CREATE INDEX IF NOT EXISTS idx_user_referral_rewards_code ON user_referral_rewards (partner_code);
