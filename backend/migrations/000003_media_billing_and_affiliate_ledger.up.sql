-- 000003_media_billing_and_affiliate_ledger.up.sql
-- Mandatory media processing pipeline tables, omni-channel billing, affiliate attribution, and double-entry ledger.

CREATE TABLE IF NOT EXISTS media_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type VARCHAR(16) NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO', 'VOICE_NOTE')),
    purpose VARCHAR(32) NOT NULL CHECK (purpose IN ('PROFILE_GALLERY', 'SELFIE_VERIFICATION', 'CHAT_ATTACHMENT')),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_UPLOAD'
        CHECK (status IN ('PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'MODERATION_PENDING', 'READY', 'REJECTED', 'FAILED', 'PURGED')),
    quarantine_bucket VARCHAR(128) NOT NULL,
    quarantine_key TEXT NOT NULL,
    original_sha256 VARCHAR(64),
    original_mime VARCHAR(64),
    original_size_bytes BIGINT CHECK (original_size_bytes > 0),
    width_px INT CHECK (width_px > 0),
    height_px INT CHECK (height_px > 0),
    duration_ms INT CHECK (duration_ms >= 0),
    exif_stripped BOOLEAN NOT NULL DEFAULT FALSE,
    moderation_verdict VARCHAR(32)
        CHECK (moderation_verdict IN ('APPROVED', 'REJECTED_NSFW', 'REJECTED_CSAM', 'MANUAL_REVIEW')),
    original_purge_after TIMESTAMPTZ,
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_owner_ready
    ON media_assets (owner_user_id, purpose)
    WHERE status = 'READY' AND moderation_verdict = 'APPROVED';

CREATE TABLE IF NOT EXISTS media_derivatives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    variant VARCHAR(32) NOT NULL
        CHECK (variant IN ('THUMB_WEBP', 'CARD_WEBP', 'FULL_WEBP', 'CARD_AVIF', 'FULL_AVIF', 'HLS_480P', 'HLS_720P', 'HLS_1080P', 'MP4_720P', 'VIDEO_POSTER')),
    storage_bucket VARCHAR(128) NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type VARCHAR(64) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    width_px INT,
    height_px INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_media_derivative_variant UNIQUE (media_asset_id, variant)
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_code VARCHAR(32) NOT NULL,
    provider VARCHAR(24) NOT NULL CHECK (provider IN ('STRIPE', 'APPLE_APP_STORE', 'GOOGLE_PLAY')),
    external_subscription_id VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL
        CHECK (status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELED', 'EXPIRED', 'REFUNDED', 'CHARGEBACK')),
    currency CHAR(3) NOT NULL,
    price_cents BIGINT NOT NULL CHECK (price_cents >= 0),
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_provider_subscription UNIQUE (provider, external_subscription_id)
);

CREATE TABLE IF NOT EXISTS payment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    provider VARCHAR(24) NOT NULL CHECK (provider IN ('STRIPE', 'APPLE_APP_STORE', 'GOOGLE_PLAY')),
    external_charge_id VARCHAR(128) NOT NULL,
    transaction_type VARCHAR(24) NOT NULL
        CHECK (transaction_type IN ('INITIAL_PURCHASE', 'RENEWAL', 'BOOST_PURCHASE', 'REFUND', 'CHARGEBACK')),
    gross_amount_cents BIGINT NOT NULL,
    provider_fee_cents BIGINT NOT NULL DEFAULT 0,
    tax_amount_cents BIGINT NOT NULL DEFAULT 0,
    net_amount_cents BIGINT NOT NULL,
    currency CHAR(3) NOT NULL,
    billing_cycle_index INT NOT NULL DEFAULT 1 CHECK (billing_cycle_index >= 1),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_provider_charge UNIQUE (provider, external_charge_id)
);

CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(24) NOT NULL,
    external_event_id VARCHAR(128) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_webhook_provider_event UNIQUE (provider, external_event_id)
);

CREATE TABLE IF NOT EXISTS affiliates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    partner_code VARCHAR(32) UNIQUE NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING_APPROVAL'
        CHECK (status IN ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'TERMINATED')),
    tier VARCHAR(24) NOT NULL DEFAULT 'STANDARD',
    payout_currency CHAR(3) NOT NULL DEFAULT 'USD',
    stripe_connect_account_id VARCHAR(128),
    tax_form_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commission_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    affiliate_tier VARCHAR(24) UNIQUE,
    model VARCHAR(24) NOT NULL CHECK (model IN ('CPA_FIXED', 'REVSHARE_PERCENT', 'HYBRID')),
    cpa_amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (cpa_amount_cents >= 0),
    revshare_bps INT NOT NULL DEFAULT 0 CHECK (revshare_bps BETWEEN 0 AND 10000),
    recurring_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    max_recurring_months SMALLINT NOT NULL DEFAULT 12 CHECK (max_recurring_months >= 0),
    escrow_hold_days SMALLINT NOT NULL DEFAULT 30 CHECK (escrow_hold_days >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_attributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referred_user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT,
    partner_code VARCHAR(32) NOT NULL,
    sub_campaign VARCHAR(64),
    attributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code VARCHAR(64) UNIQUE NOT NULL,
    account_type VARCHAR(24) NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE')),
    affiliate_id UUID REFERENCES affiliates(id) ON DELETE RESTRICT,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    balance_cents BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_journals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_type VARCHAR(32) NOT NULL
        CHECK (reference_type IN ('COMMISSION_ACCRUAL', 'ESCROW_MATURATION', 'REFUND_CLAWBACK', 'PAYOUT_SETTLEMENT')),
    reference_id UUID NOT NULL,
    description TEXT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ledger_journal_ref UNIQUE (reference_type, reference_id)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_id UUID NOT NULL REFERENCES ledger_journals(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
    direction VARCHAR(8) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries (account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_journal ON ledger_entries (journal_id);
