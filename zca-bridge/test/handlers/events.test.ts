import { describe, it, expect, vi } from "vitest";
import { ReactionHandler, UndoHandler } from "../../src/handlers/events.js";
import { ZaloThreadKind, ReactionEvent, UndoEvent } from "../../src/zalo/types.js";

function deps(opts: { conversationId?: number | null; mapped?: { chatwootMessageId: number | null; direction: "in" | "out" } | null } = {}) {
  const conversations = { getChatwootId: vi.fn(async () => (opts.conversationId === undefined ? 42 : opts.conversationId)) };
  const mapping = { findByZaloMsgId: vi.fn(async () => (opts.mapped === undefined ? { chatwootMessageId: 500, direction: "in" as const } : opts.mapped)) };
  const appClient = { postPrivateNote: vi.fn(async () => {}), deleteMessage: vi.fn(async () => {}) };
  return { conversations, mapping, appClient };
}

const reaction = (over: Partial<ReactionEvent> = {}): ReactionEvent => ({
  kind: ZaloThreadKind.User, threadId: "84900", reactedMsgId: "m1",
  icon: "/-heart", senderUid: "84900", senderName: "Khach A", isSelf: false, ...over,
});

const undo = (over: Partial<UndoEvent> = {}): UndoEvent => ({
  kind: ZaloThreadKind.User, threadId: "84900", recalledMsgId: "m1", isSelf: true, ...over,
});

describe("ReactionHandler", () => {
  it("posts a private note threaded onto the reacted message", async () => {
    const d = deps();
    await new ReactionHandler(d.conversations as any, d.mapping as any, (async () => d.appClient) as any).handle(1, reaction());
    expect(d.appClient.postPrivateNote).toHaveBeenCalledWith(42, expect.stringContaining("❤️"), { inReplyTo: 500 });
    expect(d.appClient.postPrivateNote).toHaveBeenCalledWith(42, expect.stringContaining("Khach A"), expect.anything());
  });

  it("labels the operator's own reaction as 'Bạn'", async () => {
    const d = deps();
    await new ReactionHandler(d.conversations as any, d.mapping as any, (async () => d.appClient) as any).handle(1, reaction({ isSelf: true }));
    expect(d.appClient.postPrivateNote).toHaveBeenCalledWith(42, expect.stringContaining("Bạn"), expect.anything());
  });

  it("ignores a reaction removal (empty icon)", async () => {
    const d = deps();
    await new ReactionHandler(d.conversations as any, d.mapping as any, (async () => d.appClient) as any).handle(1, reaction({ icon: "" }));
    expect(d.appClient.postPrivateNote).not.toHaveBeenCalled();
  });

  it("does nothing when there is no conversation yet", async () => {
    const d = deps({ conversationId: null });
    await new ReactionHandler(d.conversations as any, d.mapping as any, (async () => d.appClient) as any).handle(1, reaction());
    expect(d.appClient.postPrivateNote).not.toHaveBeenCalled();
  });

  it("still posts the note without in_reply_to when the reacted message is unknown", async () => {
    const d = deps({ mapped: null });
    await new ReactionHandler(d.conversations as any, d.mapping as any, (async () => d.appClient) as any).handle(1, reaction());
    expect(d.appClient.postPrivateNote).toHaveBeenCalledWith(42, expect.any(String), { inReplyTo: undefined });
  });
});

describe("UndoHandler", () => {
  it("deletes the mapped Chatwoot message when the operator recalls their own message", async () => {
    const d = deps({ mapped: { chatwootMessageId: 777, direction: "out" } });
    await new UndoHandler(d.conversations as any, d.mapping as any, (async () => d.appClient) as any).handle(1, undo());
    expect(d.appClient.deleteMessage).toHaveBeenCalledWith(42, 777);
  });

  it("ignores a customer recall (not isSelf)", async () => {
    const d = deps({ mapped: { chatwootMessageId: 777, direction: "in" } });
    await new UndoHandler(d.conversations as any, d.mapping as any, (async () => d.appClient) as any).handle(1, undo({ isSelf: false }));
    expect(d.appClient.deleteMessage).not.toHaveBeenCalled();
  });

  it("does nothing when the recalled message was never relayed", async () => {
    const d = deps({ mapped: null });
    await new UndoHandler(d.conversations as any, d.mapping as any, (async () => d.appClient) as any).handle(1, undo());
    expect(d.appClient.deleteMessage).not.toHaveBeenCalled();
  });
});
