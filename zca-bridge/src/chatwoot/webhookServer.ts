import type { FastifyInstance } from "fastify";

export interface OutgoingEvent {
  sourceId: string;
  content: string;
  chatwootMessageId: number;
  inboxId: number;
  attachments: { dataUrl: string; fileType: string }[];
  inReplyTo?: number; // Chatwoot message id this reply quotes ("Reply to this message")
}

export function parseOutgoingWebhook(body: any): OutgoingEvent | null {
  if (!body || body.event !== "message_created") return null;
  if (body.message_type !== "outgoing") return null;
  if (body.private === true) return null;
  const contactInbox = body?.conversation?.contact_inbox;
  const sourceId = contactInbox?.source_id;
  if (!sourceId) return null;
  const attachments = Array.isArray(body.attachments)
    ? body.attachments.map((a: any) => ({ dataUrl: a.data_url, fileType: a.file_type }))
    : [];
  // Chatwoot nests inbox_id under conversation.contact_inbox; the top-level
  // conversation.inbox_id / inbox.id are not always present on message_created.
  const inboxId = contactInbox?.inbox_id ?? body?.conversation?.inbox_id ?? body?.inbox?.id;
  if (!inboxId) return null;
  const inReplyTo = body?.content_attributes?.in_reply_to;
  return {
    sourceId,
    content: body.content ?? "",
    chatwootMessageId: body.id,
    inboxId,
    attachments,
    ...(typeof inReplyTo === "number" ? { inReplyTo } : {}),
  };
}

export function registerWebhookRoute(
  app: FastifyInstance,
  onOutgoing: (evt: OutgoingEvent) => Promise<void>,
  secret: string | null = null,
): void {
  const path = secret ? `/webhooks/chatwoot/${secret}` : "/webhooks/chatwoot";
  app.post(path, async (req, reply) => {
    const evt = parseOutgoingWebhook(req.body);
    if (!evt) return reply.code(200).send({ ok: true, ignored: true });
    app.log.info({ event: "chatwoot_webhook_received", sourceId: evt.sourceId, inboxId: evt.inboxId, msgId: evt.chatwootMessageId }, "outbound webhook enqueued");
    try {
      // onOutgoing is the durable enqueue. Only ack once it is safely persisted.
      await onOutgoing(evt);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      app.log.error({ err }, "failed to persist outbound webhook");
      // Non-2xx makes Chatwoot retry delivery, so the reply is not lost.
      return reply.code(500).send({ ok: false });
    }
  });
}
