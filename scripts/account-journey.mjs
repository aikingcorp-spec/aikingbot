// Copyright (c) 2026 AIKING.
// Live acceptance of the desktop account journey against a real hosted workspace (not run in CI):
// packaged app → "Sign in to your workspace" → email one-time code from the AIKINGBOT Auth API → workspace session
// → an admin change succeeds → relaunch keeps the session → sign out revokes it.
//   AIKING_JOURNEY_EMAIL=owner@example.com AIKING_OTP_COMMAND="python3 -I read_otp.py" node account-journey.mjs
// AIKING_OTP_COMMAND receives the request time (epoch seconds) and prints the code on its last line.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { runtimeRoot, sourceRoot } from "./paths.mjs";

const email = process.env.AIKING_JOURNEY_EMAIL; const otpCommand = process.env.AIKING_OTP_COMMAND;
assert.ok(email && otpCommand, "Set AIKING_JOURNEY_EMAIL and AIKING_OTP_COMMAND.");
const binary = process.env.AIKING_PACKAGE_EXECUTABLE || join(sourceRoot, "release", process.platform === "win32" ? "win-unpacked/AIKINGBOT.exe" : "linux-unpacked/aikingbot");
const scratch = mkdtempSync(join(tmpdir(), "aiking-account-journey-"));
const out = join(runtimeRoot, "evidence/shipping"); mkdirSync(out, { recursive: true });
const steps = [];
const step = (name) => { steps.push({ name, at: new Date().toISOString() }); console.log(`ok   ${name}`); };

async function launch() {
  const probe = createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const env = Object.fromEntries(["PATH", "SystemRoot", "DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "AIKING_WORKSPACE_URL"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  const child = spawn(binary, [`--user-data-dir=${join(scratch, "electron")}`, `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"], {
    cwd: scratch, stdio: "ignore",
    env: { ...env, HOME: scratch, USERPROFILE: scratch, APPDATA: join(scratch, "AppData/Roaming"), LOCALAPPDATA: join(scratch, "AppData/Local"), XDG_CONFIG_HOME: join(scratch, ".config"), XDG_CACHE_HOME: join(scratch, ".cache"), AIKING_DATA_DIR: join(scratch, "data") },
  });
  const deadline = Date.now() + 120_000; let browser;
  while (!browser) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { if (Date.now() > deadline) throw new Error("app did not start"); await new Promise(r => setTimeout(r, 300)); }
  }
  const context = browser.contexts()[0]; let page;
  while (!page) { page = context.pages().find(p => /^https?:/.test(p.url())); if (!page) await new Promise(r => setTimeout(r, 250)); }
  const stop = async () => {
    await browser.close().catch(() => {});
    if (child.exitCode === null) { const exited = new Promise(r => child.once("exit", r)); child.kill("SIGTERM"); const timer = setTimeout(() => child.kill("SIGKILL"), 15_000); await exited; clearTimeout(timer); }
  };
  return { page, stop };
}

let app; let ok = false; let failure;
try {
  app = await launch();
  let { page } = app;
  const join_ = page.getByRole("button", { name: "Have an AIKINGBOT account? Sign in to your workspace" });
  await join_.waitFor({ timeout: 120_000 });
  step("first run offers the AIKINGBOT workspace sign-in");
  await join_.click();
  await page.waitForURL(url => url.protocol === "https:", { timeout: 60_000 });
  const origin = new URL(page.url()).origin;
  await page.getByLabel("Email").waitFor({ timeout: 60_000 });
  step(`opened ${origin} without typing an address or a pairing code`);
  await page.getByLabel("Email").fill(email);
  const requestedAt = Math.floor(Date.now() / 1000);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Code from the email").waitFor({ timeout: 30_000 });
  step("one-time code requested from the AIKINGBOT Auth API");
  const code = execFileSync("sh", ["-c", `${otpCommand} ${requestedAt}`], { encoding: "utf8", timeout: 180_000 }).trim().split("\n").at(-1).trim();
  assert.match(code, /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i, "the OTP command printed a code");
  step("code delivered by email");
  await page.getByLabel("Code from the email").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("textbox", { name: /^Message / }).first().waitFor({ timeout: 120_000 });
  const session = await page.evaluate(async () => (await fetch("/api/auth/session")).json());
  assert.equal(session.kind, "session"); assert.equal(session.email, email.toLowerCase()); assert.ok(session.scopes.includes("admin"));
  step(`signed in to the workspace as ${session.email} (${session.scopes.join(", ")})`);
  const change = await page.evaluate(async () => {
    const opened = await fetch("/api/auth/pairing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scopes: ["client"] }) });
    const offer = await opened.json();
    const cancelled = offer.id ? await fetch(`/api/auth/pairing/${offer.id}`, { method: "DELETE" }) : null;
    return { opened: opened.status, cancelled: cancelled?.status };
  });
  assert.deepEqual(change, { opened: 200, cancelled: 200 });
  step("an owner change (Remote access invite) succeeds from the desktop window");
  await page.screenshot({ path: join(out, "account-journey-workspace.png") });
  await app.stop();

  app = await launch(); page = app.page;
  await page.waitForURL(url => url.origin === origin, { timeout: 60_000 });
  await page.getByRole("textbox", { name: /^Message / }).first().waitFor({ timeout: 120_000 });
  const again = await page.evaluate(async () => (await fetch("/api/auth/session")).json());
  assert.equal(again.kind, "session"); assert.equal(again.id, session.id);
  step("relaunch reopens the workspace with the same session, no new code");
  const out_ = await page.evaluate(async () => (await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" } })).status);
  assert.equal(out_, 200);
  assert.ok([401, 403].includes(await page.evaluate(async () => (await fetch("/api/auth/session")).status)), "signed out");
  step("sign out revokes the session at once");
  ok = true;
} catch (error) {
  failure = String(error?.stack ?? error); console.error(failure); process.exitCode = 1;
  await app?.page.screenshot({ path: join(out, "account-journey-failure.png") }).catch(() => {});
  console.error("page:", app?.page.url(), await app?.page.evaluate(() => ({ workspaces: Object.keys(window.ogb?.workspaces ?? {}), text: document.body.innerText.slice(0, 600) })).catch(() => null));
}
finally {
  await app?.stop().catch(() => {});
  writeFileSync(join(out, "account-journey.json"), JSON.stringify({ ok, failure, email: email.replace(/^(.).*@/, "$1***@"), steps, at: new Date().toISOString() }, null, 2));
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
