import { describe, it, expect, vi } from "vitest";
import { InboundHandler } from "../../src/handlers/inbound.js";
import { ZaloThreadKind } from "../../src/zalo/types.js";

function mocks() {
  const chatwoot = {
    getContact: vi.fn(async () => ({ sourceId: "x" })),
    createContact: vi.fn(async () => ({ sourceId: "x" })),
    createConversation: vi.fn(async () => ({ id: 1 })),
    createMessage: vi.fn(async () => ({ id: 10 })),
    updateContact: vi.fn(async () => {}),
  };
  const mapping = { recordIfNew: vi.fn(async () => {}), findByZaloMsgId: vi.fn(async () => null), loadCredentials: vi.fn() };
  const conversations = { getChatwootId: vi.fn(async () => 1), saveChatwootId: vi.fn(async () => {}) };
  const enrich = vi.fn(async () => {});
  const appClient = { enabled: false };
  const archive = { store: vi.fn() };
  return { chatwoot, mapping, conversations, enrich, appClient, archive };
}

function oaMsg(ts: string) {
  return { kind: ZaloThreadKind.OaUser, threadId: "u1", msgId: "m1", senderUid: "u1", senderName: "",
    text: "hi", classified: { kind: "text", text: "hi" }, isSelf: false,
    quoteSrc: { uidFrom: "u1", msgId: "m1", cliMsgId: "", msgType: "user_send_text", ts, content: "hi", ttl: 0 } };
}

// Constructor order: (chatwoot, mapping, conversations, enrich, appClient, archive, maxAttachmentBytes, log, consult, infoRequest, watermark)
function build(m: ReturnType<typeof mocks>, watermark: any) {
  return new InboundHandler(m.chatwoot as any, m.mapping as any, m.conversations as any, m.enrich as any, (async () => m.appClient) as any, m.archive as any, 5_000_000, undefined, undefined, undefined, watermark);
}

describe("InboundHandler watermark hook", () => {
  it("advances the watermark with the OA message time after relay", async () => {
    const m = mocks();
    const watermark = { onRelayed: vi.fn() };
    await build(m, watermark).handle(5, "ident-1", oaMsg("1700") as any);
    expect(watermark.onRelayed).toHaveBeenCalledWith(5, 1700);
  });

  it("does not advance for a non-OA user", async () => {
    const m = mocks();
    const watermark = { onRelayed: vi.fn() };
    const msg = { ...oaMsg("1700"), kind: ZaloThreadKind.User, threadId: "84900" };
    await build(m, watermark).handle(5, "ident-1", msg as any);
    expect(watermark.onRelayed).not.toHaveBeenCalled();
  });

  it("does not advance when the timestamp is not a positive number", async () => {
    const m = mocks();
    const watermark = { onRelayed: vi.fn() };
    await build(m, watermark).handle(5, "ident-1", oaMsg("") as any);
    expect(watermark.onRelayed).not.toHaveBeenCalled();
  });
});
