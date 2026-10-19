-- Persisted application events + warnings/errors, shown in the admin Logs tab.
-- A row is written when its pino level is >= 40 (warn/error) OR it carries an `event`.
CREATE TABLE IF NOT EXISTS event_logs (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  level       SMALLINT     NOT NULL,         -- pino numeric level: 30 info, 40 warn, 50 error
  event       TEXT,                          -- business event name; NULL when only a warn/error
  account_id  INTEGER,                       -- NULL when not tied to a specific account
  msg         TEXT         NOT NULL,
  context     JSONB        NOT NULL DEFAULT '{}'  -- remaining record fields, secrets redacted
);
CREATE INDEX IF NOT EXISTS idx_event_logs_ts ON event_logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_event_logs_account ON event_logs (account_id, ts DESC);
