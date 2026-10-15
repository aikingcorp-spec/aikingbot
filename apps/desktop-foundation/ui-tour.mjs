// AIKINGBOT stage 2 UI tour: drives every main screen of the real renderer,
// asserts what a person sees, and saves one screenshot per screen plus a JSON
// report under .aikingbot-foundation/evidence/stage2/.
//
// Run against an owned offline stack (browser or Electron):
//   node apps/desktop-foundation/dev.mjs --offline
//   AIKING_CHROME=/path/to/chrome node apps/desktop-foundation/ui-tour.mjs
// or, for the Electron renderer:
//   AIKING_DESKTOP_DEBUG_PORT=9223 node apps/desktop-foundation/dev.mjs --offline --desktop
//   AIKING_VERIFY_CDP=http://127.0.0.1:9223 node apps/desktop-foundation/ui-tour.mjs
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { runtimeRoot } from "./setup.mjs";

const info = JSON.parse(readFileSync(join(runtimeRoot, "offline-runtime.json"), "utf8"));
assert.equal(info.mode, "offline-verification", "The tour requires an explicitly launched offline fixture.");
assert.equal(new URL(info.uiUrl).hostname, "127.0.0.1");
const stage = process.env.AIKING_VERIFY_STAGE === "shipping" ? "shipping" : "stage2";
const out = join(runtimeRoot, "evidence", stage, ...(stage === "shipping" ? ["ui-tour"] : []));
mkdirSync(out, { recursive: true });

const width = Number(process.env.AIKING_TOUR_WIDTH || 1440);
const height = Number(process.env.AIKING_TOUR_HEIGHT || 900);
const cdp = process.env.AIKING_VERIFY_CDP;
const browser = cdp
  ? await chromium.connectOverCDP(cdp)
  : await chromium.launch({ executablePath: process.env.AIKING_CHROME || "/usr/bin/chromium", headless: true });
const context = cdp ? browser.contexts()[0] : await browser.newContext({ viewport: { width, height }, colorScheme: "dark" });
let page = cdp
  ? context.pages().find((p) => new URL(p.url()).origin === new URL(info.uiUrl).origin)
  : await context.newPage();
