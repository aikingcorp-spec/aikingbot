// Copyright (c) 2026 AIKING.
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ handlers: new Map(), autoUpdater: null, load: vi.fn() }));
vi.mock("electron", () => ({ app: { isPackaged: true, getPath: () => "/unused-shipping-updater-log" }, clipboard: { writeText: vi.fn() }, ipcMain: { handle: (name, handler) => fixture.handlers.set(name, handler) } }));
vi.mock("node:module", () => ({ createRequire: () => () => { fixture.load(); return { autoUpdater: fixture.autoUpdater }; } }));

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); fixture.handlers.clear(); fixture.load.mockClear(); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllTimers(); vi.useRealTimers(); });
async function load(feed) {
  vi.stubEnv("AIKING_UPDATE_FEED", feed);
  const autoUpdater = new EventEmitter(); autoUpdater.setFeedURL = vi.fn(); autoUpdater.checkForUpdates = vi.fn(async () => ({}));
  fixture.autoUpdater = autoUpdater;
  const updater = await import("./updater.mjs"); updater.registerUpdaterIpc({ pageAllowed: () => true }); updater.startUpdater();
  await vi.advanceTimersByTimeAsync(16000);
  return { autoUpdater, state: fixture.handlers.get("update:get-state")({}) };
}
it("uses the self-hosted Windows feed by default, while non-Windows platforms remain opt-in", async () => {
  const { autoUpdater, state } = await load(undefined);
  if (process.platform === "win32") {
    expect(autoUpdater.setFeedURL).toHaveBeenCalledExactlyOnceWith({ provider: "generic", url: "https://aikingbot.srv1866690.hstgr.cloud/updates/windows/" });
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  } else {
    expect(fixture.load).not.toHaveBeenCalled();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(state.status).toBe("idle");
  }
});
it("honors an explicit off switch on Windows and other platforms", async () => {
  const { autoUpdater, state } = await load("off");
  expect(fixture.load).not.toHaveBeenCalled();
  expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  expect(state.status).toBe("idle");
});
it.each(["http://updates.example.test", "https://user:pass@updates.example.test", "invalid-url"])("rejects an unsafe release feed %s before checking", async feed => {
  const { autoUpdater, state } = await load(feed);
  expect(autoUpdater.setFeedURL).not.toHaveBeenCalled(); expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled(); expect(state.status).toBe("error");
});
it("checks only the explicitly configured HTTPS feed", async () => {
  const { autoUpdater } = await load("https://updates.example.test/aiking/");
  expect(autoUpdater.setFeedURL).toHaveBeenCalledExactlyOnceWith({ provider: "generic", url: "https://updates.example.test/aiking/" }); expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
});
