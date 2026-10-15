// Copyright (c) 2026 AIKING.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { foundationRoot, runtimeRoot } from "./setup.mjs";

const info = JSON.parse(readFileSync(join(runtimeRoot, "offline-runtime.json"), "utf8"));
assert.equal(info.mode, "offline-verification"); assert.equal(info.coreVerification, true);
const out = join(runtimeRoot, "evidence/shipping"); mkdirSync(out, { recursive: true });
const mcpName = "verify-" + Date.now().toString(36);
const note = join(info.dataDir, `${mcpName}-note.txt`);
async function api(path, body, method = body ? "POST" : "GET") {
  const response = await fetch(info.apiUrl + path, { method, headers: { "content-type": "application/json" }, ...(body && method !== "GET" ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const result = await response.json(); assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(result)}`); return result;
}
await api("/api/mcp/servers", { name: mcpName, command: process.execPath, args: [join(foundationRoot, "fixtures/core-tools.mjs"), note] });
await api(`/api/mcp/servers/${mcpName}`, { enabled: true }, "PATCH");
const bot = (await api("/api/bots", { name: "Core Shipping QA", mcpServers: [mcpName], modelSelection: { instanceId: "aiking-core-test", model: "aiking-offline" } })).bot;
await api(`/api/bots/${bot.id}/tasks/${bot.threadId}`, { approvalMode: "ask" }, "PATCH");
await api(`/api/bots/${bot.id}`, { mcpServers: [mcpName] }, "PATCH");
await api("/api/aiking/marketplace/records", { action: "remove", listingId: "media-producer" });
const browser = await chromium.launch({ executablePath: process.env.AIKING_CHROME || "/usr/bin/chromium", headless: true, args: ["--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${join(foundationRoot, "fixtures/voice/jfk-16k.wav")}`] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
await context.addInitScript(() => { localStorage.setItem("omb-advanced-mode", "0"); localStorage.setItem("omb-email-gate", "skipped"); });
const page = await context.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.message));
const results = []; let ok = false; let failure; let installedAgent;
async function step(name, operation) { await operation(); await page.screenshot({ path: join(out, `${name}.png`) }); results.push({ name, ok: true }); console.log(`ok ${name}`); }
const composer = () => page.getByRole("textbox", { name: /^Message Core Shipping QA/ });
try {
  await page.goto(info.uiUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  const skip = page.getByRole("button", { name: "Skip tour", exact: true }); if (await skip.isVisible()) await skip.click();
  await page.locator(`[data-sidebar-bot-row="${bot.id}"]`).click(); await composer().waitFor({ timeout: 120000 });
  await step("core-stream-approval", async () => {
    await composer().fill("Save a verification note with the remember tool."); await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "Allow once", exact: true }).waitFor({ timeout: 45000 });
    assert.equal(existsSync(note), false, "Tool has not run before human approval.");
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    await page.getByRole("log", { name: /^Conversation with Core Shipping QA/ }).getByText(/AIKING Core completed/).first().waitFor({ timeout: 45000 });
    assert.match(readFileSync(note, "utf8"), /Core approved/);
  });
  await step("core-denial", async () => {
    const modification = statSync(note).mtimeMs;
    await composer().fill("Save a second verification note."); await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "Deny", exact: true }).waitFor({ timeout: 45000 });
    await page.getByRole("button", { name: "Deny", exact: true }).click();
    await page.getByRole("log", { name: /^Conversation with Core Shipping QA/ }).getByText(/AIKING Core completed/).nth(1).waitFor({ timeout: 45000 });
    assert.equal(statSync(note).mtimeMs, modification, "Denied tool does not modify its target.");
  });
  await step("core-reload-persistence", async () => {
    await page.reload({ waitUntil: "domcontentloaded" }); await composer().waitFor({ timeout: 120000 });
    await page.getByRole("log", { name: /^Conversation with Core Shipping QA/ }).getByText(/AIKING Core completed/).first().waitFor();
    const stored = await api("/api/bots"); assert.equal(stored.bots.find(candidate => candidate.id === bot.id).modelSelection.instanceId, "aiking-core-test");
  });
  await step("marketplace-backend-install", async () => {
    await page.getByRole("button", { name: "Marketplace", exact: true }).click();
    const market = page.getByRole("dialog", { name: "Marketplace" });
    await market.getByRole("button", { name: "Media Producer, Details", exact: true }).click();
    await page.getByRole("button", { name: "Add agent", exact: true }).click(); await page.getByRole("button", { name: "Open agent", exact: true }).waitFor({ timeout: 45000 });
    const records = await api("/api/aiking/marketplace/records"); assert.ok(records.records.some(record => record.listingId === "media-producer" && record.targets.length));
    installedAgent = records.records.find(record => record.listingId === "media-producer").targets[0];
  });
  await step("marketplace-template-update", async () => {
    const catalog = await api("/api/aiking/v1/catalog"); const listing = catalog.listings.find(listing => listing.id === "media-producer");
    const skill = catalog.listings.find(skill => skill.id === listing.skills[0].id);
    const before = (await api("/api/bots")).bots.find(bot => bot.id === installedAgent);
    await api(`/api/bots/${installedAgent}/skills/${skill.skillName}`, undefined, "DELETE");
    await api(`/api/bots/${installedAgent}/skill-template`, { name: skill.skillName, description: skill.summary, source: `aiking-marketplace:${skill.id}@0.0.1`, text: skill.text + "\nOld catalog revision fixture.\n", enabled: false, warnings: [] });
    await api(`/api/bots/${installedAgent}/profile`, { name: "Producer kept name" }, "PATCH");
    await api(`/api/bots/${installedAgent}/memory/file`, { path: "memory/marketplace-keep.md", text: "Keep this user note." }, "PUT");
    await api("/api/aiking/marketplace/records", { action: "add", record: { listingId: listing.id, kind: "agent", version: "0.0.1", targets: [installedAgent], installedAt: new Date().toISOString() } });
    await page.getByRole("button", { name: "Close marketplace", exact: true }).click(); await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Marketplace", exact: true }).click();
    await page.getByRole("button", { name: "Media Producer, Details", exact: true }).click();
    await page.getByRole("button", { name: "Update template", exact: true }).click();
    await page.getByRole("button", { name: "Apply template update", exact: true }).click();
    await page.getByRole("button", { name: "Apply template update", exact: true }).waitFor({ state: "hidden", timeout: 45000 });
    const after = (await api("/api/bots")).bots.find(bot => bot.id === installedAgent); assert.equal(after.name, "Producer kept name"); assert.deepEqual(after.modelSelection, before.modelSelection);
    assert.equal((await api(`/api/bots/${installedAgent}/memory/file?path=memory/marketplace-keep.md`)).text, "Keep this user note.");
    assert.equal((await api(`/api/bots/${installedAgent}/skills/${skill.skillName}`)).text, skill.text);
    assert.equal((await api(`/api/bots/${installedAgent}/skills`)).skills.find(held => held.name === skill.skillName).enabled, false);
    assert.equal((await api("/api/aiking/marketplace/records")).records.find(record => record.listingId === listing.id).targetVersions[installedAgent], listing.version);
  });
  await page.getByRole("button", { name: "Close marketplace", exact: true }).click();
  await step("marketplace-legacy-migration", async () => {
    const record = (await api("/api/aiking/marketplace/records")).records.find(record => record.listingId === "media-producer");
    await api("/api/aiking/marketplace/records", { action: "remove", listingId: "media-producer" });
    await page.evaluate(record => localStorage.setItem("aiking-marketplace-installs", JSON.stringify([{ ...record, targets: [...record.targets, "foreign-workspace-fixture"] }])), record);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.getByRole("button", { name: "Marketplace", exact: true }).waitFor();
    const migrated = (await api("/api/aiking/marketplace/records")).records.find(record => record.listingId === "media-producer"); assert.deepEqual(migrated.targets, [installedAgent]);
    await page.evaluate(record => localStorage.setItem("aiking-marketplace-installs", JSON.stringify([{ ...record, version: "0.0.1" }])), record);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.getByRole("button", { name: "Marketplace", exact: true }).waitFor();
    assert.equal((await api("/api/aiking/marketplace/records")).records.find(record => record.listingId === "media-producer").targetVersions[installedAgent], record.version);
  });
  await page.locator(`[data-sidebar-bot-row="${bot.id}"]`).click();
  await step("voice-local-backend", async () => {
    // Remove the write fixture from this voice agent; voice must never silently approve a side effect.
    await api(`/api/mcp/servers/${mcpName}`, { enabled: false }, "PATCH");
    await page.getByRole("button", { name: /^Voice call with Core Shipping QA/ }).click();
    // The workspace's own voice service is the default; the call starts once the readiness checks pass.
    await page.locator('[data-voice-check="speech"][data-voice-check-ok="true"]').waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Start voice call", exact: true }).click();
    await page.getByRole("log", { name: "Voice transcript" }).getByText(/AIKING Core completed/).waitFor({ timeout: 60000 });
    assert.ok(Number(await page.locator("[data-voice-frames]").getAttribute("data-voice-frames")) > 10);
    await page.getByRole("button", { name: "Hang up voice call", exact: true }).click();
  });
  await step("local-api-security", async () => {
    const wrong = await fetch(info.apiUrl + "/api/aiking/voice/ticket", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ botId: bot.id, threadId: "wrong-thread" }) }); assert.equal(wrong.status, 403);
    const cross = await fetch(info.apiUrl + "/api/aiking/marketplace/records", { headers: { origin: "https://untrusted.example" } }); assert.equal(cross.status, 403);
  });
  await page.getByRole("button", { name: "Close voice call", exact: true }).click();
  await step("marketplace-backend-uninstall", async () => {
    await page.getByRole("button", { name: "Marketplace", exact: true }).click(); await page.getByRole("button", { name: "Media Producer, Details", exact: true }).click();
    await page.getByRole("button", { name: "Remove agent", exact: true }).click(); await page.getByRole("button", { name: "Confirm remove", exact: true }).click();
    await page.getByRole("button", { name: "Add agent", exact: true }).waitFor({ timeout: 45000 });
    assert.ok(!(await api("/api/bots")).bots.some(bot => bot.id === installedAgent));
    // The card switches to "Add agent" as soon as the agent is deleted; the queued record write lands right after.
    const recorded = async () => (await api("/api/aiking/marketplace/records")).records.some(record => record.listingId === "media-producer");
    for (const deadline = Date.now() + 15000; await recorded() && Date.now() < deadline;) await new Promise(resolve => setTimeout(resolve, 250));
    assert.ok(!(await recorded()), "Marketplace install record is removed after uninstall.");
  });
  await page.getByRole("button", { name: "Close marketplace", exact: true }).click();
  await step("core-group-multi-agent", async () => {
    const peer = (await api("/api/bots", { name: "Core Group Peer", modelSelection: { instanceId: "aiking-core-test", model: "aiking-offline" } })).bot;
    const group = (await api("/api/groups", { name: "Core shipping team", memberIds: [bot.id, peer.id], setup: { bulletin: "Offline Core group verification", defaultResponder: { kind: "everyone" } } })).group;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(`[data-sidebar-group-row="${group.id}"]`).click();
    const input = page.getByRole("textbox", { name: /^Message Core shipping team/ });
    await input.fill("Each agent: report your capabilities for this group.");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText(/AIKING Core completed/).nth(1).waitFor({ timeout: 60000 });
    const deadline = Date.now() + 60000; let speakers = [];
    do {
      const stored = await api(`/api/threads/${group.threadId}/messages`);
      const replies = stored.messages.filter(message => message.role === "bot" && /AIKING Core completed.*live AI provider\./s.test(message.text));
      speakers = [...new Set(replies.map(message => message.from?.botId))].sort();
      if (speakers.length < 2) await page.waitForTimeout(250);
    } while (speakers.length < 2 && Date.now() < deadline);
    assert.deepEqual(speakers, [bot.id, peer.id].sort());
  });
  await step("core-scheduled-run", async () => {
    const routine = (await api("/api/routines", { name: "Core shipping once", botId: bot.id, prompt: "Report capabilities from the scheduler.", enabled: true, schedule: { type: "once", at: Date.now() + 2500 } })).routine;
    const deadline = Date.now() + 60000; let run;
    do {
      run = (await api("/api/routines")).runs.find(run => run.routineId === routine.id && run.status === "completed");
      if (!run) await page.waitForTimeout(500);
    } while (!run && Date.now() < deadline);
    assert.ok(run, "The actual scheduler completed a Core run.");
    assert.equal(run.manual, false);
    await page.getByRole("tab", { name: "Routines", exact: true }).click();
    await page.getByText("Core shipping once", { exact: true }).first().waitFor();
  });
  assert.deepEqual(errors, []); ok = true;
} catch (error) { failure = String(error); await page.screenshot({ path: join(out, "shipping-failed.png") }).catch(() => {}); throw error; }
finally {
  writeFileSync(join(out, "shipping-e2e.json"), JSON.stringify({ ok, failure, verifiedAt: new Date().toISOString(), results, rendererErrors: errors, coreRuntimeVerified: true, realProviderVerified: false, speechProvider: "offline-scripted", botId: bot.id }, null, 2));
  await browser.close();
}
