import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { attachWindowRecovery } from "./window-recovery.mjs";

function fakeWindow() {
  const win = new EventEmitter();
  win.webContents = new EventEmitter();
  win.webContents.reloads = 0;
  win.webContents.reload = () => { win.webContents.reloads += 1; };
  win.isDestroyed = () => false;
  return win;
}
function clock() {
  let t = 0; const timers = new Map(); let id = 0;
  return {
    now: () => t,
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: t + ms }); return id; },
    clearTimer: (h) => timers.delete(h),
    advance(ms) { t += ms; for (const [k, v] of timers) if (v.at <= t) { timers.delete(k); v.fn(); } },
  };
}

test("a hang longer than hangMs reloads; a recovered hang does not", () => {
  const win = fakeWindow(); const c = clock();
  attachWindowRecovery(win, { ...c, hangMs: 10_000 });
  win.emit("unresponsive"); c.advance(5_000); win.emit("responsive"); c.advance(10_000);
  assert.equal(win.webContents.reloads, 0);
  win.emit("unresponsive"); c.advance(10_000);
  assert.equal(win.webContents.reloads, 1);
});

test("a crashed renderer reloads, a clean exit does not, and reloads are capped", () => {
  const win = fakeWindow(); const c = clock(); const logs = [];
  attachWindowRecovery(win, { ...c, maxReloads: 3, windowMs: 60_000, log: (l) => logs.push(l) });
  win.webContents.emit("render-process-gone", {}, { reason: "clean-exit" });
  assert.equal(win.webContents.reloads, 0);
  for (let i = 0; i < 5; i++) win.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  assert.equal(win.webContents.reloads, 3);
  assert.ok(logs.some((l) => l.includes("limit reached")));
  c.advance(61_000);
  win.webContents.emit("render-process-gone", {}, { reason: "oom" });
  assert.equal(win.webContents.reloads, 4);
});

test("detach removes every listener", () => {
  const win = fakeWindow();
  const detach = attachWindowRecovery(win);
  detach();
  assert.equal(win.listenerCount("unresponsive") + win.listenerCount("responsive") + win.webContents.listenerCount("render-process-gone"), 0);
});
