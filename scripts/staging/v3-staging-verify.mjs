// Copyright (c) 2026 AIKING.
// Explicit staging URL and an existing browser storage-state file are required for live provider checks.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright-core";

const [url, stateFile, output, engine] = process.argv.slice(2);
assert.ok(url && output, "Usage: node v3-staging-verify.mjs URL STORAGE_STATE OUTPUT [codex|claude]");
const base = new URL(url);
assert.ok(base.protocol === "https:" || base.hostname === "127.0.0.1", "Use HTTPS or loopback");
assert.ok(!engine || ["codex", "claude"].includes(engine));
const out = resolve(output);
mkdirSync(out, { recursive: true, mode: 0o700 });
const report = { startedAt: new Date().toISOString(), origin: base.origin, engine: engine ?? null, checks: [] };
const browser = await chromium.launch({ executablePath: process.env.AIKING_CHROME ?? "/opt/google/chrome/chrome", headless: true });
const check = async (name, fn) => {
  try { const detail = await fn(); report.checks.push({ name, ok: true, detail }); console.log("PASS", name); }
  catch (e) { report.checks.push({ name, ok: false, error: e.message }); console.log("FAIL", name, e.message); }
};
try {
  for (const [language, expected] of [["vi-VN", "Gửi mã"], ["en", "Send code"]]) {
    await check("saved language on sign-in: " + language, async () => {
      const ctx = await browser.newContext({ locale: "en-US" });
      try {
        await ctx.addInitScript(value => localStorage.setItem("aiking-language", value), language);
        const page = await ctx.newPage();
        await page.goto(base.origin + "/pair");
        await page.locator("#signin-email").waitFor();
        await page.waitForFunction(text => document.querySelector("button[type=submit]")?.textContent?.trim() === text, expected, { timeout: 10000 });
        await page.reload();
        await page.waitForFunction(text => document.querySelector("button[type=submit]")?.textContent?.trim() === text, expected, { timeout: 10000 });
        assert.equal((await page.locator("button[type=submit]").innerText()).trim(), expected);
        await page.screenshot({ path: join(out, "signin-" + language + ".png") });
        return { language: await page.locator("html").getAttribute("lang"), reload: true };
      } finally { await ctx.close(); }
    });
  }
  await check("anonymous workspace APIs require a session", async () => {
    const anonymous = await browser.newContext();
    try {
      const checks = [];
      for (const path of ["/api/bots", "/api/config", "/api/instances", "/api/mcp/servers", "/api/auth/sessions", "/api/internal/agents"]) {
        const response = await anonymous.request.get(base.origin + path);
        checks.push({ path, status: response.status() });
      }
      assert.ok(checks.every(item => [401, 403].includes(item.status)), JSON.stringify(checks));
      return checks;
    } finally { await anonymous.close(); }
  });
  if (stateFile !== "-") {
    const ctx = await browser.newContext({ storageState: stateFile, viewport: { width: 1280, height: 860 } });
    const req = (path, method = "GET", data) => ctx.request.fetch(base.origin + path, { method, data, headers: { "content-type": "application/json", origin: base.origin }, timeout: 30000 });
    try {
      await check("authenticated staging feature endpoints", async () => {
        const routes = ["/api/auth/session", "/api/account/session", "/api/bots", "/api/instances", "/api/config", "/api/mcp/servers", "/api/connectors", "/api/aiking/v1/catalog", "/api/aiking/realtime/status", "/api/aiking/status", "/api/computers/vps"];
        const statuses = [];
        for (const path of routes) { const response = await req(path); statuses.push({ path, status: response.status() }); }
        assert.ok(statuses.every(item => item.status === 200), JSON.stringify(statuses));
        return statuses;
      });
      await check("paired workspace GET rejects a foreign Origin", async () => {
        const response = await ctx.request.get(base.origin + "/api/bots", { headers: { origin: "https://untrusted.invalid" } });
        assert.equal(response.status(), 403);
        return { status: response.status() };
      });
      await check("staging renderer and Vietnamese persistence", async () => {
        await ctx.addInitScript(() => localStorage.setItem("aiking-language", "vi"));
        const page = await ctx.newPage(); const errors = [];
        page.on("pageerror", e => errors.push(e.message));
        await page.goto(base.origin);
        await page.locator("[data-workspace-rail]").waitFor({ timeout: 60000 });
        await page.waitForFunction(() => document.documentElement.lang === "vi");
        await page.reload();
        await page.locator("[data-workspace-rail]").waitFor({ timeout: 60000 });
        await page.waitForFunction(() => document.documentElement.lang === "vi");
        assert.deepEqual(errors, []);
        await page.screenshot({ path: join(out, "workspace-vi.png") });
        await page.close();
        return { language: "vi", reload: true, rendererErrors: errors };
      });
      if (engine) await check("native " + engine + " Tasks events, final checklist and reload", async () => {
        const name = "V3 verification " + engine + " " + Date.now();
        const selection = engine === "claude" ? { instanceId: "claude", model: "claude-sonnet-5" } : { instanceId: "codex", model: "gpt-6.1-sol" };
        const created = await req("/api/bots", "POST", { name, title: "temporary verification", modelSelection: selection });
        assert.ok(created.ok(), "temporary bot creation: " + created.status());
        const bot = await created.json(); const id = bot.bot?.id ?? bot.id; const threadId = bot.bot?.threadId ?? bot.threadId;
        assert.ok(id);
        let page;
        const transitions = [];
        try {
          const tool = engine === "claude" ? "TodoWrite" : "update_plan";
          const text = engine === "claude"
            ? "Use TodoWrite first to create exactly three todos: Gather the facts, Draft the answer, Report to the user. Include activeForm and status for each todo. Update TodoWrite after each step. Mark all three completed before your short final reply. Use no other tool."
            : "Use update_plan first to create exactly three steps: Gather the facts, Draft the answer, Report to the user. Update the plan after each step. Mark all three completed before your short final reply. Use no other tool.";
          const sent = await req("/api/bots/" + id + "/messages", "POST", { text, threadId });
          assert.ok(sent.ok(), "send: " + sent.status());
          page = await ctx.newPage();
          await page.goto(base.origin);
          await page.locator("[data-workspace-rail]").waitFor({ timeout: 60000 });
          await page.getByText(name, { exact: false }).first().click();
          const deadline = Date.now() + 150000;
          let last;
          while (Date.now() < deadline) {
            const cards = await page.locator("[data-task-checklist]").evaluateAll(elements => elements.map(el => ({
              count: el.querySelector("[data-task-count]")?.textContent,
              states: [...el.querySelectorAll("[data-task-state]")].map(row => row.getAttribute("data-task-state")),
              complete: el.hasAttribute("data-complete")
            })));
            const signature = JSON.stringify(cards);
            if (signature !== last) { last = signature; transitions.push({ at: Date.now(), cards }); console.log(engine, signature); }
            if (cards.some(card => card.count === "3/3" && card.complete)) break;
            await page.waitForTimeout(1000);
          }
          if (transitions.at(-1)?.cards.some(card => card.count === "3/3" && card.complete)) {
            const finish = Date.now() + 60000;
            let busy = true;
            while (Date.now() < finish && busy) {
              const bots = await (await req("/api/bots")).json();
              busy = Boolean(bots.bots?.find(candidate => candidate.id === id)?.busy);
              if (busy) await page.waitForTimeout(500);
            }
            assert.equal(busy, false, "the provider turn must finish before cleanup");
          }
          await page.screenshot({ path: join(out, engine + "-tasks.png") });
          const final = transitions.at(-1)?.cards ?? [];
          assert.ok(final.some(card => card.count === "3/3" && card.complete), tool + " did not yield a completed 3/3 checklist");
          await page.reload();
          await page.locator("[data-workspace-rail]").waitFor({ timeout: 60000 });
          await page.getByText(name, { exact: false }).first().click();
          await page.locator('[data-task-checklist][data-complete] [data-task-count]').filter({ hasText: "3/3" }).waitFor({ timeout: 15000 });
          assert.equal(await page.locator("[data-task-checklist]").count(), 1, "one card per turn");
          return { transitions, persistedAfterReload: true, tool };
        } finally {
          if (page) await page.close();
          const deleted = await req("/api/bots/" + id, "DELETE");
          assert.ok(deleted.ok(), "temporary agent cleanup failed: " + deleted.status());
        }
      });
    } finally { await ctx.close(); }
  }
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(out, (engine ?? "read-only") + "-verification.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
}
process.exitCode = report.checks.every(check => check.ok) ? 0 : 1;
