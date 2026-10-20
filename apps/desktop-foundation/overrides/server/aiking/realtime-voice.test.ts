// Copyright (c) 2026 AIKING.
// Realtime voice broker against a scripted stand-in for `codex app-server` (no provider, no audio): the read-only
// relay it starts, ask_agent reaching the agent's own conversation, refusals, ownership of calls, clean shutdown.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentVoices, codexRealtimeAccount, createRealtimeVoice, relayConfig, spawnCodexAppServer, validOffer } from "./realtime-voice.ts";
import { registerPathDir, resetPathCache } from "../env-path.ts";

const OFFER = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const ANSWER = "v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";

// Records every message it receives; answers like the app server; after realtime starts it asks an approval, an
// unknown request and one ask_agent call.
const FAKE = `
const fs = require("node:fs");
const log = process.argv[2];
let buffer = "";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let nl = buffer.indexOf("\\n"); nl >= 0; nl = buffer.indexOf("\\n")) {
    const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
    const m = JSON.parse(line);
    fs.appendFileSync(log, line + "\\n");
    if (m.method === "initialize") send({ id: m.id, result: { userAgent: "fake" } });
    else if (m.method === "config/read") send({ id: m.id, result: { config: { mcp_servers: { telegram: {}, "tony-gemini": {} } } } });
    else if (m.method === "thread/realtime/listVoices") send({ id: m.id, result: { voices: { v1: ["alloy"], v2: ["marin", "cedar"], defaultV1: "alloy", defaultV2: "marin" } } });
    else if (m.method === "thread/start") send({ id: m.id, result: { thread: { id: "codex-thread-1" } } });
    else if (m.method === "thread/realtime/start") {
      send({ id: m.id, result: {} });
      send({ method: "thread/realtime/sdp", params: { threadId: "codex-thread-1", sdp: ${JSON.stringify(ANSWER)} } });
      send({ method: "thread/realtime/transcript/done", params: { threadId: "codex-thread-1", role: "user", text: "Read secret.txt please" } });
      send({ method: "thread/realtime/transcript/done", params: { threadId: "other-thread", role: "assistant", text: "not this call" } });
      send({ id: "approval-1", method: "item/commandExecution/requestApproval", params: { threadId: "codex-thread-1", command: "rm -rf build" } });
      send({ id: "other-1", method: "item/tool/requestUserInput", params: {} });
      send({ id: "ask-1", method: "item/tool/call", params: { threadId: "codex-thread-1", turnId: "t", callId: "c", namespace: null, tool: "ask_agent", arguments: { request: "Read secret.txt and tell me the word" } } });
    } else if (m.method === "thread/realtime/stop") send({ id: m.id, result: {} });
  }
});
`;

