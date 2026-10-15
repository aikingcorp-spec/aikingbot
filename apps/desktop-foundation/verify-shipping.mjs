// Copyright (c) 2026 AIKING.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { foundationRoot, repositoryRoot, runtimeRoot, sourceRoot } from "./setup.mjs";

const electron = process.argv.includes("--electron");
for (const option of process.argv.slice(2)) if (option !== "--electron") throw new Error(`Unknown option: ${option}`);
if (electron && process.getuid?.() === 0) throw new Error("Run Electron as an ordinary user with its sandbox enabled.");
const out = join(runtimeRoot, "evidence/shipping"); mkdirSync(out, { recursive: true });
const env = { ...process.env, AIKING_VERIFY_STAGE: "shipping", AIKING_CHROME: process.env.AIKING_CHROME || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : chromium.executablePath()) };
const reports = [];
const port = async () => {
  const server = createServer(); await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
};
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  if (child.connected) child.send({ type: "aiking.shutdown" }); else child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
  const result = await exited; clearTimeout(timer); assert.equal(result.code, 0, `Owned fixture did not shut down cleanly (${result.signal || result.code})`);
}
async function run(script, extra) {
  const child = spawn(process.execPath, [join(foundationRoot, script)], { cwd: repositoryRoot, env: { ...env, ...extra }, stdio: "inherit" });
  const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
  reports.push({ script, ...extra, ...result }); assert.equal(result.code, 0, `${script} failed (${result.signal || result.code})`);
}
async function fixture(name, operation) {
  const uiPort = await port(); const debugPort = electron ? await port() : undefined;
  const log = createWriteStream(join(out, `runtime-${name}.log`));
  const child = spawn(process.execPath, ["--experimental-strip-types", "aiking/runtime.ts", "--offline", "--core", "--production", ...(electron ? ["--desktop"] : [])], {
    cwd: sourceRoot, env: { ...env, AIKING_UI_PORT: String(uiPort), ...(debugPort ? { AIKING_DESKTOP_DEBUG_PORT: String(debugPort) } : {}) }, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  let launchError; child.once("error", error => { launchError = error; });
  const deadline = Date.now() + 120000;
  try {
    for (;;) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Fixture ${name} exited (${child.exitCode}); see runtime-${name}.log`);
      let ready = false;
      try {
        const info = JSON.parse(readFileSync(join(runtimeRoot, "offline-runtime.json"), "utf8"));
        ready = info.pid === child.pid && (await fetch(info.uiUrl, { signal: AbortSignal.timeout(1000) })).ok;
        if (ready && debugPort) ready = (await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(1000) }).then(r => r.json())).some(page => page.url.startsWith(info.uiUrl));
      } catch { ready = false; }
      if (ready) break;
      if (Date.now() > deadline) throw new Error(`Fixture ${name} startup timed out`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await operation(debugPort ? { AIKING_VERIFY_CDP: `http://127.0.0.1:${debugPort}` } : {});
  } catch (error) {
    console.error(`Fixture ${name} failed:\n${readFileSync(join(out, `runtime-${name}.log`), "utf8").slice(-15000)}`);
    throw error;
  } finally { await stop(child); log.end(); }
}
let ok = false;
try {
  if (!electron) await fixture("functional", async () => { await run("shipping-e2e.mjs", {}); await run("voice-e2e.mjs", {}); });
  for (const variant of [
    { AIKING_TOUR_SKIN: "aiking" },
    { AIKING_TOUR_SKIN: "aiking-light" },
    { AIKING_TOUR_SKIN: "aiking", AIKING_TOUR_WIDTH: "1000", AIKING_TOUR_ADVANCED: "1" },
  ]) await fixture(`${electron ? "electron" : "browser"}-${variant.AIKING_TOUR_SKIN}-${variant.AIKING_TOUR_WIDTH || "1440"}`, async cdp => run("ui-tour.mjs", { ...variant, ...cdp }));
  ok = true;
} finally {
  writeFileSync(join(out, `verification-${electron ? "electron" : "chromium"}.json`), JSON.stringify({ ok, at: new Date().toISOString(), reports, offline: true, sandboxDisabled: false }, null, 2));
}
