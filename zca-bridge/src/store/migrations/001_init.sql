CREATE TABLE IF NOT EXISTS zalo_accounts (
  id                          BIGSERIAL PRIMARY KEY,
  label                       TEXT NOT NULL,
  zalo_uid                    TEXT,
  chatwoot_inbox_identifier   TEXT NOT NULL,
  chatwoot_inbox_id           BIGINT,
  status                      TEXT NOT NULL DEFAULT 'pending_qr'
                                CHECK (status IN ('pending_qr','connected','expired','logged_out')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zalo_sessions (
  zalo_account_id        BIGINT PRIMARY KEY REFERENCES zalo_accounts(id) ON DELETE CASCADE,
  encrypted_credentials  TEXT NOT NULL,
  last_login_at          TIMESTAMPTZ,
  last_seen_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS message_map (
  id                  BIGSERIAL PRIMARY KEY,
  zalo_account_id     BIGINT NOT NULL REFERENCES zalo_accounts(id) ON DELETE CASCADE,
  zalo_msg_id         TEXT NOT NULL,
  zalo_thread_id      TEXT NOT NULL,
  chatwoot_message_id BIGINT,
  direction           TEXT NOT NULL CHECK (direction IN ('in','out')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zalo_account_id, zalo_msg_id)
);
