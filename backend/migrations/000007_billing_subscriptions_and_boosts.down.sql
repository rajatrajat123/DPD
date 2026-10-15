-- 000007_billing_subscriptions_and_boosts.down.sql
DROP INDEX IF EXISTS idx_payment_transactions_user;
DROP INDEX IF EXISTS idx_subscriptions_user_status;
DROP TABLE IF EXISTS profile_boosts CASCADE;
DROP TABLE IF EXISTS user_boost_credits CASCADE;
DROP TABLE IF EXISTS billing_products CASCADE;
