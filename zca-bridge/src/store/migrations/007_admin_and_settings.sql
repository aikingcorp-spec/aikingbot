-- Single admin account for the admin UI (replaces the static ADMIN_TOKEN).
CREATE TABLE IF NOT EXISTS admin_users (
  id         BIGSERIAL PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  pass_hash  TEXT NOT NULL,   -- scrypt hash, hex
  salt       TEXT NOT NULL,   -- random salt, hex
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Runtime configuration editable from the admin UI. Secret values are stored
-- encrypted (AES-256-GCM via CREDENTIALS_KEY); non-secret values are plaintext.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  is_secret  BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
