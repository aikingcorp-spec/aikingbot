import { describe, it, expect, vi } from "vitest";
import { ConsultationTracker } from "../../src/zalo-oa/consultationTracker.js";

function repo(window: { lastInboundAt: Date | null; sentCount: number }) {
  return {
    markInbound: vi.fn(async () => {}),
    getWindow: vi.fn(async () => window),
    setCsCount: vi.fn(async () => {}),
  };
}

describe("ConsultationTracker", () => {
  it("onInbound marks the conversation", async () => {
    const r = repo({ lastInboundAt: null, sentCount: 0 });
    const t = new ConsultationTracker(r as any, vi.fn());
    await t.onInbound(3, "oa-user:u1");
    expect(r.markInbound).toHaveBeenCalledWith(3, "oa-user:u1");
  });

  it("onOutbound within window increments the count and posts no note below threshold", async () => {
    const r = repo({ lastInboundAt: new Date(), sentCount: 1 });
    const postNote = vi.fn(async () => {});
    await new ConsultationTracker(r as any, postNote).onOutbound(3, "oa-user:u1");
    expect(r.setCsCount).toHaveBeenCalledWith(3, "oa-user:u1", 2);
    expect(postNote).not.toHaveBeenCalled();
  });

  it("onOutbound posts a note when evaluate returns a warning", async () => {
    const r = repo({ lastInboundAt: new Date(), sentCount: 5 }); // -> 6/8
    const postNote = vi.fn(async () => {});
    await new ConsultationTracker(r as any, postNote).onOutbound(3, "oa-user:u1");
    expect(r.setCsCount).toHaveBeenCalledWith(3, "oa-user:u1", 6);
    expect(postNote).toHaveBeenCalledWith(3, "oa-user:u1", expect.stringMatching(/6\/8/));
  });

  it("onOutbound out-of-window posts the warning and does not change the count", async () => {
    const r = repo({ lastInboundAt: null, sentCount: 4 });
    const postNote = vi.fn(async () => {});
    await new ConsultationTracker(r as any, postNote).onOutbound(3, "oa-user:u1");
    expect(r.setCsCount).not.toHaveBeenCalled();
    expect(postNote).toHaveBeenCalledWith(3, "oa-user:u1", expect.stringMatching(/Ngoài cửa sổ/));
  });
});