let dir: string;
let server: Server;
let base: string;
const logOf = () => readFileSync(join(dir, "rpc.log"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const asked: Array<{ botId: string; threadId: string; request: string }> = [];
let agentAnswer: () => Promise<string> = async () => "The word is falcon43.";

const voice = () => createRealtimeVoice({
  spawnAppServer: () => spawn(process.execPath, [join(dir, "fake.cjs"), join(dir, "rpc.log")], { stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams,
  codexHome: () => dir,
  resolveTarget: (botId, threadId) => botId === "bot-1" || botId === "claude-bot" ? { botId, threadId: threadId ?? "thread-1", botName: botId === "bot-1" ? "Dumpling" : "Basil", cwd: join(dir, "work"), voiceSupported: botId === "bot-1" } : null,
  voices: new AgentVoices(join(dir, "agent-voices.json")),
  askAgent: async (target, request) => { asked.push({ botId: target.botId, threadId: target.threadId, request }); return agentAnswer(); },
});
let broker: ReturnType<typeof voice>;

function call(path: string, owner: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest(`${base}${path}`, { method: payload ? "POST" : "GET", agent: false, headers: { "x-owner": owner, ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}) } }, (res) => {
      let raw = ""; res.on("data", (c) => (raw += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aiking-realtime-"));
  writeFileSync(join(dir, "fake.cjs"), FAKE);
  writeFileSync(join(dir, "rpc.log"), "");
  broker = voice();
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const readBody = (r: typeof req) => new Promise<unknown>((resolve) => { let raw = ""; r.on("data", (c) => (raw += c)); r.on("end", () => resolve(raw ? JSON.parse(raw) : {})); });
    const json = (r: typeof res, status: number, body: unknown) => { r.writeHead(status, { "content-type": "application/json" }); r.end(JSON.stringify(body)); };
    if (!(await broker.handle({ req, res, path: url.pathname, method: req.method ?? "GET", owner: String(req.headers["x-owner"]), json, readBody }))) json(res, 404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  for (const active of broker.calls.values()) await broker.end(active, "test end");
  await new Promise((resolve) => server.close(resolve));
});

const until = async (check: () => Promise<boolean>, ms = 5_000) => {
  const deadline = Date.now() + ms;
  while (!(await check())) { if (Date.now() > deadline) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 25)); }
};

describe("realtime voice broker", () => {
  it("needs a ChatGPT Codex sign-in, not an API key", () => {
    expect(codexRealtimeAccount(dir)).toMatchObject({ available: false });
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ auth_mode: "apikey" }));
    expect(codexRealtimeAccount(dir)).toMatchObject({ available: false, reason: expect.stringMatching(/API key/) });
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "never-read-here" } }));
    expect(codexRealtimeAccount(dir)).toEqual({ available: true });
    expect(validOffer(OFFER)).toBe(true);
    expect(validOffer("v=0\r\nm=video 9")).toBe(false);
    expect(validOffer("x".repeat(70_000))).toBe(false);
  });

  it("starts a v3 WebRTC session on a read-only relay whose only tool reaches the agent's own conversation", async () => {
    const started = await call("/api/aiking/realtime/calls", "owner-a", { botId: "bot-1", threadId: "thread-1", sdp: OFFER, voice: "maple" });
    expect(started.status).toBe(201);
    expect(started.body.sdp).toBe(ANSWER);
    const sent = logOf();
    expect(sent.find((m) => m.method === "initialize").params.capabilities.experimentalApi).toBe(true);
    const thread = sent.find((m) => m.method === "thread/start").params;
    expect(thread).toMatchObject({ cwd: join(dir, "work"), approvalPolicy: "never", sandbox: "read-only" });
    expect(thread.dynamicTools.map((tool: any) => tool.name)).toEqual(["ask_agent"]);
    expect(thread.config).toMatchObject({ "features.shell_tool": false, "features.apps": false, web_search: "disabled", "mcp_servers.telegram.enabled": false, "mcp_servers.tony-gemini.enabled": false });
    expect(thread.developerInstructions).toMatch(/Do not do the work yourself/);
    expect(sent.find((m) => m.method === "thread/realtime/start").params).toMatchObject({
      threadId: "codex-thread-1", version: "v3", outputModality: "audio", clientManagedHandoffs: false, transport: { type: "webrtc", sdp: OFFER }, voice: "maple",
    });
    await until(async () => logOf().some((m) => m.id === "ask-1"));
    expect(asked).toEqual([{ botId: "bot-1", threadId: "thread-1", request: "Read secret.txt and tell me the word" }]);
    expect(logOf().find((m) => m.id === "ask-1").result).toEqual({ contentItems: [{ type: "inputText", text: "The word is falcon43." }], success: true });
    // The relay may not approve or ask anything else.
    expect(logOf().find((m) => m.id === "approval-1").error).toBeTruthy();
    expect(logOf().find((m) => m.id === "other-1").error).toBeTruthy();
    const view = await call(`/api/aiking/realtime/calls/${started.body.id}`, "owner-a");
    expect(view.body.events.map((e: any) => e.type)).toEqual(["transcript", "agent-working", "agent-done"]);
    expect(view.body.events[1].request).toBe("Read secret.txt and tell me the word");
    expect(view.body).toMatchObject({ botId: "bot-1", threadId: "thread-1", working: false });
    // Another session cannot see or end this call; one call per person.
    expect((await call(`/api/aiking/realtime/calls/${started.body.id}`, "owner-b")).status).toBe(404);
    expect((await call(`/api/aiking/realtime/calls/${started.body.id}/end`, "owner-b", {})).status).toBe(404);
    expect((await call("/api/aiking/realtime/calls", "owner-a", { botId: "bot-1", sdp: OFFER })).status).toBe(409);
    expect((await call(`/api/aiking/realtime/calls/${started.body.id}/end`, "owner-a", {})).status).toBe(200);
    await until(async () => logOf().some((m) => m.method === "thread/realtime/stop"));
    const ended = await call(`/api/aiking/realtime/calls/${started.body.id}`, "owner-a");
    expect(ended.body.active).toBe(false);
    expect(ended.body.events.at(-1).type).toBe("closed");
  });

  it("tells the voice when the agent failed, and a revoked session's call ends", async () => {
    writeFileSync(join(dir, "rpc.log"), "");
    agentAnswer = async () => { throw new Error("Dumpling is already working in this conversation."); };
    // Each agent keeps its own voice; a call without one uses it.
    const put = await new Promise<number>((resolve) => { const req = httpRequest(`${base}/api/aiking/realtime/agents/bot-1/voice`, { method: "PUT", agent: false, headers: { "x-owner": "owner-c", "content-type": "application/json" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }); req.end(JSON.stringify({ voice: "juniper" })); });
    expect(put).toBe(200);
    expect(JSON.parse(readFileSync(join(dir, "agent-voices.json"), "utf8"))).toEqual({ "bot-1": "juniper" });
    const started = await call("/api/aiking/realtime/calls", "owner-c", { botId: "bot-1", sdp: OFFER });
    expect(started.status).toBe(201);
    expect(logOf().find((m) => m.method === "thread/realtime/start").params.voice).toBe("juniper");
    await until(async () => logOf().some((m) => m.id === "ask-1"));
    expect(logOf().find((m) => m.id === "ask-1").result).toMatchObject({ success: false, contentItems: [{ text: expect.stringMatching(/could not finish: Dumpling is already working/) }] });
    broker.revokeOwner("owner-c");
    await until(async () => !(await call(`/api/aiking/realtime/calls/${started.body.id}`, "owner-c")).body.active);
    agentAnswer = async () => "The word is falcon43.";
  });

  it("refuses bad requests and unknown agents", async () => {
    expect((await call("/api/aiking/realtime/calls", "owner-d", { botId: "bot-1", sdp: "not sdp" })).status).toBe(400);
    expect((await call("/api/aiking/realtime/calls", "owner-d", { botId: "nobody", sdp: OFFER })).status).toBe(404);
    expect((await call("/api/aiking/realtime/status", "owner-d")).body).toMatchObject({ available: true, provider: "codex", transport: "webrtc", voices: ["juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol", "cove"] });
    expect((await call("/api/aiking/realtime/calls", "owner-d", { botId: "bot-1", sdp: OFFER, voice: "cedar" })).status).toBe(400);
    // An agent on a model without realtime voice says so, and cannot be called.
    expect((await call("/api/aiking/realtime/status?botId=claude-bot", "owner-d")).body).toMatchObject({ available: false, reason: "Voice is not available for this model.", agent: { supported: false } });
    const refused = await call("/api/aiking/realtime/calls", "owner-d", { botId: "claude-bot", sdp: OFFER });
    expect(refused).toMatchObject({ status: 409, body: { error: "Voice is not available for this model." } });
    expect((await call("/api/aiking/realtime/status?botId=bot-1", "owner-d")).body.agent).toEqual({ supported: true, voice: "juniper" });
  });

  it("disables only well-formed MCP server names", () => {
    expect(relayConfig(["ok_name", "bad name", "x.y"])).toMatchObject({ "mcp_servers.ok_name.enabled": false });
    expect(Object.keys(relayConfig(["bad name", "x.y"])).some((key) => key.startsWith("mcp_servers."))).toBe(false);
  });
});

