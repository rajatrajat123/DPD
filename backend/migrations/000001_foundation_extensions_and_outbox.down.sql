-- 000001_foundation_extensions_and_outbox.down.sql
DROP TABLE IF EXISTS processed_events;
DROP INDEX IF EXISTS idx_outbox_events_pending;
DROP TABLE IF EXISTS outbox_events;
