-- Persistent source_id -> Chatwoot conversation mapping (idempotent conversation reuse across retries/restarts)
CREATE TABLE IF NOT EXISTS zalo_conversations (
  zalo_account_id           BIGINT NOT NULL REFERENCES zalo_accounts(id) ON DELETE CASCADE,
  source_id                 TEXT NOT NULL,
  chatwoot_conversation_id  BIGINT NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (zalo_account_id, source_id)
);

-- Durable job queue for both directions
CREATE TABLE IF NOT EXISTS job_queue (
  id               BIGSERIAL PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('inbound','outbound')),
  dedup_key        TEXT NOT NULL,
  payload          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  attempts         INT NOT NULL DEFAULT 0,
  max_attempts     INT NOT NULL DEFAULT 25,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, dedup_key)
);

-- Fast claim of runnable jobs (pending, due) and reclaim of stale processing rows
CREATE INDEX IF NOT EXISTS idx_job_queue_runnable ON job_queue (next_attempt_at)
  WHERE status IN ('pending', 'processing');
