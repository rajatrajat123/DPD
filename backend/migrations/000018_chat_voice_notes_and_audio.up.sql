-- 000018_chat_voice_notes_and_audio.up.sql
-- Expand message_type to allow AUDIO/VOICE_NOTE and media_derivatives to allow AUDIO_M4A

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
    CHECK (message_type IN ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'VOICE_NOTE', 'SYSTEM'));

ALTER TABLE media_derivatives DROP CONSTRAINT IF EXISTS media_derivatives_variant_check;
ALTER TABLE media_derivatives ADD CONSTRAINT media_derivatives_variant_check
    CHECK (variant IN ('THUMB_WEBP', 'CARD_WEBP', 'FULL_WEBP', 'CARD_AVIF', 'FULL_AVIF', 'HLS_480P', 'HLS_720P', 'HLS_1080P', 'MP4_720P', 'VIDEO_POSTER', 'AUDIO_M4A'));

ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_media_type_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_media_type_check
    CHECK (media_type IN ('IMAGE', 'VIDEO', 'VOICE_NOTE', 'AUDIO'));
