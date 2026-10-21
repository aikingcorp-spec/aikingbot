// Copyright (c) 2026 AIKING.
// One command that checks a built desktop app the way a person would use it: it starts the app, signs in through the
// app's own screen against a local stand-in for the account service, walks the main screens and writes what it saw.
// Every check is a plain sentence; the command exits with 1 when any check fails.
//
//   node scripts/app-check.mjs <path to the app executable> [out-dir]
//   (Linux without a screen: run it under `xvfb-run -a`, or set DISPLAY.)
//
// Environment: AIKING_CHECK_NO_SANDBOX=1 adds --no-sandbox (containers, CI).
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer as createHttp } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
// The browser driver is a dev dependency of the desktop app, so it is found from there. It starts the app itself, which also
// lets the check answer the operating system's own confirmation boxes (the app asks before it creates or opens a server).
const { _electron } = createRequire(new URL("../apps/desktop/package.json", import.meta.url))("playwright-core");

// Names that must appear nowhere (a regular expression), set by whoever runs the check.
const FORBIDDEN = process.env.AIKING_FORBIDDEN_NAMES ? new RegExp(process.env.AIKING_FORBIDDEN_NAMES, "i") : /(?!)/;
const binary = process.argv[2] ? resolve(process.argv[2]) : "";
if (!binary || !existsSync(binary)) { console.error("usage: node scripts/app-check.mjs <app executable> [out-dir]"); process.exit(2); }
const out = process.argv[3] || join(process.cwd(), "app-check-evidence");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "aiking-check-"));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const pass = ["PATH", "SystemRoot", "DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "APPIMAGE_EXTRACT_AND_RUN", "ComSpec", "PATHEXT", "WINDIR"];
const env = Object.fromEntries(pass.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
const args = [`--user-data-dir=${join(scratch, "electron")}`, "--lang=en-US"];
if (process.env.AIKING_CHECK_NO_SANDBOX) args.push("--no-sandbox");
const launchEnv = { ...env, HOME: scratch, USERPROFILE: scratch, APPDATA: join(scratch, "AppData/Roaming"), LOCALAPPDATA: join(scratch, "AppData/Local"), XDG_CONFIG_HOME: join(scratch, ".config"), AIKING_ACCOUNT_API_URL: `http://127.0.0.1:${auth.address().port}`, ELECTRON_DISABLE_SANDBOX: "1" };
let electronApp; let output = "";

const results = []; const settings = {}; let page; let shots = 0;
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail: ok ? "" : String(detail).slice(0, 300) }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${String(detail).slice(0, 120)})`}`); };
const text = async () => (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).replace(/\s+/g, " ");
const dialogText = async () => (await page.locator('[role="dialog"]').first().innerText({ timeout: 4000 }).catch(() => "")).replace(/\s+/g, " ");
const shot = async (name) => page.screenshot({ path: join(out, `${String(++shots).padStart(2, "0")}-${name}.png`) }).catch(() => {});
const step = async (name, fn) => { try { await fn(); } catch (error) { check(`${name} (the step itself ran)`, false, error.message); await shot(`${name.replace(/\W+/g, "-")}-failed`); } };
const press = async (selector, options = {}) => page.locator(selector).first().click({ timeout: 6000, ...options });

