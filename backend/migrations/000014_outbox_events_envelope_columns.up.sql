-- 000014_outbox_events_envelope_columns.up.sql
-- Add envelope schema version, occurred timestamp, correlation ID, and event ID to outbox_events.

ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS schema_version INT NOT NULL DEFAULT 1;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(64);
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS event_id UUID;

CREATE INDEX IF NOT EXISTS idx_outbox_events_correlation
    ON outbox_events (correlation_id)
    WHERE correlation_id IS NOT NULL;
