-- Per-conversation OA consultation-window state. last_inbound_at resets the 48h window
-- and the free-message counter on every user inbound; cs_sent_count tallies the bridge's
-- outbound consultation messages in the current window.
ALTER TABLE zalo_conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cs_sent_count   INT NOT NULL DEFAULT 0;
