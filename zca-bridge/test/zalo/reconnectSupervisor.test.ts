import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { isZaloAuthError, ReconnectSupervisor, type ReconnectDeps, type SupervisedAdapter } from "../../src/zalo/reconnectSupervisor.js";

describe("isZaloAuthError", () => {
  it("flags credential/session messages as auth errors", () => {
    expect(isZaloAuthError(new Error("Invalid cookie"))).toBe(true);
    expect(isZaloAuthError(new Error("login failed: credential rejected"))).toBe(true);
    expect(isZaloAuthError(new Error("session expired, please re-login"))).toBe(true);
    expect(isZaloAuthError(new Error("Cookie đăng nhập không hợp lệ"))).toBe(true);
  });

  it("treats network/unknown errors as non-auth (retryable)", () => {
    expect(isZaloAuthError(new Error("fetch failed"))).toBe(false);
    expect(isZaloAuthError(new Error("ETIMEDOUT"))).toBe(false);
    expect(isZaloAuthError(new Error("socket hang up"))).toBe(false);
    expect(isZaloAuthError(undefined)).toBe(false);
    expect(isZaloAuthError("boom")).toBe(false);
  });

  it("treats proxy/tunnel auth failures as non-auth (retryable)", () => {
    expect(isZaloAuthError(new Error("407 Proxy Authentication Required"))).toBe(false);
    expect(isZaloAuthError(new Error("tunneling socket could not be established"))).toBe(false);
  });
});

function fakeAdapter(): SupervisedAdapter & { fireClose: (code: number, reason?: string) => void } {
  let closeCb: (code: number, reason: string) => void = () => {};
  return {
    onClosed: (cb) => { closeCb = cb; },
    getSerializedCookie: () => ({ cookies: [{ key: "zpsid", value: "fresh" }] }),
    stop: vi.fn(async () => {}),
    fireClose: (code, reason = "x") => closeCb(code, reason),
  };
}

function makeDeps(overrides: Partial<ReconnectDeps> = {}) {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const adapter = fakeAdapter();
  const deps: ReconnectDeps = {
    loadCredentials: vi.fn(async () => ({ imei: "i", cookie: { cookies: [{ key: "zpsid", value: "old" }] }, userAgent: "ua" })),
    saveCredentials: vi.fn(async () => {}),
    createAdapter: vi.fn(async (_accountId: number, _creds: unknown) => adapter),
    isAuthError: () => false,
    register: vi.fn(),
    unregister: vi.fn(async () => {}),
    bindInbound: vi.fn(),
    setStatus: vi.fn(async () => {}),
    schedule: vi.fn(() => ({ cancel: vi.fn() })),
    log: log as unknown as ReconnectDeps["log"],
    ...overrides,
  };
  return { deps, adapter };
}

describe("ReconnectSupervisor.connect (success)", () => {
  it("registers, binds, marks connected, and persists the refreshed cookie", async () => {
    const { deps, adapter } = makeDeps();
    const sup = new ReconnectSupervisor(deps);

    await sup.connect(7);

    expect(deps.createAdapter).toHaveBeenCalledOnce();
    expect(deps.register).toHaveBeenCalledWith(7, adapter);
    expect(deps.bindInbound).toHaveBeenCalledWith(7);
    expect(deps.setStatus).toHaveBeenCalledWith(7, "connected");
    // cookie merged onto loaded credentials and re-saved
    expect(deps.saveCredentials).toHaveBeenCalledWith(7, {
      imei: "i",
      cookie: { cookies: [{ key: "zpsid", value: "fresh" }] },
      userAgent: "ua",
    });
    expect(deps.schedule).not.toHaveBeenCalled();
  });

  it("does nothing when there are no stored credentials", async () => {
    const { deps } = makeDeps({ loadCredentials: vi.fn(async () => null) });
    const sup = new ReconnectSupervisor(deps);

    await sup.connect(7);

    expect(deps.createAdapter).not.toHaveBeenCalled();
    expect(deps.setStatus).not.toHaveBeenCalled();
  });

  it("ignores a second connect() call while one is already in flight", async () => {
    let resolve!: () => void;
    const { deps } = makeDeps({
      createAdapter: vi.fn(() => new Promise<SupervisedAdapter>((r) => { resolve = () => r(fakeAdapter()); })),
    });
    const sup = new ReconnectSupervisor(deps);
    const p1 = sup.connect(7);
    // allow the microtask queue to advance so loadCredentials resolves and
    // createAdapter is called (and resolve is assigned) before we call it
    await Promise.resolve();
    const p2 = sup.connect(7); // second call while first is still awaiting createAdapter
    resolve();
    await Promise.all([p1, p2]);
    expect(deps.createAdapter).toHaveBeenCalledOnce();
  });
});

