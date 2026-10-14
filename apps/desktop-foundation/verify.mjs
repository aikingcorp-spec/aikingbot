import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { runtimeRoot, sourceRoot } from "./setup.mjs";

const info = JSON.parse(readFileSync(join(runtimeRoot, "offline-runtime.json"), "utf8"));
assert.equal(info.mode, "offline-verification", "Verification requires an explicitly launched offline fixture.");
assert.equal(new URL(info.apiUrl).hostname, "127.0.0.1");
assert.equal(new URL(info.uiUrl).hostname, "127.0.0.1");
assert.equal(info.sourceCommit, "93b3c24cdade51e362e443d2387a9f37eb7e115c");
process.kill(info.pid, 0);
assert.equal(existsSync(join(sourceRoot, "enterprise")), false);
const evidence = join(runtimeRoot, "evidence");
mkdirSync(evidence, { recursive: true });

function control(...args) {
  return JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "scripts/control-omb.ts", ...args, "--url", info.apiUrl], {
    cwd: sourceRoot, encoding: "utf8", timeout: 60_000,
  }));
}

const edition = await fetch(`${info.apiUrl}/api/edition`).then((r) => r.json());
assert.equal(edition.edition, "oss");
assert.deepEqual(edition.features, []);
const brand = await fetch(`${info.apiUrl}/api/brand`).then((r) => r.json());
assert.equal(brand.brand.name, "AIKINGBOT");
const ids = {};
const existing = await fetch(`${info.apiUrl}/api/bots`).then((r) => r.json());
for (const name of ["AIKING Assistant", "Research", "Builder"]) {
  ids[name] = existing.bots.find((b) => b.name === name)?.id ?? control("new-bot", "--name", name).bot.id;
}
const cdp = process.env.AIKING_VERIFY_CDP;
let browser;
try {
  browser = cdp
    ? await chromium.connectOverCDP(cdp)
    : await chromium.launch({ executablePath: process.env.AIKING_CHROME || "/usr/bin/chromium", headless: true });
  const context = cdp ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = cdp
    ? context.pages().find((p) => new URL(p.url()).origin === new URL(info.uiUrl).origin)
    : await context.newPage();
  assert.ok(page, "The owned desktop must show the fixture URL.");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (!cdp) await page.goto(info.uiUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("textbox", { name: "Search agents and messages" }).waitFor({ timeout: 120_000 });
  for (let i = 0; i < 2; i++) {
    const skip = page.getByRole("button", { name: "Skip tour", exact: true });
    if (await skip.isVisible()) await skip.click();
  }
  const closeSettings = page.getByRole("button", { name: "Close settings", exact: true });
  if (await closeSettings.isVisible()) await closeSettings.click();
  await page.getByRole("button", { name: "Rename AIKING Assistant", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Message AIKING Assistant", exact: true });
  await composer.waitFor();
  const conversation = page.getByRole("log", { name: "Conversation with AIKING Assistant", exact: true });
  const threadId = control("messages", "--bot", ids["AIKING Assistant"]).taskId;
  const prompt = `Check that AIKINGBOT can send a message, receive a reply, and keep the conversation. Verification ${Date.now()}.`;
  await composer.fill(prompt);
  await composer.press("Enter");
  await conversation.getByText(prompt, { exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForFunction(async ({ threadId, prompt }) => {
    const response = await fetch(`/api/threads/${threadId}/messages`);
    if (!response.ok) return false;
    return JSON.stringify(await response.json()).includes(prompt);
  }, { threadId, prompt }, { timeout: 30_000 });
  control("wait", "--bot", ids["AIKING Assistant"], "--timeout", "30");
  const messages = control("messages", "--bot", ids["AIKING Assistant"]);
  assert.ok(JSON.stringify(messages).includes(prompt));
  const userIndex = messages.messages.findLastIndex((m) => m.text === prompt);
  const currentReply = messages.messages.slice(userIndex + 1).find((m) => m.role === "bot" && m.kind === "text");
  assert.ok(currentReply, "The provider must reply after this verification message.");
  const reply = currentReply.text;
  assert.ok(JSON.stringify(messages).includes(reply));
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("textbox", { name: "Message AIKING Assistant", exact: true }).waitFor({ timeout: 120_000 });
  await conversation.getByText(prompt, { exact: true }).waitFor();
  await conversation.getByText(reply, { exact: true }).last().waitFor();
  assert.equal(await page.title(), "AIKINGBOT");
  await page.screenshot({ path: join(evidence, cdp ? "electron-chat.png" : "browser-chat.png") });
  await page.getByRole("button", { name: "You", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: /^Meadow/ }).click();
  await page.screenshot({ path: join(evidence, cdp ? "electron-settings.png" : "browser-settings.png") });
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("textbox", { name: "Message AIKING Assistant", exact: true }).waitFor({ timeout: 120_000 });
  assert.equal(await page.evaluate(() => localStorage.getItem("omb-skin")), "meadow");
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({ path: join(evidence, cdp ? "electron-apps.png" : "browser-apps.png") });
  await page.keyboard.press("Escape");
  await page.screenshot({ path: join(evidence, cdp ? "electron-workspace.png" : "browser-workspace.png") });
  assert.deepEqual(errors, []);
  const result = { ok: true, mode: info.mode, surface: cdp ? "electron" : "browser", sourceCommit: info.sourceCommit,
    checks: ["oss-edition", "enterprise-excluded", "aiking-brand", "create-agents", "composer-send", "provider-reply", "saved-transcript", "reload-restores-chat", "settings-open-close", "theme-persists", "apps-panel", "no-renderer-errors"],
    realProviderVerified: false, externalConnectorActionsVerified: false, coreIntegrated: false };
  writeFileSync(join(evidence, cdp ? "electron-verification.json" : "browser-verification.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
}
