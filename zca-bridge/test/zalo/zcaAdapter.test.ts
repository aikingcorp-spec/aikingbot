import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { ZcaAdapter } from "../../src/zalo/zcaAdapter.js";

// Build a ZcaAdapter around a fake zca-js `api` with a real EventEmitter listener.
function adapterWithFakeApi(cookieJar: unknown) {
  const listener = new EventEmitter();
  const api = {
    listener,
    getCookie: () => cookieJar,
  };
  // ZcaAdapter's constructor is private; reach it via the same shape fromCredentials returns.
  const adapter = new (ZcaAdapter as unknown as { new (api: unknown): ZcaAdapter })(api);
  return { adapter, listener };
}

describe("ZcaAdapter.onClosed", () => {
  it("fires only on the terminal `closed` event and forwards the code", () => {
    const { adapter, listener } = adapterWithFakeApi(null);
    const cb = vi.fn();
    adapter.onClosed(cb);

    listener.emit("disconnected", 1006, "blip"); // transient — must be ignored
    expect(cb).not.toHaveBeenCalled();

    listener.emit("closed", 3003, "kicked"); // terminal
    expect(cb).toHaveBeenCalledWith(3003, "kicked");
  });
});

describe("ZcaAdapter.getSerializedCookie", () => {
  it("serializes the live cookie jar via toJSON()", () => {
    const jar = { toJSON: () => ({ cookies: [{ key: "zpsid", value: "fresh" }] }) };
    const { adapter } = adapterWithFakeApi(jar);
    expect(adapter.getSerializedCookie()).toEqual({ cookies: [{ key: "zpsid", value: "fresh" }] });
  });

  it("returns null when no cookie is available", () => {
    const { adapter } = adapterWithFakeApi(null);
    expect(adapter.getSerializedCookie()).toBeNull();
  });
});
