// Rex F3: realtime → step speech fallback through the real broker route (no provider: a scripted `codex app-server`
// that answers thread/realtime/start with a quota error).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AgentVoices, createRealtimeVoice, STEP_FALLBACK_MESSAGE } from "./realtime-voice.ts";

const OFFER = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const FAKE = `
const fs = require("node:fs");
let buffer = "";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let nl = buffer.indexOf("\\n"); nl >= 0; nl = buffer.indexOf("\\n")) {
    const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
    const m = JSON.parse(line);
    fs.appendFileSync(process.argv[2], line + "\\n");
    if (m.method === "initialize") send({ id: m.id, result: { userAgent: "fake" } });
    else if (m.method === "config/read") send({ id: m.id, result: { config: {} } });
    else if (m.method === "thread/realtime/listVoices") send({ id: m.id, result: { voices: { v1: [], v2: ["marin"], defaultV1: "alloy", defaultV2: "marin" } } });
    else if (m.method === "thread/start") send({ id: m.id, result: { thread: { id: "codex-thread-1" } } });
    else if (m.method === "thread/realtime/start") send({ id: m.id, error: { code: -32000, message: "insufficient_quota: You exceeded your current quota" } });
    else if (m.id !== undefined) send({ id: m.id, result: {} });
  }
});
`;
let dir: string; let server: Server; let base: string;
const starts = () => readFileSync(join(dir, "rpc.log"), "utf8").split("\n").filter((l) => l.includes('"thread/realtime/start"')).length;
const post = async (body: unknown) => { const r = await fetch(`${base}/api/aiking/realtime/calls`, { method: "POST", headers: { "content-type": "application/json", "x-owner": "owner-a" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() as any }; };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aiking-realtime-fallback-"));
  writeFileSync(join(dir, "fake.cjs"), FAKE); writeFileSync(join(dir, "rpc.log"), "");
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "fixture" } }));
  const broker = createRealtimeVoice({
    spawnAppServer: () => spawn(process.execPath, [join(dir, "fake.cjs"), join(dir, "rpc.log")], { stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams,
    codexHome: () => dir,
    resolveTarget: (botId, threadId) => ({ botId, threadId: threadId ?? "thread-1", botName: "Dumpling", cwd: dir, voiceSupported: true }),
    voices: new AgentVoices(join(dir, "agent-voices.json")),
    askAgent: async () => "unused",
  });
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const readBody = (r: typeof req) => new Promise<unknown>((resolve) => { let raw = ""; r.on("data", (c) => (raw += c)); r.on("end", () => resolve(raw ? JSON.parse(raw) : {})); });
    const json = (r: typeof res, status: number, body: unknown) => { r.writeHead(status, { "content-type": "application/json" }); r.end(JSON.stringify(body)); };
    if (!(await broker.handle({ req, res, path: url.pathname, method: req.method ?? "GET", owner: String(req.headers["x-owner"]), json, readBody }))) json(res, 404, {});
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise((done) => server.close(done)); });

it("hands an out-of-quota realtime call to step speech, and keeps later calls there", async () => {
  const first = await post({ botId: "bot-1", threadId: "thread-1", sdp: OFFER });
  expect(first.status).toBe(409);
  expect(first.body).toEqual({ error: STEP_FALLBACK_MESSAGE, fallback: "step", botId: "bot-1", threadId: "thread-1", stages: ["stt", "llm", "tts"] });
  expect(starts()).toBe(1);
  const second = await post({ botId: "bot-1", threadId: "thread-1", sdp: OFFER });
  expect(second.body.fallback).toBe("step");
  expect(starts()).toBe(1); // sticky: realtime is not tried again
  const status = await (await fetch(`${base}/api/aiking/realtime/status?botId=bot-1`, { headers: { "x-owner": "owner-a" } })).json() as any;
  expect(status).toMatchObject({ available: false, reason: STEP_FALLBACK_MESSAGE, fallback: "step" });
});