describe("finding Codex for a call", () => {
  it("uses the app's managed engine folder even when the plain PATH has no codex (the Windows install)", async () => {
    const managed = mkdtempSync(join(tmpdir(), "aiking-managed-engines-"));
    const windows = process.platform === "win32";
    // Windows installs a real codex.exe (a .cmd file cannot be spawned directly); any executable stands in for it here.
    if (windows) copyFileSync(process.execPath, join(managed, "codex.exe"));
    else { writeFileSync(join(managed, "codex"), "#!/bin/sh\necho managed-codex\n"); chmodSync(join(managed, "codex"), 0o755); }
    const originalPath = process.env.PATH;
    process.env.PATH = windows ? (process.env.SystemRoot ?? "C:\\Windows") + "\\System32" : "/usr/bin:/bin";
    registerPathDir(managed);
    try {
      const child = spawnCodexAppServer("codex");
      let out = "";
      child.stdout.on("data", (chunk) => { out += chunk; });
      const started = await new Promise<string>((resolve, reject) => { child.on("error", reject); child.on("spawn", () => resolve("spawned")); });
      expect(started).toBe("spawned");
      if (windows) child.kill();
      else {
        const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
        expect(code).toBe(0);
        expect(out).toContain("managed-codex");
      }
    } finally {
      process.env.PATH = originalPath;
      resetPathCache();
    }
  });
  it("says why when Codex cannot be started", async () => {
    const child = spawnCodexAppServer("definitely-not-installed-codex");
    const failure = await new Promise<NodeJS.ErrnoException>((resolve) => child.on("error", resolve));
    expect(failure.code).toBe("ENOENT");
  });
});
