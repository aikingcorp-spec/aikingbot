import { describe, it, expect, vi } from "vitest";
import { InboundHandler } from "../../src/handlers/inbound.js";
import { ZaloThreadKind } from "../../src/zalo/types.js";

function oaMsg() {
  return {
    kind: ZaloThreadKind.OaUser, threadId: "u1", msgId: "m1", senderUid: "u1", senderName: "",
    text: "hi", classified: { kind: "text", text: "hi" }, isSelf: false,
    quoteSrc: { uidFrom: "u1", msgId: "m1", cliMsgId: "", msgType: "user_send_text", ts: "1", content: "hi", ttl: 0 },
  };
}

function mocks() {
  const chatwoot = {
    getContact: vi.fn(async () => ({})),
    createContact: vi.fn(async () => {}),
    createMessage: vi.fn(async () => ({ id: 10 })),
    createConversation: vi.fn(async () => ({ id: 1 })),
  };
  const mapping = { findByZaloMsgId: vi.fn(async () => null), recordIfNew: vi.fn(async () => {}) };
  const conversations = { getChatwootId: vi.fn(async () => 5), saveChatwootId: vi.fn(async () => {}) };
  const enrich = vi.fn(async () => {});
  const appClient = { enabled: false, createIncomingMessage: vi.fn(), createOutgoingMessage: vi.fn(async () => ({ id: 2 })) };
  const archive = { put: vi.fn(), urlFor: vi.fn(() => "u") };
  return { chatwoot, mapping, conversations, enrich, appClient, archive };
}

describe("InboundHandler info-request hook", () => {
  it("fires infoRequest.onInbound for OA inbound", async () => {
    const m = mocks();
    const consult = { onInbound: vi.fn(async () => {}) };
    const infoRequest = { onInbound: vi.fn(async () => {}) };
    const h = new InboundHandler(
      m.chatwoot as any, m.mapping as any, m.conversations as any, m.enrich as any,
      (async () => m.appClient) as any, m.archive as any, 5_000_000, undefined, consult as any, infoRequest as any,
    );
    await h.handle(5, "ident-1", oaMsg() as any);
    expect(infoRequest.onInbound).toHaveBeenCalledWith(5, "oa-user:u1");
  });

  it("does not fire infoRequest for a non-OA user", async () => {
    const m = mocks();
    const infoRequest = { onInbound: vi.fn(async () => {}) };
    const h = new InboundHandler(
      m.chatwoot as any, m.mapping as any, m.conversations as any, m.enrich as any,
      (async () => m.appClient) as any, m.archive as any, 5_000_000, undefined, undefined, infoRequest as any,
    );
    const msg = { ...oaMsg(), kind: ZaloThreadKind.User, threadId: "84900" };
    await h.handle(5, "ident-1", msg as any);
    expect(infoRequest.onInbound).not.toHaveBeenCalled();
  });
});
