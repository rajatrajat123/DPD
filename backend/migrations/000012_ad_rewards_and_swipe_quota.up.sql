-- 000012_ad_rewards_and_swipe_quota.up.sql
-- AdMob SSV rewarded transactions with replay protection and daily quota bonus tracking.

CREATE TABLE IF NOT EXISTS ad_reward_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ad_network VARCHAR(32) NOT NULL DEFAULT 'ADMOB',
    transaction_id VARCHAR(128) NOT NULL,
    reward_item VARCHAR(32) NOT NULL DEFAULT 'LIKES',
    reward_amount INT NOT NULL DEFAULT 1,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ad_reward_tx UNIQUE (transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_reward_user_today
    ON ad_reward_transactions (user_id, verified_at);
