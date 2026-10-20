// Copyright (c) 2026 AIKING.
// One command that checks a built desktop app the way a person would use it: it starts the app, signs in through the
// app's own screen against a local stand-in for the account service, walks the main screens and writes what it saw.
// Every check is a plain sentence; the command exits with 1 when any check fails.
//
//   node scripts/app-check.mjs <path to the app executable> [out-dir]
//   (Linux without a screen: run it under `xvfb-run -a`, or set DISPLAY.)
//
// Environment: AIKING_CHECK_NO_SANDBOX=1 adds --no-sandbox (containers, CI).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer as createHttp } from "node:http";
import { createServer as createNet } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
// The browser driver is a dev dependency of the desktop app, so it is found from there.
const { chromium } = createRequire(new URL("../apps/desktop/package.json", import.meta.url))("playwright-core");

const binary = process.argv[2] ? resolve(process.argv[2]) : "";
if (!binary || !existsSync(binary)) { console.error("usage: node scripts/app-check.mjs <app executable> [out-dir]"); process.exit(2); }
const out = process.argv[3] || join(process.cwd(), "app-check-evidence");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "aiking-check-"));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = async () => { const server = createNet(); await new Promise((r) => server.listen(0, "127.0.0.1", r)); const { port } = server.address(); await new Promise((r) => server.close(r)); return port; };

// A stand-in for the account service: any address gets the same one-time code.
const CODE = "ABCD-EFGH";
const accounts = new Map();
const auth = createHttp((req, res) => {
  let body = ""; req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const json = (status, value) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    const data = body ? JSON.parse(body) : {};
    if (req.url === "/v1/auth/email/start") { accounts.set("c1", data.email); return json(200, { challengeId: "c1", expiresAt: Date.now() + 600_000, resendAt: Date.now() + 1000 }); }
    if (req.url === "/v1/auth/email/verify") return data.code === CODE ? json(200, { sessionToken: "check-token", user: { id: "check-user", email: accounts.get(data.challengeId) } }) : json(401, { error: { code: "invalid_otp" } });
    if (req.url === "/v1/me") return json(200, { id: "check-user", email: accounts.get("c1"), name: "", avatarUrl: "" });
    json(200, { ok: true });
  });
});
await new Promise((r) => auth.listen(0, "127.0.0.1", r));

const port = await freePort();
const pass = ["PATH", "SystemRoot", "DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "APPIMAGE_EXTRACT_AND_RUN", "ComSpec", "PATHEXT", "WINDIR"];
const env = Object.fromEntries(pass.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
const args = [`--user-data-dir=${join(scratch, "electron")}`, `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", "--lang=en-US"];
if (process.env.AIKING_CHECK_NO_SANDBOX) args.push("--no-sandbox");
const child = spawn(binary, args, {
  cwd: scratch, stdio: ["ignore", "pipe", "pipe"],
  env: { ...env, HOME: scratch, USERPROFILE: scratch, APPDATA: join(scratch, "AppData/Roaming"), LOCALAPPDATA: join(scratch, "AppData/Local"), XDG_CONFIG_HOME: join(scratch, ".config"), AIKING_ACCOUNT_API_URL: `http://127.0.0.1:${auth.address().port}`, ELECTRON_DISABLE_SANDBOX: "1" },
});
let output = ""; child.stdout.on("data", (c) => { output += c; }); child.stderr.on("data", (c) => { output += c; });

const results = []; const settings = {}; let page; let shots = 0;
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail: ok ? "" : String(detail).slice(0, 300) }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${String(detail).slice(0, 120)})`}`); };
const text = async () => (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).replace(/\s+/g, " ");
const dialogText = async () => (await page.locator('[role="dialog"]').first().innerText({ timeout: 4000 }).catch(() => "")).replace(/\s+/g, " ");
const shot = async (name) => page.screenshot({ path: join(out, `${String(++shots).padStart(2, "0")}-${name}.png`) }).catch(() => {});
const step = async (name, fn) => { try { await fn(); } catch (error) { check(`${name} (the step itself ran)`, false, error.message); await shot(`${name.replace(/\W+/g, "-")}-failed`); } };
const press = async (selector, options = {}) => page.locator(selector).first().click({ timeout: 6000, ...options });

