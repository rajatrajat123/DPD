-- 000008_affiliate_ledger_and_payouts.up.sql
-- Affiliate clicks, campaigns, commissions, payout orchestration, and terms acceptance.

ALTER TABLE affiliates
    ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS terms_version VARCHAR(32) DEFAULT '1.0',
    ADD COLUMN IF NOT EXISTS payout_method VARCHAR(32) DEFAULT 'STRIPE_CONNECT',
    ADD COLUMN IF NOT EXISTS crypto_wallet_address VARCHAR(128),
    ADD COLUMN IF NOT EXISTS crypto_asset VARCHAR(16) DEFAULT 'USDC',
    ADD COLUMN IF NOT EXISTS crypto_network VARCHAR(32) DEFAULT 'POLYGON',
    ADD COLUMN IF NOT EXISTS minimum_payout_cents BIGINT NOT NULL DEFAULT 5000;

CREATE TABLE IF NOT EXISTS affiliate_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
    campaign_slug VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    destination_url TEXT NOT NULL DEFAULT 'https://auradating.com',
    clicks_count BIGINT NOT NULL DEFAULT 0,
    conversions_count BIGINT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_affiliate_campaign UNIQUE (affiliate_id, campaign_slug)
);

CREATE TABLE IF NOT EXISTS referral_clicks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
    partner_code VARCHAR(32) NOT NULL,
    campaign_slug VARCHAR(64),
    click_token VARCHAR(128) UNIQUE NOT NULL,
    ip_hash VARCHAR(64) NOT NULL,
    user_agent_hash VARCHAR(64),
    landing_url TEXT NOT NULL,
    clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_clicks_partner ON referral_clicks (partner_code, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_token ON referral_clicks (click_token);

CREATE TABLE IF NOT EXISTS affiliate_commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT,
    transaction_id UUID NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
    referred_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    rule_snapshot JSONB NOT NULL,
    gross_amount_cents BIGINT NOT NULL,
    commission_amount_cents BIGINT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    billing_cycle_index INT NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_CLEARANCE'
        CHECK (status IN ('PENDING_CLEARANCE', 'APPROVED', 'MATURED', 'PAID', 'CLAWED_BACK')),
    matures_at TIMESTAMPTZ NOT NULL,
    journal_id UUID REFERENCES ledger_journals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_affiliate_transaction_commission UNIQUE (affiliate_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_affiliate_status
    ON affiliate_commissions (affiliate_id, status, matures_at);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_matures
    ON affiliate_commissions (status, matures_at) WHERE status = 'PENDING_CLEARANCE';

CREATE TABLE IF NOT EXISTS payout_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    payout_method VARCHAR(32) NOT NULL CHECK (payout_method IN ('STRIPE_CONNECT', 'CRYPTO')),
    destination_reference VARCHAR(128) NOT NULL,
    crypto_asset VARCHAR(16) DEFAULT 'NONE',
    crypto_network VARCHAR(32) DEFAULT 'NONE',
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_APPROVAL'
        CHECK (status IN ('PENDING_APPROVAL', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED')),
    external_payout_id VARCHAR(128),
    failure_reason TEXT,
    journal_id UUID REFERENCES ledger_journals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payout_batches_affiliate ON payout_batches (affiliate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_batches_status ON payout_batches (status);

-- Seed authoritative commission rules
INSERT INTO commission_rules (name, affiliate_tier, model, cpa_amount_cents, revshare_bps, recurring_enabled, max_recurring_months, escrow_hold_days)
VALUES
    ('Standard RevShare (25%)', 'STANDARD', 'REVSHARE_PERCENT', 0, 2500, TRUE, 12, 30),
    ('VIP Hybrid ($15 CPA + 30% RevShare)', 'VIP', 'HYBRID', 1500, 3000, TRUE, 24, 14),
    ('CPA Bounty ($35 Fixed)', 'CPA_ONLY', 'CPA_FIXED', 3500, 0, FALSE, 0, 30)
ON CONFLICT (affiliate_tier) DO NOTHING;
