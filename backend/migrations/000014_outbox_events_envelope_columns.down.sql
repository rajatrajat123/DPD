-- 000014_outbox_events_envelope_columns.down.sql
-- Rollback outbox_events envelope columns.

DROP INDEX IF EXISTS idx_outbox_events_correlation;

ALTER TABLE outbox_events DROP COLUMN IF EXISTS event_id;
ALTER TABLE outbox_events DROP COLUMN IF EXISTS correlation_id;
ALTER TABLE outbox_events DROP COLUMN IF EXISTS occurred_at;
ALTER TABLE outbox_events DROP COLUMN IF EXISTS schema_version;
