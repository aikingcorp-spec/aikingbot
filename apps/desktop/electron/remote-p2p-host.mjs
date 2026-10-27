/**
 * Slice B — Electron host for rc8 §9.1 remote P2P.
 * Hidden BrowserWindow owns RTCPeerConnection (UDP host candidates).
 * Bridges signal frames via the local gateway:
 *   GET  /api/aiking/remote/p2p/inbox
 *   POST /api/aiking/remote/p2p/outbox
 * Feature-flagged by AIKING_REMOTE_P2P. Thick module; main.mjs only start/stop.
 *
 * Security: contextIsolation + sandbox + no nodeIntegration + webSecurity;
 * renderer talks only through remote-p2p-host-preload.cjs (contextBridge).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const HOST_HTML = path.join(__dirname, "remote-p2p-host.html");
const HOST_PRELOAD = path.join(__dirname, "remote-p2p-host-preload.cjs");

const CHANNEL_OUTBOX = "aiking-remote-p2p-outbox";
const CHANNEL_PATH = "aiking-remote-p2p-path";
const CHANNEL_LOG = "aiking-remote-p2p-log";
const CHANNEL_INBOX = "aiking-remote-p2p-inbox";
const CHANNEL_START = "aiking-remote-p2p-start";
const CHANNEL_STOP = "aiking-remote-p2p-stop";
const CHANNEL_STATUS = "aiking-remote-p2p-status";

const SIGNAL_KINDS = new Set(["hello", "offer", "answer", "ice", "bye", "path"]);
const PATH_LABELS = new Set(["p2p", "turn", "relay"]);
const MAX_SDP_CHARS = 256 * 1024;
const MAX_LOG_CHARS = 2_000;
const MAX_SID_CHARS = 128;

/** Lazy — keeps this module importable from plain Node unit tests for the flag helper. */
function electron() {
  return require("electron");
}

let hostWindow = null;
let pollTimer = null;
let stopped = true;
let ipcWired = false;
let currentGatewayOrigin = "http://127.0.0.1:18789";
let activeLog = defaultLog;

function defaultLog(line) {
  try { console.log(`[remote-p2p-host] ${line}`); } catch { /* ignore */ }
}

/** Pure — exported for unit tests. */
export function isValidPathLabel(value) {
  return typeof value === "string" && PATH_LABELS.has(value);
}

/** Pure — exported for unit tests. */
export function isValidLogLine(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_LOG_CHARS;
}


/**
 * Pure — only the shipped host HTML may load in the hidden P2P window.
 * Exported for unit tests.
 * @param {string} targetUrl
 * @param {string} [hostHtmlPath]
 */
export function isAllowedP2pHostNavigation(targetUrl, hostHtmlPath = HOST_HTML) {
  if (typeof targetUrl !== "string" || !targetUrl) return false;
  try {
    const url = new URL(targetUrl);
    if (url.protocol !== "file:") return false;
    const targetPath = fileURLToPath(url);
    return path.resolve(targetPath) === path.resolve(hostHtmlPath);
  } catch {
    return false;
  }
}

/**
 * Lock the hidden host window to the shipped file URL; deny window.open.
 * Exported so the nav probe can install the same guards.
 * @param {import("electron").WebContents} webContents
 * @param {string} [hostHtmlPath]
 */
export function installP2pHostNavigationGuards(webContents, hostHtmlPath = HOST_HTML) {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const guard = (event, url) => {
    if (isAllowedP2pHostNavigation(url, hostHtmlPath)) return;
    event.preventDefault();
  };
  webContents.on("will-navigate", guard);
  webContents.on("will-redirect", guard);
}


/**
 * Pure — validate a host→gateway signal frame before POSTing.
 * Accepts host outbox shapes: { t:"signal", from, sid, kind, sdp?, candidate?, path? }.
 */
export function isValidOutboxFrame(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const frame = /** @type {Record<string, unknown>} */ (value);
  if (frame.t !== undefined && frame.t !== "signal") return false;
  if (frame.from !== undefined && typeof frame.from !== "string") return false;
  if (frame.sid !== undefined) {
    if (typeof frame.sid !== "string" || frame.sid.length === 0 || frame.sid.length > MAX_SID_CHARS) {
      return false;
    }
  }
  if (typeof frame.kind !== "string" || !SIGNAL_KINDS.has(frame.kind)) return false;
  if (frame.kind === "offer" || frame.kind === "answer") {
    if (typeof frame.sdp !== "string" || frame.sdp.length === 0 || frame.sdp.length > MAX_SDP_CHARS) {
      return false;
    }
  }
  if (frame.kind === "ice") {
    // null candidate = end-of-candidates; object otherwise
    if (frame.candidate !== null && frame.candidate !== undefined) {
      if (typeof frame.candidate !== "object" || Array.isArray(frame.candidate)) return false;
    }
  }
  if (frame.kind === "path") {
    if (!isValidPathLabel(frame.path)) return false;
  }
  return true;
}

function isHostSender(event) {
  return Boolean(
    hostWindow
    && !hostWindow.isDestroyed()
    && event?.sender
    && event.sender === hostWindow.webContents,
  );
}

