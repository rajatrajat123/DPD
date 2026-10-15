-- 000003_media_billing_and_affiliate_ledger.down.sql
DROP INDEX IF EXISTS idx_ledger_entries_journal;
DROP INDEX IF EXISTS idx_ledger_entries_account;
DROP TABLE IF EXISTS ledger_entries;
DROP TABLE IF EXISTS ledger_journals;
DROP TABLE IF EXISTS ledger_accounts;
DROP TABLE IF EXISTS referral_attributions;
DROP TABLE IF EXISTS commission_rules;
DROP TABLE IF EXISTS affiliates;
DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS payment_transactions;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS media_derivatives;
DROP INDEX IF EXISTS idx_media_assets_owner_ready;
DROP TABLE IF EXISTS media_assets;
