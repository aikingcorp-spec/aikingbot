import type { FastifyInstance } from "fastify";
import { AccountRepo } from "../store/accountRepo.js";
import { IncomingMessage } from "../zalo/types.js";
import { verifyMac } from "./verify.js";
import { classifyOaMessage } from "./classify.js";

const SELF_EVENTS = new Set(["oa_send_text", "oa_send_image", "oa_send_file", "oa_send_gif", "oa_send_sticker"]);

export interface OaWebhookDeps {
  appId: string;
  oaSecretKey: string;
  accounts: Pick<AccountRepo, "findByOaId">;
  onInbound: (accountId: number, msg: IncomingMessage) => void;
  onSharedInfo?: (accountId: number, event: any) => Promise<void>;
}

export function registerOaWebhookRoute(app: FastifyInstance, deps: OaWebhookDeps): void {
  // Need the raw body string for mac verification.
  // Register both application/json and a wildcard fallback so the route works
  // whether or not the client sends a Content-Type header (Fastify inject in tests
  // does not set Content-Type automatically when the payload is already a string).
  function parseRaw(_req: any, body: unknown, done: (err: Error | null, body?: unknown) => void): void {
    try { done(null, { raw: String(body), json: JSON.parse(String(body)) }); }
    catch (err) { done(err as Error); }
  }
  app.addContentTypeParser("application/json", { parseAs: "string" }, parseRaw);
  app.addContentTypeParser("*", { parseAs: "string" }, parseRaw);

  app.post("/webhooks/zalo-oa", async (req, reply) => {
    const { raw, json } = req.body as { raw: string; json: any };
    const sigHeader = String(req.headers["x-zevent-signature"] ?? "");
    const mac = sigHeader.replace(/^mac=/, "");
    const ts = String(json?.timestamp ?? "");
    if (!verifyMac({ appId: deps.appId, data: raw, timestamp: ts, mac }, deps.oaSecretKey)) {
      return reply.code(401).send({ ok: false });
    }
    const eventName = String(json?.event_name ?? "");
    if (eventName === "user_submit_info") {
      const oaId = String(json?.oa_id ?? json?.recipient?.id ?? "");
      const account = await deps.accounts.findByOaId(oaId);
      if (!account) {
        req.log.warn({ event: "oa_webhook_unknown_oa", resolvedOaId: oaId, eventName }, "OA webhook: no account matches this oa id");
        return reply.code(200).send({ ok: true, ignored: "unknown_oa" });
      }
      req.log.info({ event: "oa_webhook_received", eventName, resolvedOaId: oaId, accountId: account.id }, "OA webhook received");
      try {
        await deps.onSharedInfo?.(account.id, json);
        return reply.code(200).send({ ok: true });
      } catch (err) {
        req.log.error({ err }, "failed to handle user_submit_info");
        return reply.code(500).send({ ok: false });
      }
    }
    const isSelf = SELF_EVENTS.has(eventName);
    if (!eventName.startsWith("user_send_") && !isSelf) {
      // follow/unfollow/seen/etc. — acknowledge without enqueueing a message (v1).
      return reply.code(200).send({ ok: true, ignored: eventName });
    }
    const resolvedOaId = String(json?.oa_id ?? (isSelf ? json?.sender?.id : json?.recipient?.id) ?? "");
    const account = await deps.accounts.findByOaId(resolvedOaId);
    if (!account) {
      req.log.warn({ event: "oa_webhook_unknown_oa", resolvedOaId, eventName }, "OA webhook: no account matches this oa id");
      return reply.code(200).send({ ok: true, ignored: "unknown_oa" });
    }

    req.log.info({ event: "oa_webhook_received", eventName, resolvedOaId, accountId: account.id }, "OA webhook received");
    const msg = classifyOaMessage(json, isSelf);
    try {
      deps.onInbound(account.id, msg);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      req.log.error({ err }, "failed to enqueue OA inbound");
      return reply.code(500).send({ ok: false });
    }
  });
}
