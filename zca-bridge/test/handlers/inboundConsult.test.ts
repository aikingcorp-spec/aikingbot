import { describe, it, expect, vi } from "vitest";
import { InboundHandler } from "../../src/handlers/inbound.js";
import { ZaloThreadKind } from "../../src/zalo/types.js";

function oaTextMsg() {
  return {
    kind: ZaloThreadKind.OaUser, threadId: "u1", msgId: "m1", senderUid: "u1", senderName: "",
    text: "hi", classified: { kind: "text", text: "hi" }, isSelf: false,
    quoteSrc: { uidFrom: "u1", msgId: "m1", cliMsgId: "", msgType: "user_send_text", ts: "0", content: "hi", ttl: 0 },
  } as any;
}

function build(consult: any) {
  const chatwoot = {
    getContact: vi.fn(async () => ({})),
    createContact: vi.fn(async () => {}),
    createMessage: vi.fn(async () => ({ id: 1 })),
    createConversation: vi.fn(async () => ({ id: 5 })),
  };
  const mapping = { findByZaloMsgId: vi.fn(async () => null), recordIfNew: vi.fn(async () => {}) };
  const conversations = { getChatwootId: vi.fn(async () => 5), saveChatwootId: vi.fn(async () => {}) };
  const appClient = { enabled: false, createIncomingMessage: vi.fn(), createOutgoingMessage: vi.fn(async () => ({ id: 2 })) };
  const archive = { put: vi.fn(), urlFor: vi.fn(() => "u") };
  const enrich = vi.fn(async () => {});
  const h = new InboundHandler(chatwoot as any, mapping as any, conversations as any, enrich, (async () => appClient) as any, archive as any, 40 * 1024 * 1024, undefined, consult);
  return { h };
}

describe("InboundHandler consultation hook", () => {
  it("marks inbound for an OA user message", async () => {
    const consult = { onInbound: vi.fn(async () => {}) };
    const { h } = build(consult);
    await h.handle(3, "ident", oaTextMsg());
    expect(consult.onInbound).toHaveBeenCalledTimes(1);
    expect(consult.onInbound).toHaveBeenCalledWith(3, expect.any(String));
  });

  it("does not mark inbound for a self message", async () => {
    const consult = { onInbound: vi.fn(async () => {}) };
    const { h } = build(consult);
    const msg = oaTextMsg(); msg.isSelf = true;
    await h.handle(3, "ident", msg);
    expect(consult.onInbound).not.toHaveBeenCalled();
  });
});
