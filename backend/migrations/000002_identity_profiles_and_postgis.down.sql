-- 000002_identity_profiles_and_postgis.down.sql
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS swipes;
DROP TABLE IF EXISTS dating_preferences;
DROP INDEX IF EXISTS idx_profile_locations_geog;
DROP TABLE IF EXISTS profile_locations;
DROP TABLE IF EXISTS profiles;
DROP INDEX IF EXISTS idx_user_sessions_user_id;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS users;
