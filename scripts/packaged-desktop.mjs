// Copyright (c) 2026 AIKING.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { runtimeRoot, sourceRoot } from "./paths.mjs";

assert.notEqual(process.getuid?.(), 0, "Run the packaged desktop as an ordinary user.");
const binary = process.env.AIKING_PACKAGE_EXECUTABLE || join(sourceRoot, "release", process.platform === "win32" ? "win-unpacked/AIKINGBOT.exe" : process.platform === "darwin" ? "mac/AIKINGBOT.app/Contents/MacOS/AIKINGBOT" : "linux-unpacked/aikingbot");
assert.ok(existsSync(binary), "Build the desktop package first.");
const scratch = mkdtempSync(join(tmpdir(), "aiking-desktop-package-"));
const out = join(runtimeRoot, "evidence/shipping"); mkdirSync(out, { recursive: true });
const portServer = createServer(); await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
const profile = join(scratch, "data"); mkdirSync(profile, { mode: 0o700 });
const env = Object.fromEntries(["PATH", "SystemRoot", "DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const child = spawn(binary, [`--user-data-dir=${join(scratch, "electron")}`, `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"], {
  cwd: scratch, env: { ...env, HOME: scratch, USERPROFILE: scratch, APPDATA: join(scratch, "AppData/Roaming"), LOCALAPPDATA: join(scratch, "AppData/Local"), XDG_CONFIG_HOME: join(scratch, ".config"), XDG_CACHE_HOME: join(scratch, ".cache"), AIKING_DATA_DIR: profile },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
let browser; let page; let ok = false; let failure; const errors = [];
try {
  const deadline = Date.now() + 120000;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Packaged desktop exited (${child.signalCode || child.exitCode}): ${output.slice(-3000)}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch {}
    if (Date.now() > deadline) throw new Error("Packaged desktop did not expose its owned debug endpoint");
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  const context = browser.contexts()[0];
  while (Date.now() < deadline && !page) {
    page = context.pages().find(page => /^http:\/\/127\.0\.0\.1:\d+\//.test(page.url()));
    if (!page) await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(page, "The packaged app loaded its embedded server.");
  page.on("pageerror", error => errors.push(error.message));
  // A fresh package can have no configured agent/provider yet. Its sidebar and owned API must still work.
  await page.getByRole("navigation", { name: "Servers", exact: true }).waitFor({ timeout: 120000 });
  writeFileSync(join(out, "packaged-initial-state.json"), JSON.stringify({ text: (await page.locator("body").innerText()).slice(0, 4000) }, null, 2));
  const skip = page.getByRole("button", { name: "Skip tour", exact: true }); if (await skip.isVisible()) await skip.click();
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(await page.evaluate(() => typeof window.process), "undefined");
  const endpoint = new URL("/api/aiking/marketplace/records", page.url());
  const denied = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remove", listingId: "not-installed-fixture" }) });
  assert.equal(denied.status, 403, "Packaged API mutations require the desktop connection credential.");
  // The real desktop renderer must get a private owner capability from Electron.
  // The nonexistent provider returns 404 only after mutation authorization succeeds.
  const ownerCheck = await page.evaluate(async () => {
    const response = await fetch("/api/instances/unknown-aiking-smoke-provider/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    return { status: response.status, result: await response.text() };
  });
  assert.equal(ownerCheck.status, 404, "The real desktop renderer was denied mutation access: " + ownerCheck.result.slice(0, 300));
  // The three operations reported as 403 from the Windows EXE, through the same renderer requests the UI makes.
  const operations = await page.evaluate(async () => {
    const send = async (path, body) => {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json().catch(() => null) };
    };
    const catalog = await (await fetch("/api/aiking/v1/catalog")).json();
    const skill = catalog.listings.find(listing => listing.kind === "skill");
    const record = { listingId: skill.id, version: skill.version, kind: "skill", targets: ["aiking-packaged-smoke"], installedAt: new Date().toISOString() };
    const install = await send("/api/aiking/marketplace/records", { action: "add", record });
    const uninstall = await send("/api/aiking/marketplace/records", { action: "remove", listingId: skill.id, target: "aiking-packaged-smoke" });
    const pairing = await send("/api/auth/pairing", { scopes: ["client"] });
    return { install: install.status, installed: install.body?.records?.some(r => r.listingId === skill.id) === true, uninstall: uninstall.status, pairing: pairing.status, code: typeof pairing.body?.code === "string" };
  });
  assert.deepEqual(operations, { install: 200, installed: true, uninstall: 200, pairing: 200, code: true }, "Marketplace install/remove and Remote access pairing from the packaged renderer");
  const forged = await fetch(new URL("/api/auth/pairing", page.url()), { method: "POST", headers: { "content-type": "application/json", "x-aikingbot-desktop-owner": "A".repeat(43) }, body: JSON.stringify({ scopes: ["client"] }) });
  assert.equal(forged.status, 403, "A forged desktop owner header must stay denied.");
  if (process.platform === "win32") {
    const runtimeDir = join(sourceRoot, "release", "win-unpacked", "resources", "provider-runtime", "bin");
    assert.ok(existsSync(join(runtimeDir, "node.exe")), "Packaged Windows provider runtime lacks node.exe");
    assert.ok(existsSync(join(runtimeDir, "npm.cmd")), "Packaged Windows provider runtime lacks npm.cmd");
    assert.ok(existsSync(join(runtimeDir, "node_modules", "npm", "bin", "npm-cli.js")), "Packaged Windows provider runtime lacks npm-cli.js");
    const npm = spawnSync(join(runtimeDir, "node.exe"), [join(runtimeDir, "node_modules/npm/bin/npm-cli.js"), "--version"], {
      cwd: scratch, encoding: "utf8", timeout: 30000,
      env: { SystemRoot: process.env.SystemRoot, PATH: runtimeDir, HOME: scratch, USERPROFILE: scratch, TEMP: scratch, TMP: scratch },
    });
    assert.equal(npm.error, undefined, "Packaged npm must launch without global Node/npm");
    assert.equal(npm.status, 0, "Packaged npm failed: " + npm.stderr);
    assert.match(npm.stdout.trim(), /^\d+\.\d+\.\d+$/);
  }

  assert.equal((await fetch(endpoint, { headers: { origin: "https://untrusted.example" } })).status, 403);
  assert.equal(await page.locator('[data-notice="product-hunt"]').count(), 0, "The packaged app must not promote an upstream launch.");
  await page.screenshot({ path: join(out, "packaged-desktop.png") });
  assert.deepEqual(errors, []); ok = true;
  console.log("Packaged desktop booted with isolated data, renderer isolation and authenticated API.");
} catch (error) {
  failure = String(error);
  if (page) {
    await page.screenshot({ path: join(out, "packaged-desktop-failure.png") }).catch(() => {});
    await page.locator("body").innerText().then(text => writeFileSync(join(out, "packaged-desktop-failure-state.json"), JSON.stringify({ text: text.slice(0, 6000), url: page.url() }, null, 2))).catch(() => {});
  }
  throw error;
}
finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once("exit", resolve)); const timer = setTimeout(() => child.kill("SIGKILL"), 15000); child.kill("SIGTERM"); await exited; clearTimeout(timer);
  }
  const log = join(scratch, "electron/logs/server.log"); if (existsSync(log)) output += readFileSync(log, "utf8");
  writeFileSync(join(out, "packaged-desktop.log"), output);
  writeFileSync(join(out, "packaged-desktop.json"), JSON.stringify({ ok, failure, at: new Date().toISOString(), user: process.getuid?.(), executable: process.env.AIKING_PACKAGE_EXECUTABLE ? "custom" : "release", rendererErrors: errors, realProviderVerified: false }, null, 2));
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
