import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { ChatwootClient } from "../../src/chatwoot/client.js";

let agent: MockAgent;
const base = "http://chatwoot:3000";

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});
afterEach(async () => { await agent.close(); });

describe("ChatwootClient", () => {
  it("creates a contact with the given source_id", async () => {
    agent.get(base).intercept({
      path: "/public/api/v1/inboxes/ident-1/contacts",
      method: "POST",
    }).reply(200, { source_id: "user:84900", pubsub_token: "t", id: 5 });

    const client = new ChatwootClient(base);
    const res = await client.createContact("ident-1", { sourceId: "user:84900", name: "Khach 84900" });
    expect(res.sourceId).toBe("user:84900");
  });

  it("creates a conversation for a contact", async () => {
    agent.get(base).intercept({
      path: "/public/api/v1/inboxes/ident-1/contacts/user:84900/conversations",
      method: "POST",
    }).reply(200, { id: 42 });

    const client = new ChatwootClient(base);
    const conv = await client.createConversation("ident-1", "user:84900");
    expect(conv.id).toBe(42);
  });

  it("posts an incoming text message", async () => {
    agent.get(base).intercept({
      path: "/public/api/v1/inboxes/ident-1/contacts/user:84900/conversations/42/messages",
      method: "POST",
    }).reply(200, { id: 1001 });

    const client = new ChatwootClient(base);
    const msg = await client.createMessage("ident-1", "user:84900", 42, { content: "hi" });
    expect(msg.id).toBe(1001);
  });

  it("createMessage uploads an attachment as buffered multipart with content-length", async () => {
    let seenCT = "", seenCL = "";
    agent.get(base).intercept({
      path: "/public/api/v1/inboxes/ident-1/contacts/user:84900/conversations/42/messages",
      method: "POST",
    }).reply(200, (opts) => {
      const h = opts.headers as Record<string, string>;
      seenCT = h["content-type"] || ""; seenCL = h["content-length"] || "";
      return { id: 909 };
    });

    const client = new ChatwootClient(base);
    const res = await client.createMessage("ident-1", "user:84900", 42, {
      content: "see pic",
      attachments: [{ filename: "p.jpg", content: Buffer.from([1, 2, 3, 4]), contentType: "image/jpeg" }],
    });
    expect(res).toEqual({ id: 909 });
    expect(seenCT).toMatch(/^multipart\/form-data; boundary=/);
    expect(Number(seenCL)).toBeGreaterThan(0);
  });

  it("updates a contact with phone and custom_attributes", async () => {
    let sent: any = null;
    agent.get(base).intercept({ path: "/public/api/v1/inboxes/ident-1/contacts/oa-user:u1", method: "PATCH" })
      .reply(200, (opts) => { sent = JSON.parse(String(opts.body ?? "{}")); return {}; });
    const client = new ChatwootClient(base);
    await client.updateContact("ident-1", "oa-user:u1", {
      name: "Nguyen A", phoneNumber: "0900", customAttributes: { zalo_address: "1 Le Loi" },
    });
    expect(sent.phone_number).toBe("0900");
    expect(sent.custom_attributes).toEqual({ zalo_address: "1 Le Loi" });
  });
});
