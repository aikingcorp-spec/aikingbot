/**
 * Sandboxed preload for the hidden remote-P2P host window.
 * Renderer sees only window.aikingRemoteP2p — never ipcRenderer or Node.
 */
const { contextBridge, ipcRenderer } = require("electron");

const CHANNEL_OUTBOX = "aiking-remote-p2p-outbox";
const CHANNEL_PATH = "aiking-remote-p2p-path";
const CHANNEL_LOG = "aiking-remote-p2p-log";
const CHANNEL_INBOX = "aiking-remote-p2p-inbox";
const CHANNEL_START = "aiking-remote-p2p-start";
const CHANNEL_STOP = "aiking-remote-p2p-stop";
const CHANNEL_STATUS = "aiking-remote-p2p-status";

contextBridge.exposeInMainWorld("aikingRemoteP2p", {
  /** Host → main: signal frame for the gateway outbox. */
  sendOutbox(frame) {
    if (!frame || typeof frame !== "object") return;
    ipcRenderer.send(CHANNEL_OUTBOX, frame);
  },
  /** Host → main: negotiated path label (+ optional switching handoff flag). */
  sendPath(pathLabel, switching) {
    if (typeof pathLabel !== "string") return;
    ipcRenderer.send(CHANNEL_PATH, { path: pathLabel, switching: switching === true });
  },
  /** Host → main: short diagnostic line (no secrets). */
  sendLog(line) {
    if (typeof line !== "string") return;
    ipcRenderer.send(CHANNEL_LOG, line);
  },
  /** Host → main: ask for current status (optional). */
  requestStatus() {
    return ipcRenderer.invoke(CHANNEL_STATUS);
  },
  /** Main → host: inbound signal frames. */
  onInbox(handler) {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, frame) => handler(frame);
    ipcRenderer.on(CHANNEL_INBOX, listener);
    return () => ipcRenderer.removeListener(CHANNEL_INBOX, listener);
  },
  /** Main → host: start session options. */
  onStart(handler) {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, opts) => handler(opts);
    ipcRenderer.on(CHANNEL_START, listener);
    return () => ipcRenderer.removeListener(CHANNEL_START, listener);
  },
  /** Main → host: tear down. */
  onStop(handler) {
    if (typeof handler !== "function") return () => {};
    const listener = () => handler();
    ipcRenderer.on(CHANNEL_STOP, listener);
    return () => ipcRenderer.removeListener(CHANNEL_STOP, listener);
  },
});
