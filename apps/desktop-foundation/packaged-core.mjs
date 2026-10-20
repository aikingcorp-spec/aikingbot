// Copyright (c) 2026 AIKING.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foundationRoot, runtimeRoot, sourceRoot } from "./setup.mjs";

const scratch = mkdtempSync(join(tmpdir(), "aiking-packaged-core-"));
const profile = join(scratch, "profile"); mkdirSync(profile, { mode: 0o700 });
const out = join(runtimeRoot, "evidence/shipping"); mkdirSync(out, { recursive: true });
let child; let output = ""; let ok = false; let failure;
const freePort = async () => { const server = createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; };
try {
  cpSync(process.env.AIKING_PACKAGED_SERVER || join(sourceRoot, "dist-server"), join(scratch, "server"), { recursive: true });
  cpSync(join(foundationRoot, "fixtures/core-tools.mjs"), join(scratch, "tools.mjs"));
  writeFileSync(join(scratch, "package.json"), '{"type":"commonjs"}');
  writeFileSync(join(profile, "config.json"), JSON.stringify({ instances: { "core-fixture": { driver: "aiking-core", displayName: "Packaged Core · Offline test", config: { mode: "offline" } } } }), { mode: 0o600 });
  const port = await freePort(); const webhookPort = await freePort(); const url = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(scratch, "server/index.js")], { cwd: scratch, env: {
    PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: scratch, USERPROFILE: scratch, APPDATA: join(scratch, "AppData/Roaming"), LOCALAPPDATA: join(scratch, "AppData/Local"),
    AIKING_DATA_DIR: profile, AIKING_PORT: String(port), AIKING_WEBHOOK_PORT: String(webhookPort),
  }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
  async function api(path, body, method = body ? "POST" : "GET") {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    const value = await response.json(); assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(value)}`); return value;
  }
  async function until(operation) {
    const deadline = Date.now() + 60000; let last;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, output);
      try { const result = await operation(); if (result) return result; } catch (error) { last = error; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw last || new Error("Packaged Core operation timed out");
  }
  await until(() => api("/api/health"));
  const note = join(scratch, "approved-note.txt");
  await api("/api/mcp/servers", { name: "packaged-tools", command: process.execPath, args: [join(scratch, "tools.mjs"), note] });
  await api("/api/mcp/servers/packaged-tools", { enabled: true }, "PATCH");
  const bot = (await api("/api/bots", { name: "Packaged Core QA", mcpServers: ["packaged-tools"], modelSelection: { instanceId: "core-fixture", model: "aiking-offline" } })).bot;
  await api(`/api/bots/${bot.id}/tasks/${bot.threadId}`, { approvalMode: "ask" }, "PATCH");
  await api(`/api/bots/${bot.id}/messages`, { text: "Save a verification note using the packaged MCP runtime." });
  const messages = () => api(`/api/threads/${bot.threadId}/messages`);
  const card = await until(async () => (await messages()).messages.find(message => message.card?.requestId)?.card);
  assert.equal(existsSync(note), false);
  await api(`/api/bots/${bot.id}/respond`, { threadId: bot.threadId, requestId: card.requestId, behavior: "allow" });
  await until(async () => (await messages()).messages.some(message => message.role === "bot" && /AIKING Core completed/.test(message.text)));
  assert.match(readFileSync(note, "utf8"), /Core approved/); ok = true;
  console.log("Packaged Core → MCP → approval → persisted reply passed outside the checkout.");
} catch (error) { failure = String(error); throw error; }
finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once("exit", resolve)); const timer = setTimeout(() => child.kill("SIGKILL"), 10000); child.kill("SIGTERM"); await exited; clearTimeout(timer);
  }
  writeFileSync(join(out, "packaged-core.json"), JSON.stringify({ ok, failure, at: new Date().toISOString(), outsideCheckout: true, realProviderVerified: false }, null, 2));
  writeFileSync(join(out, "packaged-core.log"), output);
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
