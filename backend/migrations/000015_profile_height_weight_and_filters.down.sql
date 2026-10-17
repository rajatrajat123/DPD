-- 000015_profile_height_weight_and_filters.down.sql
DROP TABLE IF EXISTS message_requests;

ALTER TABLE dating_preferences
    DROP COLUMN IF EXISTS min_height_cm,
    DROP COLUMN IF EXISTS max_height_cm,
    DROP COLUMN IF EXISTS min_weight_kg,
    DROP COLUMN IF EXISTS max_weight_kg,
    DROP COLUMN IF EXISTS preferred_orientations;

ALTER TABLE profiles
    DROP COLUMN IF EXISTS height_cm,
    DROP COLUMN IF EXISTS weight_kg;
