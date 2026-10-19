-- The ReconnectSupervisor sets a personal account to 'reconnecting' while it
-- recreates the zca-js session with backoff. The original status CHECK from
-- 001_init.sql does not allow that value, so widen the constraint.
ALTER TABLE zalo_accounts DROP CONSTRAINT IF EXISTS zalo_accounts_status_check;
ALTER TABLE zalo_accounts ADD CONSTRAINT zalo_accounts_status_check
  CHECK (status IN ('pending_qr', 'connected', 'reconnecting', 'expired', 'logged_out'));
