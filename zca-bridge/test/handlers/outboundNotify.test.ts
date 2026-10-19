import { describe, it, expect, vi } from "vitest";
import { makeOutboundNotifier } from "../../src/handlers/outboundNotify.js";

const evt = { sourceId: "user:84900", content: "x", chatwootMessageId: 7, inboxId: 3, attachments: [] };

function deps() {
  const accounts = { findByInboxIdentifier: vi.fn(async () => ({ id: 1, chatwootInboxIdentifier: "ident-1" })) };
  const conversations = { getChatwootId: vi.fn(async () => 42) };
  const appClient = { postPrivateNote: vi.fn(async () => {}) };
  return { accounts, conversations, appClient };
}

describe("makeOutboundNotifier", () => {
  it("posts a private note to the resolved conversation", async () => {
    const d = deps();
    const notify = makeOutboundNotifier((id) => (id === 3 ? "ident-1" : null), d.accounts as any, d.conversations as any, (async () => d.appClient) as any);
    await notify(evt as any, "boom");
    expect(d.appClient.postPrivateNote).toHaveBeenCalledWith(42, "boom");
  });

  it("does nothing when the inbox cannot be resolved", async () => {
    const d = deps();
    const notify = makeOutboundNotifier(() => null, d.accounts as any, d.conversations as any, (async () => d.appClient) as any);
    await notify(evt as any, "boom");
    expect(d.appClient.postPrivateNote).not.toHaveBeenCalled();
  });

  it("does nothing when there is no conversation yet", async () => {
    const d = deps();
    d.conversations.getChatwootId = vi.fn(async () => null);
    const notify = makeOutboundNotifier(() => "ident-1", d.accounts as any, d.conversations as any, (async () => d.appClient) as any);
    await notify(evt as any, "boom");
    expect(d.appClient.postPrivateNote).not.toHaveBeenCalled();
  });

  it("swallows a postPrivateNote failure (never throws)", async () => {
    const d = deps();
    d.appClient.postPrivateNote = vi.fn(async () => { throw new Error("chatwoot down"); });
    const notify = makeOutboundNotifier(() => "ident-1", d.accounts as any, d.conversations as any, (async () => d.appClient) as any);
    await expect(notify(evt as any, "boom")).resolves.toBeUndefined();
  });
});
