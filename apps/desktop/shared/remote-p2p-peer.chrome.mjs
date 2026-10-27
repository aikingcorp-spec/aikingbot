#!/usr/bin/env node
/**
 * Real two-peer WebRTC DataChannel test (rc8 §9.1 acceptance).
 * Uses Electron's Chromium — same runtime as the desktop P2P host.
 *
 * Headless Google Chrome via Playwright does not gather UDP host candidates in this
 * environment (only TCP 0.0.0.0:9 placeholders) → deterministic pong_timeout. (root cause of pong_timeout in lab runs).
 *
 *   node apps/desktop/shared/remote-p2p-peer.chrome.mjs
 *   AIKING_P2P_HARNESS_RUNS=20 node apps/desktop/shared/remote-p2p-peer.chrome.mjs
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const require = createRequire(path.join(desktopRoot, "package.json"));
const electronBinary = require("electron");
const RUNS = Math.max(1, Number(process.env.AIKING_P2P_HARNESS_RUNS) || 1);

const runnerSource = `
import { app, BrowserWindow } from "electron";

const html = \`<!doctype html><meta charset="utf-8"><title>p2p</title>
<script type="module">
window.runP2P = async () => {
  // Host candidates only — no STUN needed for same-process loopback/LAN.
  const cfg = { iceServers: [], iceCandidatePoolSize: 0 };
  const a = new RTCPeerConnection(cfg);
  const b = new RTCPeerConnection(cfg);

  let pong = "";
  const rpc = a.createDataChannel("rpc", { ordered: true });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("pong_timeout:" + a.connectionState + "/" + b.connectionState + "/" + rpc.readyState + "/" + a.iceConnectionState));
    }, 10000);
    b.ondatachannel = (ev) => {
      const ch = ev.channel;
      ch.onmessage = (m) => {
        if (String(m.data) === "ping") ch.send("pong");
      };
    };
    rpc.onopen = () => { try { rpc.send("ping"); } catch (e) { reject(e); } };
    rpc.onmessage = (m) => {
      if (String(m.data) === "pong") {
        clearTimeout(timer);
        pong = "ok";
        resolve("ok");
      }
    };
  });

  a.onicecandidate = (e) => { if (e.candidate) b.addIceCandidate(e.candidate).catch(() => {}); };
  b.onicecandidate = (e) => { if (e.candidate) a.addIceCandidate(e.candidate).catch(() => {}); };

  const offer = await a.createOffer();
  await a.setLocalDescription(offer);
  await b.setRemoteDescription(a.localDescription);
  const answer = await b.createAnswer();
  await b.setLocalDescription(answer);
  await a.setRemoteDescription(b.localDescription);

  await ready;
  const out = { result: pong, a: a.connectionState, b: b.connectionState, rpc: rpc.readyState, ice: a.iceConnectionState };
  a.close();
  b.close();
  return out;
};
</script>\`;

app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "default_public_and_private_interfaces");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  try {
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    const outcome = await win.webContents.executeJavaScript("window.runP2P()");
    if (!outcome || outcome.result !== "ok") {
      console.error("FAIL", JSON.stringify(outcome));
      app.exit(1);
      return;
    }
    console.log("ok   electron two-peer DataChannel ping/pong", JSON.stringify(outcome));
    app.exit(0);
  } catch (error) {
    console.error("FAIL", error?.message || error);
    app.exit(1);
  } finally {
    try { win.destroy(); } catch { /* closed */ }
  }
});
`;

function runOnce(index) {
  const dir = mkdtempSync(path.join(tmpdir(), "p2p-harness-"));
  const script = path.join(dir, "run.mjs");
  writeFileSync(script, runnerSource);
  return new Promise((resolve) => {
    const child = spawn(electronBinary, [script], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "",
        // Headless-friendly; ICE still gets real UDP host cands under Electron.
        DISPLAY: process.env.DISPLAY || ":99",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    child.on("exit", (code) => {
      rmSync(dir, { recursive: true, force: true });
      const ok = code === 0 && /ok\s+electron two-peer/.test(out);
      if (!ok) {
        process.stderr.write(`run ${index}: FAIL code=${code}\n${out}${err}\n`);
      } else {
        process.stdout.write(`run ${index}: ${out.trim()}\n`);
      }
      resolve(ok);
    });
  });
}

let passed = 0;
for (let i = 1; i <= RUNS; i++) {
  const ok = await runOnce(i);
  if (!ok) {
    console.error(`FAIL after ${passed}/${RUNS} consecutive passes`);
    process.exit(1);
  }
  passed++;
}
console.log(`ok   ${passed}/${RUNS} consecutive electron two-peer passes`);
process.exit(0);
