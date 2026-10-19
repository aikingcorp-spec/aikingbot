-- Reverse lookup: given a Chatwoot message id, find the linked Zalo msg id.
-- Used by the outbound handler to skip re-sending messages that originated
-- from a Zalo native send (self-capture import).
CREATE INDEX IF NOT EXISTS idx_message_map_chatwoot_message_id
  ON message_map (chatwoot_message_id);
