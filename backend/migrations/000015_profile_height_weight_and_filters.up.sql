-- 000015_profile_height_weight_and_filters.up.sql
-- Height, weight, advanced discovery filters, and message requests.

-- 1. Profiles: Height and Weight (Metric stored: cm and kg)
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS height_cm INT CHECK (height_cm IS NULL OR (height_cm >= 90 AND height_cm <= 250)),
    ADD COLUMN IF NOT EXISTS weight_kg INT CHECK (weight_kg IS NULL OR (weight_kg >= 30 AND weight_kg <= 300));

-- 2. Dating Preferences: Height, Weight, and Sexual Orientation preferences
ALTER TABLE dating_preferences
    ADD COLUMN IF NOT EXISTS min_height_cm INT CHECK (min_height_cm IS NULL OR (min_height_cm >= 90 AND min_height_cm <= 250)),
    ADD COLUMN IF NOT EXISTS max_height_cm INT CHECK (max_height_cm IS NULL OR (max_height_cm >= 90 AND max_height_cm <= 250)),
    ADD COLUMN IF NOT EXISTS min_weight_kg INT CHECK (min_weight_kg IS NULL OR (min_weight_kg >= 30 AND min_weight_kg <= 300)),
    ADD COLUMN IF NOT EXISTS max_weight_kg INT CHECK (max_weight_kg IS NULL OR (max_weight_kg >= 30 AND max_weight_kg <= 300)),
    ADD COLUMN IF NOT EXISTS preferred_orientations VARCHAR(64)[] NOT NULL DEFAULT '{}';

-- 3. Message Requests: First-message requests prior to mutual match
CREATE TABLE IF NOT EXISTS message_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'BLOCKED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    CONSTRAINT chk_no_self_message_request CHECK (sender_user_id <> recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_msg_requests_recipient_status
    ON message_requests (recipient_user_id, status);

CREATE INDEX IF NOT EXISTS idx_msg_requests_sender_recipient
    ON message_requests (sender_user_id, recipient_user_id);
