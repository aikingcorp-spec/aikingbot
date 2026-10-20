// Copyright (c) 2026 AIKING.
// Runs the built server bundle exactly as deploy/aikingbot-server starts it
// (container-start.sh → `serve`, service loopback trust) from a fresh temp
// directory, outside the checkout, and checks the deployment contract:
// health, static UI, remote/local refusal without a session, pairing through a
// proxy, owner routes (AIKING status, Marketplace catalog/records), Voice
// upgrade refusal, clean stop, restart persistence and backup/restore scripts.
//   node apps/desktop-foundation/server-smoke.mjs [bundle.tar.gz]
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, connect } from "node:net";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeRoot } from "./paths.mjs";

const bundleDir = join(runtimeRoot, "server-bundle");
const archive = process.argv[2] ?? join(bundleDir, readdirSync(bundleDir).find(name => name.endsWith("-linux-x64.tar.gz")) ?? "missing.tar.gz");
assert.ok(existsSync(archive), `No server bundle at ${archive}; run server-bundle.mjs first.`);
const root = mkdtempSync(join(tmpdir(), "aikingbot-server-smoke-"));
const out = join(runtimeRoot, "evidence/shipping"); mkdirSync(out, { recursive: true });
const checks = [];
const check = async (name, operation) => { const started = Date.now(); await operation(); checks.push({ name, ms: Date.now() - started }); console.log(`ok   ${name}`); };
const freePort = async () => { const s = createServer(); await new Promise(r => s.listen(0, "127.0.0.1", r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; };

execFileSync("tar", ["-xzf", archive, "-C", root]);
const app = join(root, readdirSync(root).find(name => name.startsWith("aikingbot-server-")));
const manifest = JSON.parse(readFileSync(join(app, "bundle-manifest.json"), "utf8"));
const outside = join(root, "fixture-private.txt");
const privateMarker = "AIKINGBOT_FIXTURE_PRIVATE_OUTSIDE_STATIC";
writeFileSync(outside, privateMarker);
symlinkSync(outside, join(app, "dist", "fixture-link.txt"));
mkdirSync(join(root,"private-dir"));
writeFileSync(join(root,"private-dir","secret.txt"),privateMarker);
symlinkSync(join(root,"private-dir"),join(app,"dist","fixture-directory"),"dir");

const data = join(root, "data/.aikingbot");
const [port, hooks] = [await freePort(), await freePort()];
const base = `http://127.0.0.1:${port}`;
const env = { PATH: process.env.PATH, HOME: join(root, "home"), NODE_ENV: "production", AIKING_APP_DIR: app, AIKING_DATA_DIR: data,
  AIKING_STATIC_DIR: join(app, "dist"), AIKING_DUCKDB_DIR: join(app, "duckdb"), AIKING_PORT: String(port), AIKING_WEBHOOK_PORT: String(hooks),
  AIKING_LOOPBACK_TRUST: "service", AIKING_PUBLIC_URL: "https://bot-staging.example.com", AIKING_SERVER_LABEL: "AIKINGBOT smoke" };
mkdirSync(env.HOME, { recursive: true });
// What the host proxy adds: the server must treat these requests as remote.
const proxied = { "x-forwarded-for": "203.0.113.7", "x-forwarded-proto": "https", "x-forwarded-host": "bot-staging.example.com", host: "bot-staging.example.com", origin: "https://bot-staging.example.com" };

let server; let log = "";
async function start() {
  log = "";
  server = spawn("sh", [join(app, "deploy/scripts/container-start.sh")], { cwd: app, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", chunk => { log += chunk; }); server.stderr.on("data", chunk => { log += chunk; });
  const deadline = Date.now() + 60000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`server exited ${server.exitCode}\n${log}`);
    try { const response = await fetch(`${base}/api/health`); if (response.ok) return; } catch {}
    if (Date.now() > deadline) throw new Error(`server did not start\n${log}`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}
async function stop() {
  const exited = new Promise(resolve => server.once("exit", (code, signal) => resolve({ code, signal })));
  server.kill("SIGTERM");
  const timer = setTimeout(() => server.kill("SIGKILL"), 20000);
  const result = await exited; clearTimeout(timer); return result;
}
// Node 24 fetch ignores a custom Host. Use HTTP directly so this fixture models
// the TLS proxy preserving the public Host rather than inventing a host mismatch.
const request = (path, { headers = {}, ...init } = {}) => new Promise((resolve, reject) => {
  const request = httpRequest(`${base}${path}`, { method: init.method ?? "GET", headers }, response => {
    const chunks = [];
    response.on("data", chunk => chunks.push(chunk));
    response.on("error", reject);
    response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode })));
  });
  request.on("error", reject);
  request.end(init.body);
});

