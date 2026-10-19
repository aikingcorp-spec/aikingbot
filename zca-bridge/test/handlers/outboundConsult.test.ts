import { describe, it, expect, vi } from "vitest";
import { OutboundHandler } from "../../src/handlers/outbound.js";
import type { OutgoingEvent } from "../../src/chatwoot/webhookServer.js";

const evt: OutgoingEvent = { sourceId: "oa-user:u1", content: "hi", chatwootMessageId: 10, inboxId: 5, attachments: [] };

function make(accountType: "oa" | "personal") {
  const mapping = { findByChatwootMessageId: vi.fn(async () => null), recordIfNew: vi.fn(async () => {}) };
  const accounts = { findByInboxIdentifier: vi.fn(async () => ({ id: 3, type: accountType })) };
  const sessions = { has: vi.fn(() => true), sendText: vi.fn(async () => ({ msgId: "m1" })) };
  const consult = { onOutbound: vi.fn(async () => {}) };
  const h = new OutboundHandler(sessions as any, accounts as any, () => "ident", mapping as any, "http://cw", async () => {}, undefined, consult);
  return { h, consult };
}

describe("OutboundHandler consultation hook", () => {
  it("calls consult.onOutbound after a successful OA send", async () => {
    const { h, consult } = make("oa");
    await h.handle(evt);
    expect(consult.onOutbound).toHaveBeenCalledWith(3, "oa-user:u1");
  });

  it("does not call consult.onOutbound for a personal account", async () => {
    const { h, consult } = make("personal");
    await h.handle(evt);
    expect(consult.onOutbound).not.toHaveBeenCalled();
  });
});