describe("ReconnectSupervisor.onClosed", () => {
  it("ignores a manual close (code 1000) — no reconnect, no status change", async () => {
    const { deps, adapter } = makeDeps();
    const sup = new ReconnectSupervisor(deps);
    await sup.connect(7);
    (deps.setStatus as ReturnType<typeof vi.fn>).mockClear();

    adapter.fireClose(1000, "manual");

    expect(deps.schedule).not.toHaveBeenCalled();
    expect(deps.setStatus).not.toHaveBeenCalled();
  });

  it("on a non-manual close: unregisters, marks reconnecting, schedules a retry", async () => {
    let scheduled: (() => void) | null = null;
    const cancel = vi.fn();
    const { deps, adapter } = makeDeps({
      schedule: vi.fn((fn) => { scheduled = fn; return { cancel }; }),
    });
    const sup = new ReconnectSupervisor(deps);
    await sup.connect(7);

    adapter.fireClose(1006, "abnormal");

    expect(deps.unregister).toHaveBeenCalledWith(7);
    expect(deps.setStatus).toHaveBeenCalledWith(7, "reconnecting");
    expect(deps.schedule).toHaveBeenCalledTimes(1);
    expect((deps.schedule as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe(5_000); // first backoff

    // firing the scheduled callback reconnects
    expect(scheduled).not.toBeNull();
    await scheduled!();
    expect(deps.createAdapter).toHaveBeenCalledTimes(2);
    expect(deps.setStatus).toHaveBeenLastCalledWith(7, "connected");
  });

  it("does not resurrect a session that closes while connect() is finishing", async () => {
    let releaseStatus!: () => void;
    const setStatus = vi.fn((_id: number, status: string) =>
      status === "connected"
        ? new Promise<void>((r) => { releaseStatus = r; })
        : Promise.resolve());
    const { deps, adapter } = makeDeps({
      setStatus: setStatus as unknown as ReconnectDeps["setStatus"],
      schedule: vi.fn(() => ({ cancel: vi.fn() })),
    });
    const sup = new ReconnectSupervisor(deps);

    const p = sup.connect(7);
    // Let connect() advance to awaiting setStatus("connected"), then fire a close.
    await new Promise((r) => setTimeout(r, 0));
    adapter.fireClose(1006, "abnormal");
    releaseStatus();
    await p;

    // onClosed must have scheduled a reconnect, and connect() must NOT have persisted
    // the dead session's cookie afterwards.
    expect(deps.schedule).toHaveBeenCalled();
    expect(deps.saveCredentials).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenLastCalledWith(7, "reconnecting");
  });

  it("escalates the backoff on repeated network failures and caps it", async () => {
    const delays: number[] = [];
    const { deps } = makeDeps({
      createAdapter: vi.fn(async () => { throw new Error("fetch failed"); }),
      schedule: vi.fn((_fn, ms) => { delays.push(ms); return { cancel: vi.fn() }; }),
    });
    const sup = new ReconnectSupervisor(deps);

    // each connect fails with a network error and schedules the next attempt
    await sup.connect(7);
    await sup.connect(7);
    await sup.connect(7);
    await sup.connect(7);
    await sup.connect(7);
    await sup.connect(7);

    expect(delays).toEqual([5_000, 15_000, 45_000, 120_000, 300_000, 300_000]);
  });
});

describe("ReconnectSupervisor.connect (failure classification)", () => {
  it("auth failure → expired, no reconnect scheduled", async () => {
    const { deps } = makeDeps({
      createAdapter: vi.fn(async () => { throw new Error("Invalid cookie"); }),
      isAuthError: (err) => isZaloAuthError(err),
    });
    const sup = new ReconnectSupervisor(deps);

    await sup.connect(7);

    expect(deps.setStatus).toHaveBeenCalledWith(7, "expired");
    expect(deps.schedule).not.toHaveBeenCalled();
  });

  it("network failure → reconnecting + scheduled", async () => {
    const { deps } = makeDeps({
      createAdapter: vi.fn(async () => { throw new Error("ETIMEDOUT"); }),
      isAuthError: (err) => isZaloAuthError(err),
    });
    const sup = new ReconnectSupervisor(deps);

    await sup.connect(7);

    expect(deps.setStatus).toHaveBeenCalledWith(7, "reconnecting");
    expect(deps.schedule).toHaveBeenCalledOnce();
  });
});

describe("ReconnectSupervisor.persistAllCookies", () => {
  it("re-saves the live cookie for every connected account", async () => {
    const { deps } = makeDeps();
    const sup = new ReconnectSupervisor(deps);
    await sup.connect(7);
    (deps.saveCredentials as ReturnType<typeof vi.fn>).mockClear();
    (deps.loadCredentials as ReturnType<typeof vi.fn>).mockClear();

    await sup.persistAllCookies();

    expect(deps.saveCredentials).toHaveBeenCalledWith(7, {
      imei: "i",
      cookie: { cookies: [{ key: "zpsid", value: "fresh" }] },
      userAgent: "ua",
    });
  });
});

describe("ReconnectSupervisor.remove", () => {
  it("cancels a pending timer, unregisters, and ignores later closes", async () => {
    const cancel = vi.fn();
    let scheduled: (() => void) | null = null;
    const { deps, adapter } = makeDeps({
      schedule: vi.fn((fn) => { scheduled = fn; return { cancel }; }),
    });
    const sup = new ReconnectSupervisor(deps);
    await sup.connect(7);
    adapter.fireClose(1006, "abnormal"); // schedules a reconnect
    (deps.setStatus as ReturnType<typeof vi.fn>).mockClear();

    await sup.remove(7);

    expect(cancel).toHaveBeenCalled();
    expect(deps.unregister).toHaveBeenCalledWith(7);
    // a late close after removal must not reconnect or change status
    adapter.fireClose(1006, "late");
    expect(deps.setStatus).not.toHaveBeenCalled();
  });
});
