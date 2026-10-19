import { describe, it, expect, vi } from "vitest";
import { SessionManager } from "../../src/zalo/sessionManager.js";
import { ZaloApi, ZaloThreadKind, IncomingMessage } from "../../src/zalo/types.js";

function fakeApi(): ZaloApi {
  return {
    sendText: vi.fn(async () => ({ msgId: "x1" })),
    sendAttachment: vi.fn(async () => ({ msgId: "x2" })),
    getUserInfo: vi.fn(async (uid) => ({ uid, displayName: "N" })),
    onMessage: vi.fn((_cb: (m: IncomingMessage) => void) => {}),
    onReaction: vi.fn(),
    onUndo: vi.fn(),
    onClosed: vi.fn((_cb: (code: number, reason: string) => void) => {}),
    getSerializedCookie: vi.fn(() => null),
    stop: vi.fn(async () => {}),
  };
}

describe("SessionManager", () => {
  it("registers a session and routes sendText", async () => {
    const api = fakeApi();
    const mgr = new SessionManager();
    mgr.register(1, api);
    const res = await mgr.sendText(1, "84900", ZaloThreadKind.User, "hi");
    expect(res.msgId).toBe("x1");
    expect(api.sendText).toHaveBeenCalledWith("84900", ZaloThreadKind.User, "hi", undefined);
  });

  it("throws when sending to an unknown account", async () => {
    const mgr = new SessionManager();
    await expect(mgr.sendText(99, "t", ZaloThreadKind.User, "x")).rejects.toThrow(/no active session/i);
  });

  it("routes sendText through a registered OA sender", async () => {
    const sender = { sendText: vi.fn(async () => ({ msgId: "z9" })), sendAttachment: vi.fn() };
    const mgr = new SessionManager();
    mgr.registerSender(7, sender as any);
    const res = await mgr.sendText(7, "u1", ZaloThreadKind.OaUser, "hi");
    expect(res.msgId).toBe("z9");
    expect(sender.sendText).toHaveBeenCalledWith("u1", ZaloThreadKind.OaUser, "hi", undefined);
  });
});

describe("SessionManager.remove", () => {
  it("stops a personal adapter and clears it from the session map", async () => {
    const sm = new SessionManager();
    const api: any = { onClosed: vi.fn(), onMessage: vi.fn(), onReaction: vi.fn(), onUndo: vi.fn(), stop: vi.fn(async () => {}) };
    sm.register(1, api);
    expect(sm.has(1)).toBe(true);
    await sm.remove(1);
    expect(api.stop).toHaveBeenCalledTimes(1);
    expect(sm.has(1)).toBe(false);
  });

  it("drops an OA sender and is a no-op for an unknown account", async () => {
    const sm = new SessionManager();
    sm.registerSender(2, { sendText: vi.fn(), sendAttachment: vi.fn() } as any);
    await sm.remove(2);
    expect(sm.has(2)).toBe(false);
    await expect(sm.remove(999)).resolves.toBeUndefined();
  });

  it("swallows an adapter stop() error", async () => {
    const sm = new SessionManager();
    const api: any = { onClosed: vi.fn(), stop: vi.fn(async () => { throw new Error("already closed"); }) };
    sm.register(3, api);
    await expect(sm.remove(3)).resolves.toBeUndefined();
    expect(sm.has(3)).toBe(false);
  });
});
