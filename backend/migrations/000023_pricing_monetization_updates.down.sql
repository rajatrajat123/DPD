-- 000023_pricing_monetization_updates.down.sql
DROP TABLE IF EXISTS passport_verification_trials;
DROP TABLE IF EXISTS user_super_like_credits;
ALTER TABLE profile_boosts DROP COLUMN IF EXISTS max_radius_km;
ALTER TABLE profile_boosts DROP COLUMN IF EXISTS radius_miles;
