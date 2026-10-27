// 1.15: if the whole window hangs or its renderer dies, reload it instead of leaving a black window.
// Bounded: at most `maxReloads` within `windowMs`, so a page that crashes on load cannot loop forever.
export function attachWindowRecovery(win, { log = () => {}, hangMs = 10_000, maxReloads = 3, windowMs = 60_000, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const reloads = [];
  let hangTimer = null;
  const reload = (why) => {
    const t = now();
    while (reloads.length && t - reloads[0] > windowMs) reloads.shift();
    if (reloads.length >= maxReloads) { log(`window-recovery: ${why}; reload limit reached, not reloading`); return false; }
    if (win.isDestroyed?.()) return false;
    reloads.push(t);
    log(`window-recovery: ${why}; reloading`);
    win.webContents.reload();
    return true;
  };
  const onUnresponsive = () => {
    if (hangTimer) return;
    hangTimer = setTimer(() => { hangTimer = null; reload("window unresponsive"); }, hangMs);
  };
  const onResponsive = () => { if (hangTimer) { clearTimer(hangTimer); hangTimer = null; } };
  const onGone = (_event, details) => {
    const reason = details?.reason ?? "unknown";
    if (reason === "clean-exit") return;
    reload(`renderer gone (${reason})`);
  };
  win.on("unresponsive", onUnresponsive);
  win.on("responsive", onResponsive);
  win.webContents.on("render-process-gone", onGone);
  return () => {
    onResponsive();
    win.off?.("unresponsive", onUnresponsive);
    win.off?.("responsive", onResponsive);
    win.webContents.off?.("render-process-gone", onGone);
  };
}
