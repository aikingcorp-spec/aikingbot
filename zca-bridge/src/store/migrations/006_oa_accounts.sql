-- Distinguish personal (zca-js) accounts from Official Account (OA) channels.
ALTER TABLE zalo_accounts ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'personal'
  CHECK (type IN ('personal', 'oa'));
ALTER TABLE zalo_accounts ADD COLUMN IF NOT EXISTS zalo_oa_id TEXT;

-- Encrypted OAuth tokens for OA accounts (access token ~1h, refresh token single-use ~3 months).
CREATE TABLE IF NOT EXISTS oa_tokens (
  zalo_account_id    BIGINT PRIMARY KEY REFERENCES zalo_accounts(id) ON DELETE CASCADE,
  access_token       TEXT NOT NULL,
  refresh_token      TEXT NOT NULL,
  access_expires_at  TIMESTAMPTZ NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Look up an OA account by its Zalo OA id (webhook routing).
CREATE INDEX IF NOT EXISTS idx_zalo_accounts_oa_id ON zalo_accounts (zalo_oa_id) WHERE zalo_oa_id IS NOT NULL;
