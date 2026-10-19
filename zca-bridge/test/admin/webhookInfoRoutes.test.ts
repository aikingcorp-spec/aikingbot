import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { buildWebhookUrls, registerWebhookInfoRoutes } from "../../src/admin/webhookInfoRoutes.js";

describe("buildWebhookUrls", () => {
  it("builds chatwoot + oa urls without a secret", () => {
    expect(
      buildWebhookUrls({ chatwootWebhookBase: "http://zca-bridge:4000", webhookSecret: null, publicBaseUrl: "https://zalo.pindu.vn" }),
    ).toEqual({
      chatwoot: "http://zca-bridge:4000/webhooks/chatwoot",
      oa: "https://zalo.pindu.vn/webhooks/zalo-oa",
    });
  });

  it("embeds the secret in the chatwoot path and tolerates trailing slashes", () => {
    const urls = buildWebhookUrls({ chatwootWebhookBase: "http://zca-bridge:4000/", webhookSecret: "s3cr3t", publicBaseUrl: "https://zalo.pindu.vn/" });
    expect(urls.chatwoot).toBe("http://zca-bridge:4000/webhooks/chatwoot/s3cr3t");
    expect(urls.oa).toBe("https://zalo.pindu.vn/webhooks/zalo-oa");
  });
});

describe("webhook info route", () => {
  it("returns the urls behind the guard", async () => {
    const app = Fastify();
    const urls = { chatwoot: "http://zca-bridge:4000/webhooks/chatwoot", oa: "https://zalo.pindu.vn/webhooks/zalo-oa" };
    registerWebhookInfoRoutes(app, urls, async () => {});
    const res = await app.inject({ method: "GET", url: "/admin/api/webhooks" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(urls);
  });

  it("enforces the auth guard", async () => {
    const app = Fastify();
    const guard = vi.fn(async (_req: any, reply: any) => { reply.code(401).send({ ok: false }); });
    registerWebhookInfoRoutes(app, { chatwoot: "x", oa: "y" }, guard);
    const res = await app.inject({ method: "GET", url: "/admin/api/webhooks" });
    expect(res.statusCode).toBe(401);
  });
});
