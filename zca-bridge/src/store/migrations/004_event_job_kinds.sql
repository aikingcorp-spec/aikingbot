-- Allow Zalo-side events beyond plain messages to flow through the durable queue:
--   reaction  → posted to Chatwoot as a private note
--   undo      → operator's own message recall → delete the mapped Chatwoot message
ALTER TABLE job_queue DROP CONSTRAINT IF EXISTS job_queue_kind_check;
ALTER TABLE job_queue ADD CONSTRAINT job_queue_kind_check
  CHECK (kind IN ('inbound', 'outbound', 'reaction', 'undo'));
