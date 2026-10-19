-- Per-account egress proxy for personal Zalo accounts.
CREATE TABLE IF NOT EXISTS proxies (
  id            BIGSERIAL PRIMARY KEY,
  label         TEXT NOT NULL,
  protocol      TEXT NOT NULL CHECK (protocol IN ('http','https','socks5')),
  host          TEXT NOT NULL,
  port          INTEGER NOT NULL CHECK (port > 0 AND port <= 65535),
  username      TEXT,
  password_enc  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE zalo_accounts
  ADD COLUMN IF NOT EXISTS proxy_id BIGINT REFERENCES proxies(id) ON DELETE SET NULL;
ALTER TABLE zalo_accounts
  ADD COLUMN IF NOT EXISTS proxy_pending BOOLEAN NOT NULL DEFAULT false;
