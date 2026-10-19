import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

type Pre = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface WebhookUrls {
  chatwoot: string; // paste into each Chatwoot inbox: Configuration → Webhook URL
  oa: string;       // paste into the Zalo OA Developer console
}

/** Build the webhook URLs the operator must register in Chatwoot and Zalo OA. */
export function buildWebhookUrls(opts: {
  chatwootWebhookBase: string;
  webhookSecret: string | null;
  publicBaseUrl: string;
}): WebhookUrls {
  const base = opts.chatwootWebhookBase.replace(/\/$/, "");
  const chatwoot = `${base}/webhooks/chatwoot${opts.webhookSecret ? `/${opts.webhookSecret}` : ""}`;
  const oa = `${opts.publicBaseUrl.replace(/\/$/, "")}/webhooks/zalo-oa`;
  return { chatwoot, oa };
}

export function registerWebhookInfoRoutes(app: FastifyInstance, urls: WebhookUrls, guard: Pre): void {
  app.get("/admin/api/webhooks", { preHandler: guard }, async () => urls);
}