try {
  electronApp = await _electron.launch({ executablePath: binary, args, env: launchEnv, cwd: scratch, timeout: 120_000 });
  const child = electronApp.process(); child.stdout?.on("data", (c) => { output += c; }); child.stderr?.on("data", (c) => { output += c; });
  // The operating system's confirmation boxes cannot be clicked from the page: answer "Continue" for the app.
  await electronApp.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && !page) { page = electronApp.windows().find((p) => /^http:\/\/127\.0\.0\.1:\d+\//.test(p.url())); if (!page) await wait(250); }
  if (!page) throw new Error("The app window never loaded its own server");
  const errors = []; page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  // Everything that goes wrong in the background while the checks and the walk-through run.
  const trouble = { console: [], requests: [], http: [] };
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) trouble.console.push(m.text().slice(0, 200)); });
  page.on("requestfailed", (r) => trouble.requests.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 100)} ${r.failure()?.errorText ?? ""}`));
  page.on("response", (r) => { if (r.status() >= 500) trouble.http.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 100)}`); });
  await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {});
  const origin = new URL(page.url()).origin;

  await step("first run", async () => {
    await page.waitForSelector("[data-signin-email]", { timeout: 90_000 });
    await shot("sign-in");
    // Only the sign-in card counts: the app behind it has words of its own (a banner, the server rail).
    const card = (await page.locator("[data-signin-email]").first().locator("xpath=ancestor::*[self::form or @role='dialog' or self::main][1]").innerText({ timeout: 4000 }).catch(async () => text())).replace(/\s+/g, " ");
    check("the first screen asks for an email, not for a server or an install", /email/i.test(card) && !/install (the )?desktop|remote server|connect to a server/i.test(card), card);
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

  await step("a second server", async () => {
    page.on("dialog", (dialog) => { dialog.accept().catch(() => {}); });
    await press("[data-server-add]"); await wait(500);
    await press("[data-workspace-create]"); await wait(400);
    await page.fill("[data-workspace-input]", "Second");
    await shot("create-form");
    await press('[data-workspace-panel] form button[type="submit"]');
    // The app restarts its local runtime and opens the new server in this window.
    const arrived = await Promise.race([
      page.waitForSelector("[data-signin-email]", { timeout: 90_000 }).then(() => "sign-in"),
      page.waitForFunction(() => document.querySelectorAll("[data-server-tile]").length >= 2, null, { timeout: 90_000 }).then(() => "app"),
      page.waitForSelector('[data-workspace-panel] [role="alert"]', { timeout: 90_000 }).then(async () => `error: ${await page.locator('[data-workspace-panel] [role="alert"]').innerText()}`),
    ]);
    await shot("after-create");
    check("creating a second server works and opens it", arrived === "app" || arrived === "sign-in", arrived);
    check("the new server does not ask the person to sign in again", arrived === "app", "it shows the sign-in screen again");
    if (arrived === "sign-in") {
      await page.fill("[data-signin-email]", "check@example.test"); await press("[data-signin-send]");
      await page.waitForSelector("[data-signin-code]", { timeout: 20_000 }); await page.fill("[data-signin-code]", CODE); await press("[data-signin-verify]");
      await page.waitForSelector("[data-signin-name]", { timeout: 20_000 }); await page.fill("[data-signin-name]", "Tester"); await press("[data-signin-continue]");
    }
    await page.waitForFunction(() => document.querySelectorAll("[data-server-tile]").length >= 2, null, { timeout: 60_000 });
    const tiles = await page.$$eval("[data-server-tile]", (nodes) => nodes.map((n) => n.getAttribute("aria-label")));
    check("the rail now shows this computer and the new server", tiles.length === 2 && tiles.includes("Second"), tiles.join("|"));
    await page.locator('[data-server-tile][aria-label="Second"]').first().click({ button: "right" });
    await shot("second-server-menu");
    await press("[data-server-off]");
    await page.waitForFunction(() => document.querySelector('[data-server-tile][aria-current="page"]')?.getAttribute("aria-label") !== "Second", null, { timeout: 90_000 });
    check("turning the second server off goes back to this computer", true);
    await page.locator('[data-server-tile][aria-label="Second"]').first().click({ button: "right" });
    await press("[data-server-remove]"); await wait(1500);
    const left = await page.$$eval("[data-server-tile]", (nodes) => nodes.length);
    check("removing the second server leaves only this computer", left === 1, String(left));
    await shot("after-remove");
    // Switching servers restarts the local runtime, so connections drop on purpose; count trouble from here on.
    trouble.console.length = 0; trouble.requests.length = 0; trouble.http.length = 0; errors.length = 0;
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
    check("no page shows a forbidden name (AIKING_FORBIDDEN_NAMES)", !names.some((n) => FORBIDDEN.test(settings[n])));
    await page.keyboard.press("Escape");
  });

  await step("chat", async () => {
    const body = await text();
    check("a first agent is waiting with a greeting", /What would you like me to do\?/.test(body), body.slice(0, 200));
    check("the chat box is there and ready", await page.getByRole("button", { name: /send message/i }).count() > 0);
  });

  await step("walk-through", async () => {
    const seen = {};
    const looksBroken = (t) => (t.match(/(something went wrong|unexpected error|could not (load|reach|save)|failed to|unavailable|undefined|\[object Object\]|NaN\b|Internal Server Error)/gi) ?? []);
    const pick = async (name) => { const button = page.getByRole("button", { name, exact: true }).first(); if (await button.count()) return button.click({ timeout: 4000 }); return page.getByRole("tab", { name, exact: true }).first().click({ timeout: 4000 }); };
    const skipped = [];
    const visit = async (label, open, optional = false) => { try { await open(); await wait(900); const t = await text(); seen[label] = looksBroken(t); await shot(`walk-${label.replace(/\W+/g, "-")}`); } catch (error) { if (optional) { skipped.push(label); seen[label] = []; } else seen[label] = [`could not open: ${String(error.message).split("\n")[0].slice(0, 80)}`]; } };
    const close = async () => { await page.keyboard.press("Escape"); await wait(300); await page.keyboard.press("Escape"); await wait(300); await page.locator("[data-server-tile]").first().click({ timeout: 3000 }).catch(() => {}); await wait(500); };
    for (const name of ["Marketplace", "Routines", "Apps"]) { await visit(name, () => pick(name)); await close(); }
    await visit("New or share", () => page.getByRole("button", { name: "New or share", exact: true }).first().click({ timeout: 4000 })); await close();
    await visit("agent profile", () => page.getByRole("button", { name: /^Open .* profile$/ }).first().click({ timeout: 4000 }));
    for (const tab of ["Details", "Memory", "Library", "Skills", "Vault"]) await visit(`agent ${tab}`, () => pick(tab));
    await close();
    // advanced mode: every settings section and every agent tab
    await page.getByRole("button", { name: "Tester", exact: true }).first().click({ timeout: 4000 }).catch(() => {});
    await page.getByRole("menuitem", { name: /Settings/ }).first().click({ timeout: 4000 }).catch(() => {});
    await page.locator('[role="dialog"]').getByRole("button", { name: "General", exact: true }).first().click({ timeout: 4000 }).catch(() => {});
    await page.locator('[role="dialog"]').getByRole("switch").first().click({ timeout: 4000 }).catch(() => {});
    await wait(800);
    const sections = await page.locator('[role="dialog"] nav button, [role="dialog"] aside button').evaluateAll((nodes) => nodes.map((n) => (n.textContent || "").trim()).filter((t) => t && t.length < 30 && !/^(Share|Edit|Save|Replay|Check|Export|Remove|Sign out)/.test(t)));
    for (const name of [...new Set(sections)]) await visit(`settings ${name}`, () => page.locator('[role="dialog"]').getByRole("button", { name, exact: true }).first().click({ timeout: 3000 }));
    await close();
    await page.getByRole("button", { name: /^Open .* profile$/ }).first().click({ timeout: 4000 }).catch(() => {});
    await wait(800);
    for (const tab of ["Overview", "Identity", "Soul", "Skills", "Memory", "Routines", "Access", "Model", "Permissions", "Voice & alerts", "History", "Usage"]) await visit(`agent tab ${tab}`, () => pick(tab), true);
    await close();
    const broken = Object.entries(seen).filter(([, found]) => found.length);
    check(`the walk-through opened ${Object.keys(seen).length} screens`, Object.keys(seen).length >= 12, Object.keys(seen).length);
    if (skipped.length) console.log(`note: not reachable from the small profile panel, skipped: ${skipped.join(", ")}`);
    check("no screen shows an error message or a raw value (undefined, NaN, [object Object])", broken.length === 0, broken.map(([k, v]) => `${k}: ${v.join(",")}`).join(" | "));
    check("nothing failed in the background (script errors, failed requests, server errors)", errors.length + trouble.console.length + trouble.requests.length + trouble.http.length === 0, [...errors, ...trouble.console, ...trouble.requests, ...trouble.http].slice(0, 4).join(" | "));
  });

  await step("first message without a model", async () => {
    const box = page.getByPlaceholder(/^Message /).first();
    await box.fill("hello"); await box.press("Enter"); await wait(2500);
    const body = await text(); await shot("message-without-model");
    check("a first message without an AI model gives the person a way forward, not silence", /no AI model yet|Settings → AI/i.test(body) && !/provider instance ""/.test(body), body.slice(0, 260));
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
  // What the app wrote about itself: on a failure this is where the reason is.
  for (const dir of [join(scratch, "AppData/Roaming/AIKINGBOT/logs"), join(scratch, ".config/AIKINGBOT/logs")]) if (existsSync(dir)) cpSync(dir, join(out, "app-logs"), { recursive: true });
  await electronApp?.close().catch(() => {}); auth.close();
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 1500).unref();
}