function ensureIpc() {
  if (ipcWired) return;
  ipcWired = true;
  const { ipcMain } = electron();

  ipcMain.on(CHANNEL_LOG, (event, line) => {
    if (!isHostSender(event)) return;
    if (!isValidLogLine(line)) return;
    activeLog(line);
  });

  ipcMain.on(CHANNEL_PATH, (event, payload) => {
    if (!isHostSender(event)) return;
    const pathLabel = typeof payload === "string" ? payload : payload?.path;
    const switching = typeof payload === "object" && payload !== null && payload.switching === true;
    if (!isValidPathLabel(pathLabel)) return;
    activeLog(switching ? `path=${pathLabel}:switching` : `path=${pathLabel}`);
    void postJson(currentGatewayOrigin, "/api/aiking/remote/p2p/path", { path: pathLabel, switching }).catch(() => {});
  });

  ipcMain.on(CHANNEL_OUTBOX, (event, frame) => {
    if (!isHostSender(event)) return;
    if (!isValidOutboxFrame(frame)) {
      activeLog("outbox-rejected:invalid-frame");
      return;
    }
    void postJson(currentGatewayOrigin, "/api/aiking/remote/p2p/outbox", frame).catch((err) => {
      activeLog(`outbox-failed:${err?.message || err}`);
    });
  });

  ipcMain.handle(CHANNEL_STATUS, (event) => {
    if (!isHostSender(event)) return { ok: false, reason: "forbidden" };
    return {
      ok: true,
      running: isRemoteP2pHostRunning(),
      gatewayOrigin: currentGatewayOrigin,
    };
  });
}

async function postJson(origin, p, body) {
  const response = await fetch(`${origin}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${p} → ${response.status}`);
  return response.json().catch(() => ({}));
}

async function getJson(origin, p) {
  const response = await fetch(`${origin}${p}`);
  if (!response.ok) throw new Error(`GET ${p} → ${response.status}`);
  return response.json();
}

/**
 * Start the hidden P2P host. No-op when AIKING_REMOTE_P2P is off.
 * @param {{ gatewayOrigin: string; log?: (line: string) => void; iceServers?: object[]; pollMs?: number }} options
 */
export async function startRemoteP2pHost(options) {
  const log = options.log || defaultLog;
  activeLog = log;
  if (process.env.AIKING_REMOTE_P2P !== "1" && process.env.AIKING_REMOTE_P2P !== "true") {
    log("skip: AIKING_REMOTE_P2P off");
    return { started: false, reason: "flag_off" };
  }
  if (hostWindow && !hostWindow.isDestroyed()) {
    log("already-running");
    return { started: true, reason: "already" };
  }
  currentGatewayOrigin = String(options.gatewayOrigin || "http://127.0.0.1:18789").replace(/\/$/, "");
  ensureIpc();
  stopped = false;

  hostWindow = new electron().BrowserWindow({
    show: false,
    width: 8,
    height: 8,
    webPreferences: {
      preload: HOST_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // No remote content; ship HTML+JS beside this module and loadFile them.
      allowRunningInsecureContent: false,
    },
  });
  // Deny every navigation/window-open except the shipped local host file (Rex 9.1 nav residual).
  installP2pHostNavigationGuards(hostWindow.webContents, HOST_HTML);
  await hostWindow.loadFile(HOST_HTML);
  hostWindow.webContents.send(CHANNEL_START, {
    sid: "desktop-host",
    iceServers: options.iceServers || [{ urls: "stun:stun.cloudflare.com:3478" }],
  });

  const pollMs = options.pollMs ?? 250;
  const tick = async () => {
    if (stopped || !hostWindow || hostWindow.isDestroyed()) return;
    try {
      const body = await getJson(currentGatewayOrigin, "/api/aiking/remote/p2p/inbox");
      const frames = Array.isArray(body?.frames) ? body.frames : [];
      for (const frame of frames) {
        if (!hostWindow || hostWindow.isDestroyed()) break;
        hostWindow.webContents.send(CHANNEL_INBOX, frame);
      }
    } catch (err) {
      log(`inbox-poll:${err?.message || err}`);
    }
    if (!stopped) pollTimer = setTimeout(tick, pollMs);
  };
  pollTimer = setTimeout(tick, pollMs);
  log("started");
  return { started: true };
}

export function stopRemoteP2pHost() {
  stopped = true;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  try { hostWindow?.webContents?.send(CHANNEL_STOP); } catch { /* ignore */ }
  try { if (hostWindow && !hostWindow.isDestroyed()) hostWindow.destroy(); } catch { /* ignore */ }
  hostWindow = null;
}

export function isRemoteP2pHostRunning() {
  return Boolean(hostWindow && !hostWindow.isDestroyed() && !stopped);
}

/** Pure helper for unit tests (no Electron). */
export function isP2pFlagOn(env = process.env) {
  return env.AIKING_REMOTE_P2P === "1" || env.AIKING_REMOTE_P2P === "true";
}
