-- Dashboard "đã xử lý" flag: a warning/error notice the operator has dismissed.
-- NULL = active (shown on the dashboard); a timestamp = dismissed (and when).
-- Dashboard hides dismissed rows; the Logs tab still shows them.
ALTER TABLE event_logs ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;
