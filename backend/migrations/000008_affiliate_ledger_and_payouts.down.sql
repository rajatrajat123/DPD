-- 000008_affiliate_ledger_and_payouts.down.sql
DROP TABLE IF EXISTS payout_batches CASCADE;
DROP TABLE IF EXISTS affiliate_commissions CASCADE;
DROP TABLE IF EXISTS referral_clicks CASCADE;
DROP TABLE IF EXISTS affiliate_campaigns CASCADE;
ALTER TABLE affiliates
    DROP COLUMN IF EXISTS minimum_payout_cents,
    DROP COLUMN IF EXISTS crypto_network,
    DROP COLUMN IF EXISTS crypto_asset,
    DROP COLUMN IF EXISTS crypto_wallet_address,
    DROP COLUMN IF EXISTS payout_method,
    DROP COLUMN IF EXISTS terms_version,
    DROP COLUMN IF EXISTS terms_accepted_at;
