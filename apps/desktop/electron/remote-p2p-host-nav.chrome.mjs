#!/usr/bin/env node
/**
 * Runtime nav guard probe (Rex 9.1 residual): location.href to an external URL
 * must stay on the shipped remote-p2p-host.html file:// page.
 *
 *   node apps/desktop/electron/remote-p2p-host-nav.chrome.mjs
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
const hostHtml = path.join(here, "remote-p2p-host.html");
const hostPreload = path.join(here, "remote-p2p-host-preload.cjs");
const hostModule = path.join(here, "remote-p2p-host.mjs");

const runner = `
import { app, BrowserWindow } from "electron";

const HOST_HTML = process.env.AIKING_P2P_HOST_HTML;
const HOST_PRELOAD = process.env.AIKING_P2P_HOST_PRELOAD;
const HOST_MODULE = process.env.AIKING_P2P_HOST_MODULE;

app.whenReady().then(async () => {
  const { installP2pHostNavigationGuards } = await import(pathToFileURL(HOST_MODULE).href);
  const win = new BrowserWindow({
    show: false,
    width: 8,
    height: 8,
    webPreferences: {
      preload: HOST_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  installP2pHostNavigationGuards(win.webContents, HOST_HTML);
  await win.loadFile(HOST_HTML);
  const before = win.webContents.getURL();
  try {
    await win.webContents.executeJavaScript('location.href = "https://example.com/"');
  } catch {
    /* navigation may reject */
  }
  await new Promise((r) => setTimeout(r, 250));
  const after = win.webContents.getURL();
  const ok = after.startsWith("file:") && after.includes("remote-p2p-host.html") && !after.includes("example.com");
  process.stdout.write(JSON.stringify({ ok, before, after }) + "\\n");
  try { win.destroy(); } catch { /* ignore */ }
  app.exit(ok ? 0 : 1);
});
`;

const dir = mkdtempSync(path.join(tmpdir(), "p2p-nav-"));
const runnerPath = path.join(dir, "nav-runner.mjs");
writeFileSync(runnerPath, runner);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [runnerPath], {
  env: {
    ...env,
    AIKING_P2P_HOST_HTML: hostHtml,
    AIKING_P2P_HOST_PRELOAD: hostPreload,
    AIKING_P2P_HOST_MODULE: hostModule,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
let err = "";
child.stdout.on("data", (chunk) => { out += chunk; });
child.stderr.on("data", (chunk) => { err += chunk; });
child.on("error", (error) => {
  rmSync(dir, { recursive: true, force: true });
  console.error("spawn failed", error);
  process.exit(1);
});
child.on("close", (code) => {
  rmSync(dir, { recursive: true, force: true });
  process.stdout.write(out);
  if (err.trim()) process.stderr.write(err);
  if (code !== 0) {
    console.error("nav guard probe failed", { code, out, err: err.slice(0, 500) });
    process.exit(code || 1);
  }
  try {
    const result = JSON.parse(out.trim().split("\n").at(-1));
    if (!result.ok) {
      console.error("external navigation was not blocked", result);
      process.exit(1);
    }
    console.log("nav guard ok: external location.href blocked");
    process.exit(0);
  } catch (error) {
    console.error("bad probe output", out, error);
    process.exit(1);
  }
});
