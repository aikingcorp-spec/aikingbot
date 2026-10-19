import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { createHash } from "node:crypto";
import { registerOaWebhookRoute } from "../../src/zalo-oa/webhookRoute.js";

function macFor(appId: string, data: string, ts: string, oaSecretKey: string) {
  return createHash("sha256").update(appId + data + ts + oaSecretKey).digest("hex");
}

async function build(onInbound: any) {
  const app = Fastify();
  const accounts = { findByOaId: vi.fn(async () => ({ id: 5, type: "oa" })) };
  registerOaWebhookRoute(app, { appId: "APP", oaSecretKey: "OASECRET", accounts: accounts as any, onInbound });
  await app.ready();
  return { app, accounts };
}

describe("OA webhook route", () => {
  it("enqueues a verified user_send_text event", async () => {
    const onInbound = vi.fn();
    const { app } = await build(onInbound);
    const body = { app_id: "APP", event_name: "user_send_text", oa_id: "oa1", timestamp: "1700",
      sender: { id: "u1" }, recipient: { id: "oa1" }, message: { msg_id: "m1", text: "hi" } };
    const data = JSON.stringify(body);
    const res = await app.inject({ method: "POST", url: "/webhooks/zalo-oa",
      headers: { "x-zevent-signature": `mac=${macFor("APP", data, "1700", "OASECRET")}` }, payload: data });
    expect(res.statusCode).toBe(200);
    expect(onInbound).toHaveBeenCalledWith(5, expect.objectContaining({ msgId: "m1", text: "hi", isSelf: false }));
  });

  it("rejects a bad signature with 401 and does not enqueue", async () => {
    const onInbound = vi.fn();
    const { app } = await build(onInbound);
    const data = JSON.stringify({ app_id: "APP", event_name: "user_send_text", oa_id: "oa1", timestamp: "1700", sender: { id: "u1" }, message: { msg_id: "m1", text: "hi" } });
    const res = await app.inject({ method: "POST", url: "/webhooks/zalo-oa", headers: { "x-zevent-signature": "mac=bad" }, payload: data });
    expect(res.statusCode).toBe(401);
    expect(onInbound).not.toHaveBeenCalled();
  });

  it("marks oa_send_* as self-capture", async () => {
    const onInbound = vi.fn();
    const { app } = await build(onInbound);
    const body = { app_id: "APP", event_name: "oa_send_text", oa_id: "oa1", timestamp: "1700", sender: { id: "oa1" }, recipient: { id: "u1" }, message: { msg_id: "m9", text: "reply" } };
    const data = JSON.stringify(body);
    await app.inject({ method: "POST", url: "/webhooks/zalo-oa", headers: { "x-zevent-signature": `mac=${macFor("APP", data, "1700", "OASECRET")}` }, payload: data });
    expect(onInbound).toHaveBeenCalledWith(5, expect.objectContaining({ isSelf: true, threadId: "u1" }));
  });

  it("routes a verified user_submit_info event to onSharedInfo", async () => {
    const onInbound = vi.fn();
    const onSharedInfo = vi.fn(async () => {});
    const app = Fastify();
    const accounts = { findByOaId: vi.fn(async () => ({ id: 5, type: "oa" })) };
    registerOaWebhookRoute(app, { appId: "APP", oaSecretKey: "OASECRET", accounts: accounts as any, onInbound, onSharedInfo });
    await app.ready();
    const body = { app_id: "APP", event_name: "user_submit_info", oa_id: "oa1", timestamp: "1700",
      sender: { id: "u1" }, recipient: { id: "oa1" }, info: { name: "A", phone: "0900" } };
    const data = JSON.stringify(body);
    const res = await app.inject({ method: "POST", url: "/webhooks/zalo-oa",
      headers: { "x-zevent-signature": `mac=${macFor("APP", data, "1700", "OASECRET")}` }, payload: data });
    expect(res.statusCode).toBe(200);
    expect(onSharedInfo).toHaveBeenCalledWith(5, expect.objectContaining({ event_name: "user_submit_info" }));
    expect(onInbound).not.toHaveBeenCalled();
  });
});
