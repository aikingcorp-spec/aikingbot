// Copyright (c) 2026 AIKING.
// Walks the first-run journey of an INSTALLED/packaged desktop app and records what a person sees.
// Report mode: it never fails the job; it writes screenshots, visible text and findings so a review can
// compare the real EXE with the intended journey. Findings become a hard gate later.
//
//   AIKING_PACKAGE_EXECUTABLE=<path to AIKINGBOT.exe> AIKING_JOURNEY_LANG=vi|en node exe-journey.mjs [out-dir]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const binary = process.env.AIKING_PACKAGE_EXECUTABLE;
if (!binary || !existsSync(binary)) { console.error("Set AIKING_PACKAGE_EXECUTABLE to the installed app."); process.exit(2); }
const lang = process.env.AIKING_JOURNEY_LANG === "en" ? "en" : "vi";
const mode = process.env.AIKING_JOURNEY_MODE === "signin" ? "signin" : "main";
const out = join(process.argv[2] || join(process.cwd(), "journey-evidence"), mode === "signin" ? `${lang}-signin` : lang);
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "aiking-journey-"));
const portServer = createServer(); await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));

const passthrough = ["PATH", "SystemRoot", "DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "APPIMAGE_EXTRACT_AND_RUN", "ComSpec", "PATHEXT", "WINDIR"];
const env = Object.fromEntries(passthrough.filter(key => process.env[key]).map(key => [key, process.env[key]]));
const args = [`--user-data-dir=${join(scratch, "electron")}`, `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--lang=${lang === "vi" ? "vi-VN" : "en-US"}`];
if (process.env.AIKING_JOURNEY_NO_SANDBOX) args.push("--no-sandbox");
const child = spawn(binary, args, {
  cwd: scratch, stdio: ["ignore", "pipe", "pipe"],
  env: { ...env, HOME: scratch, USERPROFILE: scratch, APPDATA: join(scratch, "AppData/Roaming"), LOCALAPPDATA: join(scratch, "AppData/Local"), XDG_CONFIG_HOME: join(scratch, ".config"), XDG_CACHE_HOME: join(scratch, ".cache"), TEMP: scratch, TMP: scratch },
});
let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });

const report = { lang, at: new Date().toISOString(), binary: binary.replace(/[A-Za-z]:\\Users\\[^\\]+/, "C:\\Users\\<user>"), steps: [], findings: [], pageErrors: [] };
// Names that must not appear anywhere in the app (a regular expression), set by whoever runs the journey.
const BRAND = process.env.AIKING_FORBIDDEN_NAMES ? new RegExp(process.env.AIKING_FORBIDDEN_NAMES, "i") : /(?!)/;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let page; let index = 0;

async function snap(name, note) {
  const file = `${String(++index).padStart(2, "0")}-${name}`;
  let text = "";
  try { await page.screenshot({ path: join(out, `${file}.png`) }); text = (await page.locator("body").innerText({ timeout: 5000 })).slice(0, 6000); } catch (error) { text = `(could not read: ${error.message})`; }
  if (BRAND.test(text)) report.findings.push({ step: name, kind: "brand", detail: (text.match(new RegExp(`.{0,60}(${BRAND.source}).{0,60}`, "i")) || [""])[0].replace(/\s+/g, " ") });
  // What a person can click here, and which visible lines look untranslated in a Vietnamese session.
  const controls = await page.evaluate(() => [...document.querySelectorAll('button, [role="tab"], a[href], [role="menuitem"]')]
    .filter(el => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== "hidden"; })
    .map(el => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 60))
    .filter(Boolean).slice(0, 70)).catch(() => []);
  const untranslated = lang === "vi" ? text.split("\n").map(line => line.trim()).filter(line => line.length > 3 && !/[à-ỹÀ-Ỹ]/.test(line) && /\b(the|this|your|you|and|for|with|to|of|is|are|what|new|settings|skip|computer|agent|messages|connect|sign|account|server)\b/i.test(line) && !/AIKINGBOT|@|\d{1,2}:\d{2}/.test(line)).slice(0, 12) : [];
  report.steps.push({ step: name, note, controls, untranslated, text: text.slice(0, 1500) });
  return text;
}
async function attempt(name, fn) {
  try { return await fn(); } catch (error) { report.findings.push({ step: name, kind: "step-failed", detail: String(error.message || error).slice(0, 400) }); await snap(`${name}-failed`).catch(() => {}); }
}
const visibleButton = async regex => {
  const buttons = page.getByRole("button", { name: regex });
  for (let i = 0; i < await buttons.count(); i++) if (await buttons.nth(i).isVisible().catch(() => false)) return buttons.nth(i);
  return null;
};

