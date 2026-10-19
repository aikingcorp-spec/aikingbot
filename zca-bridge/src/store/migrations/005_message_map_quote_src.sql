-- Store the fields needed to reconstruct a Zalo "quote" (reply) when an agent later replies
-- to this message from Chatwoot. zca-js requires the original message's owner/id/cliId/type/
-- ts/content/ttl; we only have those at receive time, so persist them alongside the mapping.
ALTER TABLE message_map ADD COLUMN IF NOT EXISTS quote_src JSONB;