let browser;
try {
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`The app exited early (${child.exitCode}): ${output.slice(-800)}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { /* starting */ }
    if (Date.now() > deadline) throw new Error("The app never opened its debug port");
    await wait(300);
  }
  while (Date.now() < deadline && !page) { page = browser.contexts()[0].pages().find((p) => /^http:\/\/127\.0\.0\.1:\d+\//.test(p.url())); if (!page) await wait(250); }
  if (!page) throw new Error("The app window never loaded its own server");
  const errors = []; page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {});
  const origin = new URL(page.url()).origin;

  await step("first run", async () => {
    await page.waitForSelector("[data-signin-email]", { timeout: 90_000 });
    await shot("sign-in");
    check("the first screen asks for an email, not for a server or an install", /email/i.test(await text()) && !/install|remote server|connect.*server/i.test(await text()), await text());
    await page.fill("[data-signin-email]", "check@example.test"); await press("[data-signin-send]");
    await page.waitForSelector("[data-signin-code]", { timeout: 20_000 });
    await page.fill("[data-signin-code]", CODE); await press("[data-signin-verify]");
    await page.waitForSelector("[data-signin-name]", { timeout: 20_000 });
    check("after the code it only asks for a name", true);
    await page.fill("[data-signin-name]", "Tester"); await press("[data-signin-continue]");
    await page.waitForSelector("[data-workspace-rail]", { timeout: 30_000 });
    check("the person lands in the app on this computer", page.url().startsWith(origin), page.url());
    await wait(1500);
    const skip = page.getByRole("button", { name: /skip tour/i }); if (await skip.count()) await skip.first().click().catch(() => {});
    await shot("home");
  });

  await step("server tiles", async () => {
    await press("[data-server-tile]", { button: "right" });
    const menu = await page.locator("[data-server-menu]").innerText({ timeout: 4000 }).catch(() => "");
    check("right-click on this computer's tile explains it cannot be removed", /cannot be removed/i.test(menu), menu);
    await shot("server-menu"); await page.keyboard.press("Escape"); await page.mouse.click(700, 400);
    await press("[data-server-add]");
    await page.waitForTimeout(600);
    const dialog = await dialogText(); await shot("add-server");
    check("the add-server box offers join and create, without team wording", /Join a Server/.test(dialog) && /Create my Server/.test(dialog) && !/Manage members|Workspaces organize/.test(dialog), dialog);
    await page.keyboard.press("Escape");
  });

  await step("menu", async () => {
    await page.getByRole("button", { name: "Tester", exact: true }).first().click({ timeout: 6000 });
    const items = await page.$$eval('[role="menuitem"]', (nodes) => nodes.map((n) => n.textContent.trim()));
    check("the profile menu has Usage, Help and support, Settings", ["Usage", "Help and support", "Settings"].every((x) => items.some((i) => i.startsWith(x))), items.join("|"));
    const feedback = page.getByRole("menuitem", { name: /Send Feedback/ });
    if (await feedback.count()) check("Send Feedback is offered", true); else { await page.getByRole("menuitem", { name: /Help and support/ }).first().hover().catch(() => {}); await wait(400); check("Send Feedback is offered under Help and support", await page.getByRole("menuitem", { name: /Send Feedback/ }).count() > 0); }
    await shot("profile-menu");
  });

  await step("settings", async () => {
    await page.getByRole("menuitem", { name: /Settings/ }).first().click({ timeout: 6000 });
    await page.waitForSelector('[role="dialog"]', { timeout: 6000 });
    const names = ["General", "Appearance", "AI", "Connectors", "Computers", "Account"];
    for (const name of names) { await page.locator('[role="dialog"]').getByRole("button", { name, exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await wait(700); const body = await dialogText(); await shot(`settings-${name}`); settings[name] = body; }
    check("settings has the six simple pages", names.every((n) => settings[n]?.includes(n)));
    check("Account shows who is signed in and Remote access, off", /check@example\.test/.test(settings.Account) && /Remote access/.test(settings.Account) && /Off\./.test(settings.Account), settings.Account);
    check("the AI page does not show the decision-model block in the simple view", !/Decision model/.test(settings.AI));
    check("no page says 'A agent'", !names.some((n) => /\bA agent\b/.test(settings[n])));
    check("no page points to 'Settings → Connections'", !names.some((n) => /Settings → Connections/.test(settings[n])));
    check("nothing mentions the old staging server", !names.some((n) => /srv1866690|hstgr\.cloud/.test(settings[n])));
    await page.keyboard.press("Escape");
  });

  await step("chat", async () => {
    const body = await text();
    check("a first agent is waiting with a greeting", /What would you like me to do\?/.test(body), body.slice(0, 200));
    check("the chat box is there and ready", await page.getByRole("button", { name: /send message/i }).count() > 0);
  });

  await step("api", async () => {
    const probe = (path) => page.evaluate(async (p) => { const r = await fetch(p); return { s: r.status, t: (await r.text()).slice(0, 200) }; }, path);
    const account = await probe("/api/aiking/account/status"); check("the app knows it is signed in", account.s === 200 && /"signedIn":true/.test(account.t), account.t);
    const relay = await probe("/api/aiking/relay/status"); check("Remote access is off by default", relay.s === 200 && /"configured":false/.test(relay.t), relay.t);
    check("the page raised no script errors", errors.length === 0, errors.join(" | "));
  });
} catch (error) {
  check("the app could be checked", false, error.message);
} finally {
  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(out, "report.json"), JSON.stringify({ at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results, appOutputTail: output.slice(-2000) }, null, 1));
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Evidence: ${out}`);
  await browser?.close().catch(() => {}); child.kill(); auth.close();
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 1500).unref();
}
