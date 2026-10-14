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
import { join } from "node:path";
import { chromium } from "playwright-core";
import { runtimeRoot } from "./setup.mjs";

const info = JSON.parse(readFileSync(join(runtimeRoot, "offline-runtime.json"), "utf8"));
assert.equal(info.mode, "offline-verification", "The tour requires an explicitly launched offline fixture.");
assert.equal(new URL(info.uiUrl).hostname, "127.0.0.1");
const out = join(runtimeRoot, "evidence", "stage2");
mkdirSync(out, { recursive: true });

const width = Number(process.env.AIKING_TOUR_WIDTH || 1440);
const height = Number(process.env.AIKING_TOUR_HEIGHT || 900);
const cdp = process.env.AIKING_VERIFY_CDP;
const browser = cdp
  ? await chromium.connectOverCDP(cdp)
  : await chromium.launch({ executablePath: process.env.AIKING_CHROME || "/usr/bin/chromium", headless: true });
const context = cdp ? browser.contexts()[0] : await browser.newContext({ viewport: { width, height }, colorScheme: "dark" });
const page = cdp
  ? context.pages().find((p) => new URL(p.url()).origin === new URL(info.uiUrl).origin)
  : await context.newPage();
assert.ok(page, "The owned desktop must show the fixture URL.");
const surface = cdp ? "electron" : "browser";
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
if (!cdp) await page.goto(info.uiUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });

const results = [];
const settle = () => page.waitForTimeout(450);
async function step(name, run) {
  const started = Date.now();
  try {
    await run();
    await settle();
    await page.screenshot({ path: join(out, `${surface}-${name}.png`) });
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.message ?? error).split("\n")[0] });
    console.log(`FAIL ${name}: ${String(error?.message ?? error).split("\n")[0]}`);
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

const composer = page.getByRole("textbox", { name: /^Message / }).first();
await composer.waitFor({ timeout: 120_000 });
const skip = button("Skip tour");
if (await skip.isVisible().catch(() => false)) await skip.click();
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

await step("marketplace-agents", async () => {
  await button("Marketplace").click();
  const dialog = page.getByRole("dialog", { name: "Marketplace" });
  await dialog.waitFor();
  await dialog.getByRole("tab", { name: "Agents", selected: true }).waitFor();
  assert.ok(await dialog.locator("[data-market-card]").count() >= 3);
});

await step("marketplace-search", async () => {
  await page.getByRole("dialog", { name: "Marketplace" }).getByRole("textbox", { name: "Search" }).fill("research");
  await page.getByRole("button", { name: /^Researcher, Details$/ }).waitFor();
});

await step("marketplace-agent-detail", async () => {
  await page.getByRole("button", { name: /^Researcher, Details$/ }).click();
  await page.getByRole("button", { name: "Add agent" }).waitFor();
  await page.getByRole("navigation", { name: "Breadcrumb" }).waitFor();
});

await step("marketplace-apps", async () => {
  await page.keyboard.press("Escape");
  const dialog = page.getByRole("dialog", { name: "Marketplace" });
  await dialog.getByRole("tab", { name: "Apps" }).click();
  await dialog.locator("[data-apps-embedded]").waitFor();
});

await step("marketplace-mcp", async () => {
  const dialog = page.getByRole("dialog", { name: "Marketplace" });
  await dialog.locator('[data-apps-filter="mcp"]').click();
  await dialog.locator('[data-apps-filter="mcp"][aria-pressed="true"]').waitFor();
});

await step("marketplace-skills", async () => {
  const dialog = page.getByRole("dialog", { name: "Marketplace" });
  await dialog.getByRole("tab", { name: "Skills" }).click();
  await dialog.getByRole("heading", { name: /^(Agent skills|Skills library)$/ }).waitFor();
});

await step("agent-from-template", async () => {
  const dialog = page.getByRole("dialog", { name: "Marketplace" });
  await dialog.getByRole("tab", { name: "Agents" }).click();
  await dialog.getByRole("button", { name: "Add Researcher" }).click();
  await page.getByRole("dialog", { name: "Marketplace" }).waitFor({ state: "detached" });
  await page.getByRole("textbox", { name: "Name" }).first().waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Name" }).first().inputValue(), "Scout");
});
await closeOverlays();

await step("new-agent", async () => {
  await button("New or share").click();
  await button("New agent").click();
  await page.getByRole("textbox", { name: "Name" }).first().waitFor();
});
await closeOverlays();

await step("new-menu", async () => {
  await button("New or share").click();
  await button("New group chat").waitFor();
});
await closeOverlays();

await step("routines", async () => {
  await page.getByRole("tab", { name: "Routines" }).click();
  await page.getByRole("tab", { name: "Routines", selected: true }).waitFor();
});
await page.getByRole("tab", { name: "Agents" }).click();
await composer.waitFor();

await step("agent-profile", async () => {
  await page.getByRole("button", { name: /^Open .*'s profile$/ }).first().click();
  await page.getByRole("button", { name: /^Close/ }).first().waitFor();
});
await closeOverlays();

await step("model-picker", async () => {
  await page.locator("[data-chathead-controls] button").first().click();
  await page.getByText(/Quick|Balanced/).first().waitFor();
});
await closeOverlays();

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
    await page.locator(`nav [data-settings-page], nav [data-settings-section]`).filter({ hasText: section }).first().click();
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
  stage: 2,
  surface,
  viewport: { width, height },
  sourceCommit: info.sourceCommit,
  steps: results,
  rendererErrors: errors,
  realProviderVerified: false,
  coreIntegrated: false,
};
writeFileSync(join(out, `${surface}-ui-tour.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, passed: results.length - failed.length, failed: failed.map((f) => f.name), rendererErrors: errors.length }, null, 2));
await browser.close();
process.exitCode = report.ok ? 0 : 1;
