import { describe, it, expect, vi } from "vitest";
import { OutboundHandler } from "../../src/handlers/outbound.js";
import type { OutgoingEvent } from "../../src/chatwoot/webhookServer.js";

function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
const baseEvt: OutgoingEvent = { sourceId: "user:1", content: "hi", chatwootMessageId: 10, inboxId: 5, attachments: [] };

function deps(over: Partial<Record<string, any>> = {}) {
  const mapping = {
    findByChatwootMessageId: vi.fn(async () => null),
    findByZaloMsgId: vi.fn(async () => null),
    recordIfNew: vi.fn(async () => {}),
    ...over.mapping,
  };
  const accounts = { findByInboxIdentifier: vi.fn(async () => ({ id: 3 })), ...over.accounts };
  const sessions = {
    has: vi.fn(() => true),
    sendText: vi.fn(async () => ({ msgId: "m1" })),
    sendAttachment: vi.fn(async () => ({ msgId: "m2" })),
    ...over.sessions,
  };
  return { mapping, accounts, sessions };
}

describe("OutboundHandler logging", () => {
  it("logs outbound_sent after a successful text send", async () => {
    const log = makeLog();
    const { mapping, accounts, sessions } = deps();
    const h = new OutboundHandler(sessions as any, accounts as any, () => "ident", mapping as any, "http://cw", async () => {}, log);
    await h.handle(baseEvt);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "outbound_sent", accountId: 3, chatwootMessageId: 10 }),
      expect.any(String),
    );
  });

  it("logs outbound_skipped with a reason when no Zalo session is connected", async () => {
    const log = makeLog();
    const { mapping, accounts, sessions } = deps({ sessions: { has: vi.fn(() => false) } });
    const h = new OutboundHandler(sessions as any, accounts as any, () => "ident", mapping as any, "http://cw", async () => {}, log);
    await h.handle(baseEvt);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "outbound_skipped", reason: "no_session", accountId: 3 }),
      expect.any(String),
    );
    expect(sessions.sendText).not.toHaveBeenCalled();
  });
});
