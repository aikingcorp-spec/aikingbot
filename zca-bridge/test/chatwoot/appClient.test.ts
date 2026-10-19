import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { ChatwootAppClient } from "../../src/chatwoot/appClient.js";

let agent: MockAgent;
const base = "http://chatwoot:3000";
beforeEach(() => { agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent); });
afterEach(async () => { await agent.close(); });

describe("ChatwootAppClient", () => {
  it("posts a private note to a conversation", async () => {
    let seenHeaders: any;
    agent.get(base).intercept({
      path: "/api/v1/accounts/7/conversations/42/messages", method: "POST",
    }).reply(200, (opts) => { seenHeaders = opts.headers; return { id: 1 }; });

    const client = new ChatwootAppClient(base, "TOKEN123", 7);
    await client.postPrivateNote(42, "⚠️ Gửi Zalo thất bại");
    expect(seenHeaders.api_access_token).toBe("TOKEN123");
  });

  it("is a no-op when no token is configured", async () => {
    const client = new ChatwootAppClient(base, null, null);
    await expect(client.postPrivateNote(42, "x")).resolves.toBeUndefined();
    // no HTTP call made; MockAgent would throw on net connect if it tried
  });

  it("createOutgoingMessage posts an outgoing non-private message", async () => {
    const client = new ChatwootAppClient(base, "TOKEN123", 7);
    let seenBody = "";
    agent.get(base).intercept({
      path: "/api/v1/accounts/7/conversations/42/messages",
      method: "POST",
    }).reply(200, (opts) => { seenBody = String(opts.body); return { id: 1234 }; });

    const res = await client.createOutgoingMessage(42, "📱 từ app Zalo\nhello");
    expect(res).toEqual({ id: 1234 });
    expect(seenBody).toContain('"message_type":"outgoing"');
    expect(seenBody).toContain('"private":false');
  });

  it("createOutgoingMessage throws when not configured", async () => {
    const client = new ChatwootAppClient(base, null, null);
    await expect(client.createOutgoingMessage(42, "x")).rejects.toThrow(/not configured/);
  });

  it("createIncomingMessage posts an incoming message with in_reply_to", async () => {
    const client = new ChatwootAppClient(base, "TOKEN123", 7);
    let seenBody = "";
    agent.get(base).intercept({
      path: "/api/v1/accounts/7/conversations/42/messages", method: "POST",
    }).reply(200, (opts) => { seenBody = String(opts.body); return { id: 99 }; });

    const res = await client.createIncomingMessage(42, "tra loi", { inReplyTo: 50 });
    expect(res).toEqual({ id: 99 });
    expect(seenBody).toContain('"message_type":"incoming"');
    expect(seenBody).toContain('"in_reply_to":50');
  });

  it("createIncomingMessage omits content_attributes when no in_reply_to", async () => {
    const client = new ChatwootAppClient(base, "TOKEN123", 7);
    let seenBody = "";
    agent.get(base).intercept({
      path: "/api/v1/accounts/7/conversations/42/messages", method: "POST",
    }).reply(200, (opts) => { seenBody = String(opts.body); return { id: 100 }; });

    await client.createIncomingMessage(42, "xin chao", {});
    expect(seenBody).not.toContain("content_attributes");
  });

  it("deleteMessage issues a DELETE to the message endpoint", async () => {
    const client = new ChatwootAppClient(base, "TOKEN123", 7);
    let seenMethod = "";
    let seenHeaders: any;
    agent.get(base).intercept({
      path: "/api/v1/accounts/7/conversations/42/messages/555", method: "DELETE",
    }).reply(200, (opts) => { seenMethod = "DELETE"; seenHeaders = opts.headers; return {}; });

    await client.deleteMessage(42, 555);
    expect(seenMethod).toBe("DELETE");
    expect(seenHeaders.api_access_token).toBe("TOKEN123");
  });

  it("deleteMessage throws when not configured", async () => {
    const client = new ChatwootAppClient(base, null, null);
    await expect(client.deleteMessage(42, 555)).rejects.toThrow(/not configured/);
  });
});
