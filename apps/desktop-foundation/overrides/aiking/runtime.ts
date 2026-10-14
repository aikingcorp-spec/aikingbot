import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, preview } from "vite";
import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = resolve(source, "..");
const offline = process.argv.includes("--offline");
const desktop = process.argv.includes("--desktop");
const core = process.argv.includes("--core");
const production = process.argv.includes("--production");
let fixture: VerificationServer | undefined;
let harness: ChildProcess | undefined;
let electron: ChildProcess | undefined;
let ui: Awaited<ReturnType<typeof createServer>> | undefined;
let previewUi: Awaited<ReturnType<typeof preview>> | undefined;
let stopping = false;
let desktopProfile: string | undefined;

async function stopChild(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    child.once("exit", () => { clearTimeout(timer); done(); });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.kill("SIGTERM");
  });
}

async function close() {
  if (stopping) return;
  stopping = true;
  await stopChild(electron);
  if (offline && desktopProfile) rmSync(desktopProfile, { recursive: true, force: true });
  await ui?.close();
  if (previewUi) await new Promise<void>((resolve) => previewUi!.httpServer.close(() => resolve()));
  if (fixture) await fixture.close();
  else await stopChild(harness);
}

const stop = () => { void close().then(() => process.exit(0)); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  let apiUrl: string;
  let dataDir: string;
  if (offline) {
    // AIKING_OFFLINE_REPLIES (a JSON array) lets UI reviews script richer offline replies; the default stays the verification text.
    fixture = await launchVerificationServer({ ...process.env, ...(core ? { AIKING_CORE_TEST: "1" } : {}), FAKE_CLAUDE_REPLIES: process.env.AIKING_OFFLINE_REPLIES ?? JSON.stringify([
      "AIKINGBOT is running. This reply came through the real chat pipeline using the offline verification provider.",
      "The saved conversation is available. The desktop foundation is ready for the next integration stage.",
    ]), FAKE_CLAUDE_TOOL_CALLS: process.env.FAKE_CLAUDE_TOOL_CALLS ?? JSON.stringify([
      { name: "Read", input: { file_path: "offline-fixture.md" }, output: "Offline tool activity fixture" },
      { name: "Glob", input: { pattern: "*.md" }, output: ["offline-fixture.md"] },
    ]) });
    apiUrl = fixture.info.url;
    dataDir = fixture.info.dataDir;
  } else {
    const port = Number(process.env.AIKING_API_PORT || 18799);
    if (!Number.isInteger(port) || port < 1024 || port > 65534) throw new Error("AIKING_API_PORT must be 1024–65534.");
    apiUrl = `http://127.0.0.1:${port}`;
    dataDir = join(runtime, "profiles/local");
    mkdirSync(dataDir, { recursive: true });
    harness = spawn(process.execPath, ["--experimental-strip-types", "server/index.ts"], {
      cwd: source, stdio: "inherit", env: { ...process.env,
        OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1), OMB_DATA_DIR: dataDir,
        OMB_ENTERPRISE_DIR: join(source, "enterprise"),
        OMB_BROWSER_CONNECTION: join(dataDir, "browser-connection.json"),
      },
    });
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (harness.exitCode !== null) throw new Error("The local harness exited before startup.");
      try {
        const response = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) break;
      } catch { }
      if (Date.now() >= deadline) throw new Error("The local harness did not become ready.");
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  const serverOptions = {
    host: "127.0.0.1", port: Number(process.env.AIKING_UI_PORT || 5199), strictPort: true,
    proxy: { "/api": { target: apiUrl, ws: true }, "/.well-known/openmausbot/environment": { target: apiUrl } },
  };
  if (production) previewUi = await preview({ root: source, preview: serverOptions });
  else { ui = await createServer({ root: source, server: serverOptions }); await ui.listen(); }
  const uiUrl = (previewUi ?? ui)?.resolvedUrls?.local[0];
  if (!uiUrl) throw new Error("Vite did not report its URL.");
  const info = { product: "AIKINGBOT", mode: offline ? "offline-verification" : "local", coreIntegrated: true, coreVerification: core,
    uiUrl, apiUrl, dataDir, pid: process.pid, harnessPid: fixture?.child.pid ?? harness?.pid,
    sourceCommit: "93b3c24cdade51e362e443d2387a9f37eb7e115c" };
  writeFileSync(join(runtime, "runtime.json"), `${JSON.stringify(info, null, 2)}\n`);
  writeFileSync(join(runtime, `${offline ? "offline" : "local"}-runtime.json`), `${JSON.stringify(info, null, 2)}\n`);
  console.log(JSON.stringify(info, null, 2));
  if (desktop) {
    const { default: binary } = await import("electron");
    const debugPort = process.env.AIKING_DESKTOP_DEBUG_PORT;
    if (debugPort && (!/^\d+$/.test(debugPort) || Number(debugPort) < 1024 || Number(debugPort) > 65535)) {
      throw new Error("AIKING_DESKTOP_DEBUG_PORT must be 1024–65535.");
    }
    mkdirSync(join(runtime, "profiles"), { recursive: true });
    desktopProfile = offline ? mkdtempSync(join(runtime, "profiles/electron-verify-")) : join(runtime, "profiles/electron");
    electron = spawn(String(binary), [source, `--user-data-dir=${desktopProfile}`,
      ...(debugPort ? [`--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1"] : []),
    ], {
      cwd: source, stdio: "inherit", env: { ...process.env, ELECTRON_START_URL: uiUrl },
    });
    electron.once("error", (error) => { console.error(error.message); void close().then(() => process.exit(1)); });
    electron.once("exit", (code) => { if (!stopping) void close().then(() => process.exit(code ?? 1)); });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Foundation startup failed.");
  await close();
  process.exitCode = 1;
}