if (cdp) {
  const deadline = Date.now() + 30000;
  while (!page && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    page = context.pages().find(p => new URL(p.url()).origin === new URL(info.uiUrl).origin);
  }
}
assert.ok(page, "The owned desktop must show the fixture URL.");
await page.setViewportSize({ width, height });
const skin = process.env.AIKING_TOUR_SKIN;
const advanced = process.env.AIKING_TOUR_ADVANCED === "1";
if (!cdp) {
  await context.addInitScript(({ id, on }) => {
    try {
      if (id) localStorage.setItem("omb-skin", id);
      localStorage.setItem("omb-advanced-mode", on ? "1" : "0");
    } catch {}
  }, { id: skin, on: advanced });
}
const surface = `${cdp ? "electron" : "browser"}${skin ? `-${skin}` : ""}${advanced ? "-advanced" : ""}${width !== 1440 ? `-${width}` : ""}`;
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
if (!cdp) await page.goto(info.uiUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
else if (skin) {
  await page.evaluate(({ id, on }) => { localStorage.setItem("omb-skin", id); localStorage.setItem("omb-advanced-mode", on ? "1" : "0"); }, { id: skin, on: advanced });
  await page.reload({ waitUntil: "domcontentloaded" });
}

const results = [];
const settle = () => page.waitForTimeout(450);
class Skip extends Error {}
async function step(name, run) {
  const started = Date.now();
  try {
    await run();
    await settle();
    await page.screenshot({ path: join(out, `${surface}-${name}.png`) });
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`ok   ${name}`);
  } catch (error) {
    if (error instanceof Skip) {
      results.push({ name, ok: true, skipped: error.message });
      console.log(`skip ${name}: ${error.message}`);
      return;
    }
    const at = String(error?.stack ?? "").split("\n").find((line) => line.includes("ui-tour.mjs"))?.trim();
    results.push({ name, ok: false, error: String(error?.message ?? error).split("\n")[0], at });
    console.log(`FAIL ${name}: ${String(error?.message ?? error).split("\n")[0]} ${at ?? ""}`);
    await page.screenshot({ path: join(out, `${surface}-${name}-failed.png`) }).catch(() => {});
  }
}
async function closeOverlays() {
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(120);
  }
}
const button = (name, exact = true) => page.getByRole("button", { name, exact });
/** A small real PNG (a diagonal gradient), so the avatar upload goes through the actual image path. */
function gradientPng(size = 96) {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = [0];
    for (let x = 0; x < size; x += 1) row.push(40 + x, 120 + Math.round(y / 2), 200 - x);
    rows.push(Buffer.from(row));
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
async function waitForBot(id, test, timeout = 30_000) {
  const until = Date.now() + timeout;
  for (;;) {
    const bot = (await apiBots()).find((candidate) => candidate.id === id);
    if (bot && test(bot)) return bot;
    if (Date.now() > until) throw new Error(`Agent ${id} did not reach the expected saved state: ${JSON.stringify(bot ? { color: bot.color, body: bot.mascotBody, expression: bot.mascotExpression, crop: bot.avatarCrop, url: Boolean(bot.avatarUrl) } : null)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
async function apiBots() {
  return (await fetch(`${info.apiUrl}/api/bots`).then((r) => r.json())).bots;
}
async function openLook() {
  const reset = page.getByRole("button", { name: "Reset mascot" });
  const look = page.getByRole("button", { name: /^Change how .* looks$/ });
  for (let attempt = 0; attempt < 3 && !(await reset.isVisible().catch(() => false)); attempt += 1) {
    // The profile button toggles the panel, so open it only when the Look entry is not already there.
    if (!(await look.isVisible().catch(() => false))) await page.getByRole("button", { name: /^Open .*'s profile$/ }).first().click();
    // Advanced mode lists the profile as sections; the avatar editor sits under Identity.
    const identity = page.getByRole("button", { name: /^Identity/ }).first();
    if (await identity.isVisible().catch(() => false)) {
      if ((await identity.getAttribute("aria-expanded")) !== "true") await identity.click();
    } else {
      await look.waitFor({ timeout: 5_000 }).then(() => look.click()).catch(() => {});
    }
    await reset.waitFor({ timeout: 5_000 }).catch(() => {});
  }
  await reset.waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "Reset mascot" }).waitFor();
}


const composer = page.getByRole("textbox", { name: /^Message / }).first();
await composer.waitFor({ timeout: 120_000 });
// A clean profile opens the first-run welcome: it offers this computer or the AIKINGBOT workspace, and can be skipped.
const welcome = page.getByRole("dialog", { name: "Welcome tour" });
if (await welcome.waitFor({ timeout: 15_000 }).then(() => true, () => false)) {
  await step("first-run-welcome", async () => {
    await welcome.getByText("Welcome to AIKINGBOT").waitFor();
    if (cdp) await welcome.getByRole("button", { name: "Have an AIKINGBOT account? Sign in to your workspace" }).waitFor();
  });
  await welcome.getByRole("button", { name: "Skip tour", exact: true }).click();
  await welcome.waitFor({ state: "detached" });
}
const skip = button("Skip tour");
for (let i = 0; i < 3 && await skip.isVisible().catch(() => false); i++) { await skip.click(); await page.waitForTimeout(300); }
await closeOverlays();

await step("shell-chat", async () => {
  await page.getByRole("navigation", { name: "Workspaces" }).waitFor();
  await page.getByRole("tab", { name: "Agents", selected: true }).waitFor();
  await composer.waitFor();
});

await step("composer-typing", async () => {
  await composer.fill("Draft a launch plan for the AIKING media pipeline");
  assert.equal(await button("Send message").isEnabled(), true);
});
await composer.fill("");

await step("sidebar-search-empty", async () => {
  await page.getByRole("textbox", { name: "Search agents and messages" }).fill("zzzz-no-match");
  await page.getByText(/zzzz-no-match/).first().waitFor();
});
await page.getByRole("textbox", { name: "Search agents and messages" }).fill("");

const market = () => page.getByRole("dialog", { name: "Marketplace" });
async function openMarket(tab) {
  if (!(await market().isVisible().catch(() => false))) await button("Marketplace").click();
  await market().waitFor();
  if (await page.getByRole("navigation", { name: "Breadcrumb" }).isVisible().catch(() => false)) {
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button", { name: "Marketplace" }).click();
  }
  await market().getByRole("tab", { name: tab }).click();
  await market().getByRole("tab", { name: tab, selected: true }).waitFor();
}
let producerId = null;

await step("marketplace-agents", async () => {
  await openMarket("Agents");
  assert.ok(await market().locator("[data-market-card]").count() >= 8);
});

await step("marketplace-filter-search", async () => {
  const filter = market().locator('button[aria-haspopup="menu"]');
  await filter.click();
  await page.getByRole("menuitemradio", { name: "Research" }).click();
  await market().getByRole("button", { name: "Research Analyst, Details" }).waitFor();
  assert.equal(await market().getByRole("button", { name: "Media Producer, Details" }).count(), 0);
  await filter.click();
  await page.getByRole("menuitemradio", { name: "All categories" }).click();
  await market().getByRole("textbox", { name: "Search" }).fill("tiktok");
  await market().getByRole("button", { name: "Media Producer, Details" }).waitFor();
  await market().getByRole("textbox", { name: "Search" }).fill("");
});

await step("marketplace-agent-detail", async () => {
  await market().getByRole("button", { name: "Media Producer, Details" }).click();
  await page.getByRole("navigation", { name: "Breadcrumb" }).waitFor();
  await page.locator('[data-listing-detail="media-producer"]').getByText("TikTok hook writer").waitFor();
});

await step("marketplace-install-agent", async () => {
  await button("Add agent").click();
  await button("Open agent").waitFor({ timeout: 60_000 });
  const producer = (await apiBots()).filter((bot) => bot.name === "Producer").at(-1);
  assert.ok(producer, "The template created an agent on the host.");
  producerId = producer.id;
  assert.deepEqual([producer.color, producer.mascotBody, producer.mascotExpression], ["orange", "squircle", "proud"]);
  assert.match(producer.soul ?? "", /short-form media/);
  const skills = (await fetch(`${info.apiUrl}/api/bots/${producer.id}/skills`).then((r) => r.json())).skills.map((skill) => skill.name).sort();
  assert.deepEqual(skills, ["image-prompt-builder", "tiktok-hook-writer", "video-shot-list"]);
  const memory = await fetch(`${info.apiUrl}/api/bots/${producer.id}/memory/file?path=MEMORY.md`).then((r) => r.json()).catch(() => ({}));
  if (typeof memory.text === "string") assert.match(memory.text, /9:16/);
});

await step("marketplace-uninstall-agent", async () => {
  await button("Remove agent").click();
  await button("Confirm remove").click();
  await button("Add agent").waitFor({ timeout: 30_000 });
  const until = Date.now() + 20_000;
  while ((await apiBots()).some((bot) => bot.id === producerId)) {
    assert.ok(Date.now() < until, "The removed agent is gone from the host.");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
});

let skillAgentId = null;
await step("marketplace-skill-assign", async () => {
  skillAgentId = (await fetch(`${info.apiUrl}/api/bots`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Skill QA" }) }).then((r) => r.json())).bot.id;
  await openMarket("Skills");
  await market().getByRole("button", { name: "Campaign brief, Details" }).click();
  const row = page.locator(`[data-skill-agent="${skillAgentId}"]`);
  await row.getByRole("button", { name: "Add to Skill QA" }).click();
  await row.getByRole("checkbox", { name: "Use for Skill QA" }).waitFor({ timeout: 30_000 });
  const listed = (await fetch(`${info.apiUrl}/api/bots/${skillAgentId}/skills`).then((r) => r.json())).skills;
  assert.equal(listed.find((skill) => skill.name === "campaign-brief")?.enabled, true);
});

await step("marketplace-skill-toggle-remove", async () => {
  const row = page.locator(`[data-skill-agent="${skillAgentId}"]`);
  // The row updates as the request is sent; read the server until it has applied the change (bounded).
  const skill = async () => (await fetch(`${info.apiUrl}/api/bots/${skillAgentId}/skills`).then((r) => r.json())).skills.find((entry) => entry.name === "campaign-brief");
  const settled = async (check) => { for (const deadline = Date.now() + 15_000; !check(await skill()) && Date.now() < deadline;) await new Promise((resolve) => setTimeout(resolve, 250)); return skill(); };
  await row.getByRole("checkbox", { name: "Use for Skill QA" }).uncheck();
  await row.getByText("Off").waitFor({ timeout: 30_000 });
  assert.equal((await settled((entry) => entry?.enabled === false))?.enabled, false);
  await row.getByRole("button", { name: "Remove from Skill QA" }).click();
  await row.getByRole("button", { name: "Add to Skill QA" }).waitFor({ timeout: 30_000 });
  assert.equal(await settled((entry) => entry === undefined), undefined);
});

await step("marketplace-mcp-install-connected", async () => {
  for (const name of ["aiking-toolbox", "filesystem"]) await fetch(`${info.apiUrl}/api/mcp/servers/${name}`, { method: "DELETE" }).catch(() => {});
  await openMarket("Apps");
  await market().getByRole("button", { name: "Install AIKING Toolbox" }).click();
  const card = market().locator("[data-market-card]").filter({ hasText: "AIKING Toolbox" });
  await card.locator('[data-install-state="connected"]').waitFor({ timeout: 30_000 });
  const servers = (await fetch(`${info.apiUrl}/api/mcp/servers`).then((r) => r.json())).servers;
  assert.ok(servers.some((server) => server.name === "aiking-toolbox" && server.enabled !== false));
});

await step("marketplace-mcp-error-state", async () => {
  await market().getByRole("button", { name: "Filesystem, Details" }).click();
  await button("Install").click();
  await page.locator('[data-listing-detail="filesystem-mcp"] [data-install-state]').filter({ hasText: /Connected|Error/ }).waitFor({ timeout: 60_000 });
  const state = await page.locator('[data-listing-detail="filesystem-mcp"] [data-install-state]').first().getAttribute("data-install-state");
  console.log(`     filesystem MCP reported: ${state} (needs npx and network; offline it should be "error")`);
  await button("Remove").click();
  await button("Install").waitFor({ timeout: 30_000 });
});

await step("marketplace-mcp-remove", async () => {
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button", { name: "Marketplace" }).click();
  await market().getByRole("button", { name: "AIKING Toolbox, Details" }).click();
  await button("Test").click();
  await page.locator('[data-listing-detail="aiking-toolbox"] [data-install-state="connected"]').waitFor({ timeout: 30_000 });
  await button("Remove").click();
  await button("Install").waitFor({ timeout: 30_000 });
  const servers = (await fetch(`${info.apiUrl}/api/mcp/servers`).then((r) => r.json())).servers;
  assert.equal(servers.some((server) => server.name === "aiking-toolbox"), false);
});

await step("marketplace-composio-connect", async () => {
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button", { name: "Marketplace" }).click();
  await market().getByRole("button", { name: "Connect GitHub" }).click();
  await market().locator("[data-apps-embedded]").waitFor();
  await market().locator('[data-app-tile="github"]').waitFor();
});
await closeOverlays();

await step("create-agent-from-template", async () => {
  await openMarket("Agents");
  await market().getByRole("button", { name: "Code Reviewer, Details" }).click();
  await button("Add agent").click();
  await button("Open agent").click({ timeout: 60_000 });
  await page.getByRole("textbox", { name: /^Message Reviewer/ }).waitFor({ timeout: 60_000 });
});

await step("conversation-reply", async () => {
  const input = page.getByRole("textbox", { name: /^Message Reviewer/ });
  await input.fill("Plan the launch of the AIKING media pipeline for a matte tumbler TikTok ad.");
  await button("Send message").click();
  await page.getByRole("log", { name: /^Conversation with Reviewer/ }).getByText(/launch plan|AIKINGBOT is running/).first().waitFor({ timeout: 120_000 });
});

await step("tool-activity", async () => {
  const run = page.locator("[data-activity-run] > button").last();
  await run.waitFor({ timeout: 30_000 });
  await run.click();
  assert.equal(await run.getAttribute("aria-expanded"), "true");
});

await step("new-agent", async () => {
  await button("New or share").click();
  await button("New agent").click();
  await page.locator("[data-new-agent-screen]").waitFor();
  await page.getByRole("textbox", { name: "Name" }).fill("Launch Scout");
  await page.getByRole("textbox", { name: /What should this agent help with/ }).fill("Find TikTok hooks for product launches.");
  await page.getByRole("radio", { name: "orange color" }).click();
  await page.getByRole("radio", { name: "Diamond shape" }).click();
});

await step("new-agent-more-options", async () => {
  await button("More options").click();
  const dialog = page.getByRole("dialog", { name: "New agent" });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("textbox", { name: "Name" }).first().inputValue(), "Launch Scout");
  await closeOverlays();
  await page.locator("[data-new-agent-screen]").waitFor({ state: "detached" });
});

await step("new-agent-created", async () => {
  await button("New or share").click();
  await button("New agent").click();
  await page.locator("[data-new-agent-screen]").waitFor();
  await page.getByRole("textbox", { name: "Name" }).fill("Launch Scout");
  await page.getByRole("radio", { name: "orange color" }).click();
  await page.getByRole("radio", { name: "Diamond shape" }).click();
  await button("Create agent").click();
  await page.getByRole("textbox", { name: "Message Launch Scout" }).waitFor({ timeout: 60_000 });
  const created = (await apiBots()).filter((bot) => bot.name === "Launch Scout").at(-1);
  assert.deepEqual([created?.color, created?.mascotBody], ["orange", "diamond"]);
});
await closeOverlays();

await step("new-menu", async () => {
  await button("New or share").click();
  await button("New group chat").waitFor();
});
await closeOverlays();

await step("group-chat", async () => {
  await button("New or share").click();
  await button("New group chat").click();
  await page.getByRole("textbox", { name: /Group chat name/ }).fill("Launch team");
  const boxes = page.getByRole("checkbox");
  await boxes.nth(0).click();
  await boxes.nth(1).click();
  await page.getByRole("button", { name: /^Create group chat/ }).click();
  await page.getByRole("textbox", { name: /^Message Launch team/ }).waitFor({ timeout: 60_000 });
});

await step("routines", async () => {
  await page.getByRole("tab", { name: "Routines" }).click();
  await page.getByRole("tab", { name: "Routines", selected: true }).waitFor();
});
await page.getByRole("tab", { name: "Agents" }).click();
await page.locator("[data-sidebar-bot-row]").first().click();
await composer.waitFor();

await step("agent-profile", async () => {
  await page.getByRole("button", { name: /^Open .*'s profile$/ }).first().click();
  await page.getByRole("button", { name: /^Close/ }).first().waitFor();
});
await closeOverlays();

/** A dedicated agent for avatar checks, opened by id so duplicate names and reload selection cannot mislead. */
let avatarAgent = null;
async function selectAvatarAgent() {
  if (!avatarAgent) {
    avatarAgent = (await fetch(`${info.apiUrl}/api/bots`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Avatar QA" }) }).then((r) => r.json())).bot.id;
  }
  const row = page.locator(`[data-sidebar-bot-row="${avatarAgent}"]`);
  await row.waitFor({ timeout: 30_000 });
  await row.click();
  await page.getByRole("textbox", { name: "Message Avatar QA" }).waitFor();
  return avatarAgent;
}

await step("avatar-upload-persists", async () => {
  const id = await selectAvatarAgent();
  await openLook();
  await page.locator('input[type="file"][accept*="image"]').first().setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: gradientPng() });
  await waitForBot(id, (bot) => Boolean(bot.avatarUrl) && bot.avatarCrop !== "mascot");
  await page.reload({ waitUntil: "domcontentloaded" });
  await composer.waitFor({ timeout: 120_000 });
  await page.locator(`[data-sidebar-bot-row="${id}"] img`).waitFor({ timeout: 30_000 });
  await page.waitForFunction((botId) => {
    const img = document.querySelector(`[data-sidebar-bot-row="${botId}"] img`);
    return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
  }, id, { timeout: 30_000 });
  const loaded = await page.locator(`[data-sidebar-bot-row="${id}"] img`).evaluate((img) => img.complete && img.naturalWidth > 0);
  assert.equal(loaded, true, "The uploaded avatar image loads after a reload.");
});

await step("avatar-mascot-persists", async () => {
  const id = await selectAvatarAgent();
  await openLook();
  await button("Reset mascot").click();
  await button("Use purple mascot color").click();
  await button("Use the Hexagon body").click();
  await button("Use proud expression").click();
  await waitForBot(id, (bot) => bot.color === "purple" && bot.mascotBody === "hexagon" && bot.mascotExpression === "proud" && (bot.avatarCrop ?? "mascot") === "mascot");
  await page.reload({ waitUntil: "domcontentloaded" });
  await composer.waitFor({ timeout: 120_000 });
  await page.locator(`[data-sidebar-bot-row="${id}"] [data-body="hexagon"] svg[data-state="proud"]`).waitFor({ timeout: 30_000 });
  await selectAvatarAgent();
  await openLook();
  assert.equal(await button("Use proud expression").getAttribute("aria-pressed"), "true");
  assert.equal(await button("Use purple mascot color").getAttribute("aria-pressed"), "true");
  assert.equal(await button("Use the Hexagon body").getAttribute("aria-pressed"), "true");
});
await closeOverlays();

await step("model-picker", async () => {
  await page.locator("[data-chathead-controls] button").filter({ hasText: /Claude|GPT|Gemini|Grok|model/i }).first().click();
  await page.getByText(/Quick|Balanced|Effort/).first().waitFor();
});
await closeOverlays();

await step("voice-call-screen", async () => {
  await page.getByRole("button", { name: /^Voice call with / }).first().click();
  const call = page.getByRole("dialog", { name: /^Voice call with / });
  await call.getByRole("combobox", { name: "Microphone", exact: true }).waitFor();
  await call.getByRole("combobox", { name: "Speaker", exact: true }).waitFor();
  await call.getByRole("list", { name: "Voice call readiness" }).waitFor();
  await call.getByRole("button", { name: "Test microphone and speaker", exact: true }).waitFor();
  await call.getByText("Other call modes: native realtime (OpenAI Live) and on-device speech", { exact: true }).click();
  assert.ok(await call.getByRole("button").count() >= 2);
});
await button("Close voice call").click();

await step("computer-panel", async () => {
  await button("Agent's computer").click();
  await page.getByRole("button", { name: "Browser" }).or(page.getByRole("tab", { name: "Browser" })).first().waitFor();
});
await closeOverlays();

for (const section of ["General", "Appearance", "AI", "Connectors", "Computers", "Account"]) {
  await step(`settings-${section.toLowerCase()}`, async () => {
    if (!(await page.getByRole("dialog").filter({ has: page.locator("[data-settings-search]") }).isVisible().catch(() => false))) {
      await button("You").click();
      await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    }
    const entry = page.locator(`nav [data-settings-page], nav [data-settings-section]`).filter({ hasText: new RegExp(`^${section}$`) }).first();
    if (await entry.count() === 0) {
      if (section === "Account" || advanced) throw new Skip(`${section} is not offered on this ${surface} host`);
      throw new Error(`${section} is missing from Settings on this ${surface} host`);
    }
    await entry.click();
    await page.locator("[data-settings-block], [data-setting-row], [data-setting-card]").first().waitFor();
  });
}
await closeOverlays();

await step("command-palette", async () => {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByRole("dialog").first().waitFor();
});
await closeOverlays();

await step("account-menu", async () => {
  await button("You").click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).waitFor();
});
await closeOverlays();

const failed = results.filter((r) => !r.ok);
const report = {
  ok: failed.length === 0 && errors.length === 0,
  stage,
  surface,
  viewport: { width, height },
  sourceCommit: info.sourceCommit,
  steps: results,
  rendererErrors: errors,
  realProviderVerified: false,
  coreIntegrated: info.coreIntegrated === true,
};
writeFileSync(join(out, `${surface}-ui-tour.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, passed: results.length - failed.length, failed: failed.map((f) => f.name), rendererErrors: errors.length }, null, 2));
await browser.close();
process.exitCode = report.ok ? 0 : 1;