let browser;
try {
  const deadline = Date.now() + 120000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`App exited early (${child.exitCode}): ${output.slice(-1500)}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch {}
    if (Date.now() > deadline) throw new Error("App did not expose its debug endpoint");
    await wait(300);
  }
  const context = browser.contexts()[0];
  while (Date.now() < deadline && !page) { page = context.pages().find(candidate => /^http:\/\/127\.0\.0\.1:\d+\//.test(candidate.url())); if (!page) await wait(250); }
  if (!page) throw new Error("The app window never loaded its embedded server");
  page.on("pageerror", error => report.pageErrors.push(String(error.message).slice(0, 300)));
  await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {});
  await page.getByRole("textbox").first().waitFor({ timeout: 120000 }).catch(() => {});
  await wait(1500);

  // The main journey tests the app behind the mandatory sign-in screen, so the account step is recorded as done through the
  // app's own settings API (as the Electron tour does) and the window reloaded. The "signin" mode covers that screen itself.
  if (mode === "main" && process.env.AIKING_JOURNEY_FRESH !== "1") {
    await page.evaluate(() => fetch("/api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ onboarding: { completedAt: new Date().toISOString(), version: 1 } }) }).then(response => response.status)).then(status => { report.accountStepSeed = status; }).catch(error => { report.accountStepSeed = String(error.message).slice(0, 120); });
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {}); await wait(4000);
  }

  // 1. First-run guide, step by step, exactly as a new person would click through it.
  await snap("first-run-welcome", "first screen after install");
  await attempt("first-run-profile", async () => {
    const dialog = page.getByRole("dialog").first();
    const scope = (await dialog.isVisible().catch(() => false)) ? dialog : page;
    const fields = scope.locator("input:not([type=email]):not([type=hidden])");
    if (await fields.count()) await fields.first().fill("Kiem Thu").catch(() => {});
    const email = scope.locator('input[type="email"], input[placeholder*="@"]').first();
    if (await email.count()) await email.fill("kiem.thu@example.com").catch(() => {});
  });
  if (mode === "signin") await attempt("account-sign-in-entry", async () => {
    // The first screen is the email form of the AIKING account, inside the app. A real code cannot be read here, so the journey
    // checks that the form is there quickly, the window stays on this computer, and that skipping is not offered.
    const shownAfter = await (async () => { const t0 = Date.now(); for (let waited = 0; waited < 25000; waited += 250) { if (await page.locator("[data-signin-email]").count().catch(() => 0)) return Date.now() - t0; await wait(250); } return null; })();
    report.signInRenderedAfterMs = shownAfter;
    report.signInUrl = page.url().replace(/[?#].*$/, "");
    report.windowNowShowsRemote = !/^http:\/\/127\.0\.0\.1/.test(page.url());
    const text = await snap("account-sign-in", "the first screen: email form inside the app");
    if (shownAfter === null) report.findings.push({ step: "account-sign-in-entry", kind: "missing", detail: "the email form did not appear on the first screen: " + text.slice(0, 120).replace(/\s+/g, " ") });
    if (report.windowNowShowsRemote) report.findings.push({ step: "account-sign-in-entry", kind: "left-this-computer", detail: `the window is on ${report.signInUrl}, not on this computer` });
    if (await visibleButton(/skip tour|bỏ qua hướng dẫn|maybe later|để sau/i)) report.findings.push({ step: "account-sign-in-entry", kind: "skippable", detail: "the first screen offers a way to skip signing in" });
  });
  if (mode === "signin") throw Object.assign(new Error("signin-mode-done"), { benign: true });
  const advance = /^(continue|tiếp tục|next|tiếp theo|finish|hoàn tất|xong|got it|đã hiểu)/i;
  const skipNow = /(maybe later|để sau|skip for now|bỏ qua|skip tour)/i;
  for (let step = 1; step <= 14; step++) {
    const dialog = page.getByRole("dialog").first();
    if (!(await dialog.isVisible().catch(() => false)) && step > 1) break;
    const button = (await visibleButton(advance)) || (await visibleButton(skipNow));
    if (!button) break;
    const label = (await button.innerText().catch(() => "?")).trim().slice(0, 40);
    await button.click().catch(() => {});
    await wait(900);
    await snap(`guide-step-${String(step).padStart(2, "0")}`, `clicked "${label}"`);
  }
  await attempt("close-overlays", async () => { for (let i = 0; i < 4; i++) { const skip = await visibleButton(/skip tour|bỏ qua/i); if (!skip) break; await skip.click(); await wait(400); } });

  // 2. The shell a person lands in.
  const shell = await snap("shell", "main window after the guide");
  report.rail = await page.locator("[data-workspace-rail]").count();
  report.hasServerTiles = await page.locator("[data-server-tile]").count();

  // 2b. A person tries the obvious things in the first minutes.
  const tryOpen = async (name, regex, note, settle = 1200) => attempt(name, async () => {
    const button = await visibleButton(regex);
    if (!button) { report.findings.push({ step: name, kind: "missing", detail: `no control matching ${regex}` }); return; }
    await button.click({ timeout: 5000 }); await wait(settle); await snap(name, note);
    await page.keyboard.press("Escape").catch(() => {}); await wait(400);
  });
  await attempt("first-message", async () => {
    const box = page.getByRole("textbox", { name: /^(message|nhắn)/i }).first();
    await box.fill(lang === "vi" ? "Xin chào, bạn giúp được gì cho tôi?" : "Hello, what can you do for me?");
    await page.keyboard.press("Enter"); await wait(9000);
    const text = await snap("first-message-result", "after sending the first message with no provider connected");
    if (/đã có sự cố|something went wrong|error|lỗi/i.test(text)) report.findings.push({ step: "first-message", kind: "chat-error", detail: (text.match(/.{0,60}(đã có sự cố|something went wrong|error|lỗi).{0,80}/i) || [""])[0].replace(/\s+/g, " ") });
  });
  await tryOpen("model-picker", /dùng mô hình|use model|model/i, "model chip of the agent");
  await tryOpen("computer-panel", /máy tính của agent|agent.?s computer|computer/i, "the agent's computer panel");
  await tryOpen("tools-menu", /^(ứng dụng|tools|apps)/i, "tools / apps menu");
  await tryOpen("marketplace", /^marketplace/i, "marketplace", 2500);
  await tryOpen("new-or-share", /mới hoặc chia sẻ|new or share|new/i, "new agent / share menu");
  await tryOpen("account-menu", new RegExp("^" + "Kiem Thu" + "|account|tài khoản", "i"), "account row (bottom-left)");

  // 3. The "+" Add a server entry and its choices.
  await attempt("add-server-panel", async () => {
    await page.locator("[data-server-add]").first().click({ timeout: 5000 });
    await wait(900);
    await snap("add-server-panel", "choices behind the + button");
    const create = page.getByText(/create my server|tạo server của tôi/i).first();
    if (await create.isVisible().catch(() => false)) { await create.click(); await wait(700); await snap("create-server-form", "form shown to create a Server"); }
    const close = await visibleButton(/close|đóng/i); if (close) { await close.click().catch(() => {}); await wait(400); }
  });

  // 4. Voice call as a user would start it.
  await attempt("voice-call", async () => {
    const call = page.locator('button[aria-label*="call" i], button[aria-label*="gọi" i], button[title*="call" i], button[title*="gọi" i], button:has(svg.lucide-phone)').first();
    if (!(await call.count())) { report.findings.push({ step: "voice-call", kind: "missing", detail: "no call button in the composer" }); return; }
    await call.click({ timeout: 5000 }); await wait(1200);
    await snap("voice-panel", "call panel just opened");
    const start = await visibleButton(/start.*call|bắt đầu/i);
    if (start) { await start.click().catch(() => {}); await wait(6000); const text = await snap("voice-after-start", "after pressing start"); if (/could not be started|invalid url|không thể/i.test(text)) report.findings.push({ step: "voice-call", kind: "voice-error", detail: (text.match(/.{0,80}(could not be started|invalid url).{0,60}/i) || [text.slice(0, 120)])[0].replace(/\s+/g, " ") }); }
  });

  // 5. Create a local Server the way a person does: the native confirmation appears, and on Windows a helper presses
  // its "Continue" button (test side only; the product is untouched). Whatever the app answers, or throws, is recorded.
  await attempt("create-server-probe", async () => {
    const started = await page.evaluate(() => {
      const api = window.ogb?.workspaces;
      if (!api?.create) return { available: false };
      window.__serverProbe = api.create("Journey probe").then(result => ({ settled: "result", result }), error => ({ settled: "error", message: String(error?.message || error).slice(0, 500) }));
      return { available: true };
    });
    report.createServerProbe = started;
    if (!started.available) return;
    let clicked = false;
    if (process.platform === "win32") {
      await wait(2500);
      const script = `Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes;
        $root=[Windows.Automation.AutomationElement]::RootElement;
        for($i=0;$i -lt 20;$i++){
          $c=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,'Continue');
          $b=$root.FindFirst([Windows.Automation.TreeScope]::Descendants,$c);
          if($b){ $b.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke(); Write-Output 'clicked'; exit 0 }
          Start-Sleep -Milliseconds 500 }
        Write-Output 'no-dialog'`;
      const run = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 30000 });
      clicked = /clicked/.test(String(run.stdout));
      report.createServerProbe = { ...report.createServerProbe, dialogClicked: clicked, helper: String(run.stdout || run.stderr).trim().slice(0, 80) };
    }
    const settled = await Promise.race([
      page.evaluate(() => window.__serverProbe).catch(error => ({ settled: "page-changed", message: String(error.message).slice(0, 120) })),
      wait(clicked ? 90000 : 4000).then(() => ({ settled: clicked ? "timeout-after-click-90s" : "waiting-for-native-dialog" })),
    ]);
    report.createServerProbe = { ...report.createServerProbe, ...settled };
    if (clicked) await wait(3000);
    if (settled.settled === "error") report.findings.push({ step: "create-server", kind: "ipc-error", detail: settled.message });
    if (clicked && settled.settled === "result" && settled.result?.ok === false) report.findings.push({ step: "create-server", kind: "create-refused", detail: JSON.stringify(settled.result).slice(0, 200) });
  });

  // 6. Settings, including the upstream "connect to another computer" page.
  await attempt("settings", async () => {
    await page.keyboard.press("Escape").catch(() => {});
    const settings = page.locator('button[aria-label*="settings" i], button[aria-label*="cài đặt" i], [data-testid="settings"]').first();
    if (await settings.count()) { await settings.click(); await wait(1000); await snap("settings", "settings opened"); }
    const computers = page.getByText(/computers|máy tính/i).first();
    if (await computers.isVisible().catch(() => false)) { await computers.click(); await wait(900); await snap("settings-computers", "computers section"); }
  });
} catch (error) {
  if (!error.benign) { report.fatal = String(error.message || error); console.error(report.fatal); }
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) { const exited = new Promise(resolve => child.once("exit", resolve)); const timer = setTimeout(() => child.kill("SIGKILL"), 15000); child.kill(); await exited; clearTimeout(timer); }
  const log = join(scratch, "electron/logs/server.log");
  if (existsSync(log)) {
    const text = readFileSync(log, "utf8"); report.serverLogTail = text.slice(-2500);
    if (BRAND.test(text)) report.findings.push({ step: "server-log", kind: "brand", detail: (text.match(new RegExp(`.*(${BRAND.source}).*`, "i")) || [""])[0].slice(0, 160) });
  }
  if (report.pageErrors.length) report.findings.push({ step: "renderer", kind: "page-errors", detail: report.pageErrors.slice(0, 5).join(" | ") });
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(out, "summary.md"), [`### ${lang}: ${report.steps.length} screens, ${report.findings.length} findings`,
    ...report.findings.map(f => `- [${f.kind}] ${f.step}: ${String(f.detail).replace(/\s+/g, " ").slice(0, 220)}`),
    ...report.steps.filter(x => x.untranslated?.length).map(x => `- [untranslated?] ${x.step}: ${x.untranslated.join(" · ").slice(0, 220)}`),
    report.createServerProbe ? `- create-server probe: ${JSON.stringify(report.createServerProbe)}` : ""].join("\n") + "\n");
  console.log(`journey(${lang}): ${report.steps.length} screens, ${report.findings.length} findings → ${out}`);
  for (const finding of report.findings) console.log(` - [${finding.kind}] ${finding.step}: ${finding.detail}`);
  process.exit(report.fatal ? 1 : 0);
}