let token;
try {
  await start();
  await check("health without session", async () => { const body = await (await request("/api/health")).json(); assert.equal(body.app, "aikingbot"); assert.equal(body.static, true); });
  await check("static UI served through the proxy", async () => { const response = await request("/", { headers: proxied }); assert.equal(response.status, 200); assert.match(await response.text(), /<html/i); });
  await check("public assets cannot follow file or directory links outside the static root", async () => {
    for (const path of ["/fixture-link.txt","/fixture-directory/secret.txt"]){
      const response=await request(path,{headers:proxied});
      assert.equal((await response.text()).includes(privateMarker),false,path);
    }
    const page=await request("/pair",{headers:proxied});
    assert.equal(page.status,200);assert.match(await page.text(),/<html/i);
  });
  await check("remote API refused without a session", async () => { const response = await request("/api/aiking/status", { headers: proxied }); assert.ok([401, 403].includes(response.status), `status ${response.status}`); });
  await check("local command is not the owner (service trust)", async () => { const response = await request("/api/aiking/status"); assert.ok([401, 403].includes(response.status), `status ${response.status}`); });
  await check("unpaired agent shells cannot read or control other conversations", async () => {
    for (const [method, path] of [["GET", "/api/bots"], ["GET", "/api/threads/fixture/messages"], ["POST", "/api/bots/fixture/tasks"], ["POST", "/api/bots/fixture/messages/guarded"]]) {
      const response = await request(path, { method, ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}) });
      assert.equal(response.status, 403, method + " " + path);
    }
  });
  for (const deadline = Date.now() + 20000; !/pairing code:\s+[A-Z0-9-]+[\s\S]*open or scan:/.test(log) && Date.now() < deadline;) await new Promise(resolve => setTimeout(resolve, 200));
  const code = /pairing code:\s+([A-Z0-9-]+)/.exec(log)?.[1];
  await check("pairing code printed at start", async () => { assert.ok(code, log); assert.match(log, /AIKINGBOT is running/); assert.match(log, /https:\/\/bot-staging\.example\.com\/pair#code=/); });
  await check("bad pairing code refused", async () => { const response = await request("/api/pair", { method: "POST", headers: { ...proxied, "content-type": "application/json" }, body: JSON.stringify({ code: "AAAA-BBBB-CCCC", deviceName: "attacker" }) }); assert.ok(response.status >= 400); });
  await check("foreign-origin pairing refused through the proxy", async () => {
    const response = await request("/api/pair", {method:"POST",headers:{...proxied,origin:"https://foreign.invalid","content-type":"application/json"},body:JSON.stringify({code,deviceName:"foreign"})});
    assert.equal(response.status,403);
  });
  await check("admin pairs through the proxy", async () => {
    const response = await request("/api/pair", { method: "POST", headers: { ...proxied, "content-type": "application/json" }, body: JSON.stringify({ code, deviceName: "Smoke admin" }) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); assert.ok(body.token); token = body.token;
  });
  const authed = { ...proxied, authorization: `Bearer ${token}` };
  await check("pairing code is single use", async () => { const response = await request("/api/pair", { method: "POST", headers: { ...proxied, "content-type": "application/json" }, body: JSON.stringify({ code, deviceName: "replay" }) }); assert.ok(response.status >= 400); });
  await check("AIKING Core/Voice status for the owner", async () => { const response = await request("/api/aiking/status", { headers: authed }); const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.coreIntegrated, true); assert.equal(body.voice.configured, false); });
  await check("Marketplace catalog and records", async () => {
    const catalog = await (await request("/api/aiking/v1/catalog", { headers: authed })).json(); assert.ok(catalog.listings.length > 0);
    const records = await request("/api/aiking/marketplace/records", { headers: authed }); assert.equal(records.status, 200);
  });
  await check("agents API for the owner", async () => { const response = await request("/api/bots", { headers: authed }); assert.equal(response.status, 200); });
  await check("Voice WebSocket refused without a ticket", async () => {
    const answer = await new Promise((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => socket.write(`GET /api/aiking/voice/sessions?ticket=nope HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: ${base}\r\n\r\n`));
      let text = ""; socket.on("data", chunk => { text += chunk; if (text.includes("\r\n")) { socket.destroy(); resolve(text); } }); socket.on("error", reject); setTimeout(() => { socket.destroy(); resolve(text); }, 5000);
    });
    assert.match(answer, /^HTTP\/1\.1 403/);
  });
  await check("clean stop", async () => { const result = await stop(); assert.ok(result.code === 0 || result.signal === "SIGTERM", JSON.stringify(result)); });
  await check("restart keeps data and the paired session", async () => {
    await start(); const response = await request("/api/aiking/status", { headers: authed }); assert.equal(response.status, 200);
    assert.ok(existsSync(join(data, "aiking")), "AIKING data directory persisted");
  });
  await check("backup and restore scripts", async () => {
    await stop();
    const backups = join(root, "backups");
    const archived = execFileSync("bash", [join(app, "deploy/scripts/backup.sh"), join(root, "data"), backups], { encoding: "utf8" }).trim().split("\n").at(-1);
    execFileSync("sha256sum", ["-c", `${archived}.sha256`], { cwd: backups });
    const restored = join(root, "restored");
    execFileSync("bash", [join(app, "deploy/scripts/restore.sh"), archived, restored], { encoding: "utf8" });
    assert.ok(existsSync(join(restored, ".aikingbot/aiking")));
    assert.throws(() => execFileSync("bash", [join(app, "deploy/scripts/restore.sh"), archived, restored], { stdio: "pipe" }), "restore refuses a non-empty target");
  });
  const report = { bundle: archive.split("/").at(-1), sha256: execFileSync("sha256sum", [archive], { encoding: "utf8" }).split(" ")[0], commit: manifest.commit, version: manifest.version, node: process.version, checks };
  writeFileSync(join(out, "server-smoke.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`server smoke: ${checks.length} checks passed`);
} finally {
  if (server && server.exitCode === null) server.kill("SIGKILL");
  // `serve` stops its server child asynchronously; retry while the last writes settle.
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
