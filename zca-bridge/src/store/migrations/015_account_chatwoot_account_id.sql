-- Per-Zalo-account target Chatwoot account id (effective account used at auto-provision time).
-- Relay is account-agnostic (uses inbox identifier); this column records the routing choice
-- for admin display and audit. Nullable: legacy/OA/existing-without-input rows stay NULL.
ALTER TABLE zalo_accounts
  ADD COLUMN IF NOT EXISTS chatwoot_account_id BIGINT;
