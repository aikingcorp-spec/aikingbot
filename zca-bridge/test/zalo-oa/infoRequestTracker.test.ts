import { describe, it, expect, vi } from "vitest";
import { InfoRequestTracker } from "../../src/zalo-oa/infoRequestTracker.js";

function deps(overrides: any = {}) {
  const conversations = {
    getInfoRequestedAt: vi.fn(async () => null),
    claimInfoRequest: vi.fn(async () => true),
    releaseInfoRequest: vi.fn(async () => {}),
    ...overrides.conversations,
  };
  const infoCard = {
    get: vi.fn(async () => ({ enabled: true, title: "T", subtitle: "S", imageUrl: "https://x/y.png" })),
    ...overrides.infoCard,
  };
  const send = overrides.send ?? vi.fn(async () => ({ ok: true, code: 0, message: "" }));
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const now = () => new Date("2026-06-03T00:00:00Z");
  return { conversations, infoCard, send, log, now };
}

describe("InfoRequestTracker.onInbound", () => {
  it("claims and sends the card when not yet requested", async () => {
    const d = deps();
    const t = new InfoRequestTracker(d.conversations as any, d.infoCard as any, d.send, d.log as any, d.now);
    await t.onInbound(5, "oa-user:u1");
    expect(d.conversations.claimInfoRequest).toHaveBeenCalledWith(5, "oa-user:u1", d.now());
    expect(d.send).toHaveBeenCalledWith(5, "u1", { title: "T", subtitle: "S", imageUrl: "https://x/y.png" });
    expect(d.conversations.releaseInfoRequest).not.toHaveBeenCalled();
  });

  it("skips when already requested (fast path)", async () => {
    const d = deps({ conversations: { getInfoRequestedAt: vi.fn(async () => new Date()) } });
    const t = new InfoRequestTracker(d.conversations as any, d.infoCard as any, d.send, d.log as any, d.now);
    await t.onInbound(5, "oa-user:u1");
    expect(d.conversations.claimInfoRequest).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("skips when the claim is lost (concurrent race / no row)", async () => {
    const d = deps({ conversations: { claimInfoRequest: vi.fn(async () => false) } });
    const t = new InfoRequestTracker(d.conversations as any, d.infoCard as any, d.send, d.log as any, d.now);
    await t.onInbound(5, "oa-user:u1");
    expect(d.send).not.toHaveBeenCalled();
  });

  it("skips and logs when the card is disabled or has no image", async () => {
    const d = deps({ infoCard: { get: vi.fn(async () => ({ enabled: false, title: "T", subtitle: "S", imageUrl: "" })) } });
    const t = new InfoRequestTracker(d.conversations as any, d.infoCard as any, d.send, d.log as any, d.now);
    await t.onInbound(5, "oa-user:u1");
    expect(d.conversations.claimInfoRequest).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(d.log.info).toHaveBeenCalledWith(expect.objectContaining({ event: "info_request_not_configured" }), expect.any(String));
  });

  it("keeps the claim (ask-once) when Zalo returns an error code", async () => {
    const send = vi.fn(async () => ({ ok: false, code: -213, message: "quota" }));
    const d = deps({ send });
    const t = new InfoRequestTracker(d.conversations as any, d.infoCard as any, d.send, d.log as any, d.now);
    await t.onInbound(5, "oa-user:u1");
    expect(d.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "info_request_failed", code: -213 }), expect.any(String));
    expect(d.conversations.releaseInfoRequest).not.toHaveBeenCalled();
  });

  it("releases the claim on a network throw (so it retries later)", async () => {
    const send = vi.fn(async () => { throw new Error("network"); });
    const d = deps({ send });
    const t = new InfoRequestTracker(d.conversations as any, d.infoCard as any, d.send, d.log as any, d.now);
    await t.onInbound(5, "oa-user:u1");
    expect(d.conversations.releaseInfoRequest).toHaveBeenCalledWith(5, "oa-user:u1");
    expect(d.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "info_request_failed" }), expect.any(String));
  });
});
