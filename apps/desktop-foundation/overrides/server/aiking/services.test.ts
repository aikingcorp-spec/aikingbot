// Copyright (c) 2026 AIKING.
import { describe, expect, it } from "vitest";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createAikingServices } from "./services.ts";
import { json, readBody } from "../harness/http.ts";
import type { SessionRecord } from "../sessions.ts";
import type { RequestAuth } from "../request-auth.ts";
import { decodeCatalog } from "../../aiking/catalog-schema.mjs";
import { createHash } from "node:crypto";
import { installSkill, listSkills, readSkillFile } from "../skills.ts";

async function fixture(existing?: string, { offline = true, reply }: { offline?: boolean; reply?: (text: string) => Promise<string> } = {}) {
  const dataDir = existing ?? mkdtempSync(join(tmpdir(), "aiking-services-"));
  let closed = false;
  const live = new Set(["owner-a", "owner-b"]); let cancelled = false;
  const services = createAikingServices({ dataDir, offline, isOwnerLive: owner => live.has(owner), owns: (bot, thread) => bot === "bot" && thread === "thread",
    reply: async (_bot, _thread, text, signal) => reply ? reply(text) : new Promise((_resolve, reject) => signal.addEventListener("abort", () => { cancelled = true; reject(signal.reason); }, { once: true })) });
  const auth = (req: IncomingMessage): RequestAuth => ({ kind: "session", via: "bearer", scopes: req.headers["x-client"] ? ["client"] : ["admin"], session: { id: String(req.headers["x-owner"] || "owner-a") } as SessionRecord });
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    void services.handle({ req, res, url, path: url.pathname, method: req.method!, auth: auth(req), json, readBody }).catch(() => json(res, 500, { error: "Fixture failed" }));
  });
  services.attach(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No port");
  const origin = `http://127.0.0.1:${address.port}`;
  const api = (path: string, body?: object, headers = {}) => fetch(origin + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", origin, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const ticket = async (owner = "owner-a") => ((await (await api("/api/aiking/voice/ticket", { botId: "bot", threadId: "thread" }, { "x-owner": owner })).json()) as { ticket: string }).ticket;
  const connect = async (key: string) => { const socket = new WebSocket(origin.replace("http", "ws") + "/api/aiking/voice/sessions?ticket=" + key, { origin }); await once(socket, "open"); return socket; };
  return { dataDir, live, services, api, ticket, connect, origin, cancelled: () => cancelled,
    close: async (keep = false) => { if (closed) return; closed = true; services.revokeOwner("owner-a"); services.revokeOwner("owner-b"); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); if (!keep) rmSync(dataDir, { recursive: true, force: true }); } };
}
// An OpenAI-compatible speech service on loopback: /stt (multipart WAV → text) and /tts (JSON → PCM16).
async function speechService({ failStt = false } = {}) {
  const seen: { stt?: { auth?: string; model?: string; wav?: Buffer }; tts?: { auth?: string; body?: Record<string, unknown> } } = {};
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk as Buffer); const body = Buffer.concat(chunks);
    if (req.url === "/stt") {
      if (failStt) { res.writeHead(500).end("upstream exploded sk-ant-api03-SECRETSECRETSECRETSECRET"); return; }
      const form = await new Request("http://local", { method: "POST", headers: { "content-type": String(req.headers["content-type"]) }, body }).formData();
      const file = form.get("file") as File; seen.stt = { auth: req.headers.authorization, model: String(form.get("model")), wav: Buffer.from(await file.arrayBuffer()) };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ text: "  schedule the launch review  " }));
    } else if (req.url === "/tts") {
      seen.tts = { auth: req.headers.authorization, body: JSON.parse(body.toString()) };
      const pcm = Buffer.alloc(22050 * 2); for (let i = 0; i < 22050; i++) pcm.writeInt16LE(i % 200, i * 2);
      res.writeHead(200, { "content-type": "audio/pcm", "x-sample-rate": "22050" }).end(pcm);
    } else res.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No port");
  return { url: `http://127.0.0.1:${address.port}`, seen, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
function withSpeechEnv(url: string) {
  const keys = ["AIKING_STT_URL", "AIKING_STT_TOKEN", "AIKING_STT_MODEL", "AIKING_TTS_URL", "AIKING_TTS_TOKEN", "AIKING_TTS_MODEL", "AIKING_TTS_VOICE"] as const;
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { AIKING_STT_URL: `${url}/stt`, AIKING_STT_TOKEN: "stt-token", AIKING_STT_MODEL: "whisper-large-v3", AIKING_TTS_URL: `${url}/tts`, AIKING_TTS_TOKEN: "tts-token", AIKING_TTS_MODEL: "tts-hd", AIKING_TTS_VOICE: "nova" });
  return () => { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } };
}
function collect(socket: WebSocket, until: (events: Array<Record<string, unknown>>) => boolean) {
  const events: Array<Record<string, unknown>> = []; let audioBytes = 0;
  return new Promise<{ events: Array<Record<string, unknown>>; audioBytes: number }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${JSON.stringify(events)}`)), 10000);
    socket.on("message", (data, binary) => {
      if (binary) { audioBytes += (data as Buffer).length; return; }
      events.push(JSON.parse(String(data))); if (until(events)) { clearTimeout(timer); resolve({ events, audioBytes }); }
    });
  });
}
const start = (socket: WebSocket, resumeToken?: string) => socket.send(JSON.stringify({ type: "session.start", botId: "bot", threadId: "thread", format: { sampleRate: 16000, encoding: "pcm16" }, resumeToken }));

describe("AIKING owner services", () => {
  it("persists installs across service restart and denies client-scoped mutations", async () => {
    const f = await fixture();
    try {
      expect((await f.api("/api/aiking/marketplace/records", { action: "remove", listingId: "x" }, { "x-client": "1" })).status).toBe(403);
      const record = { listingId: "media-producer", version: "1.0.0", kind: "agent", targets: ["bot"], installedAt: new Date().toISOString() };
      expect((await f.api("/api/aiking/marketplace/records", { action: "add", record })).status).toBe(200);
      expect((await f.api("/api/aiking/voice/ticket", { botId: "bot", threadId: "foreign" })).status).toBe(403);
      await f.close(true);
      const reopened = await fixture(f.dataDir);
      try { expect(((await (await reopened.api("/api/aiking/marketplace/records")).json()) as { records: unknown[] }).records[0]).toMatchObject(record); } finally { await reopened.close(); }
    } finally { await f.close(); }
  });
  it("updates only reviewed catalog skills at the requested hash and keeps disabled skills disabled", async () => {
    const f = await fixture();
    try {
      const catalog = decodeCatalog(await (await f.api("/api/aiking/v1/catalog")).json()); const listing = catalog.listings.find(listing => listing.kind === "skill");
      if (!listing || listing.kind !== "skill") throw new Error("No catalog skill");
      const old = listing.text + "\nOld reviewed fixture revision.\n";
      expect(installSkill("bot", `aiking-marketplace:${listing.id}@0.0.1`, [{ path: "SKILL.md", content: old }])).not.toHaveProperty("error");
      const body = { listingId: listing.id, botId: "bot", threadId: "thread", baseSha256: "0".repeat(64) };
      expect((await f.api("/api/aiking/marketplace/skill-update", body)).status).toBe(409); expect(readSkillFile("bot", listing.skillName)).toBe(old);
      body.baseSha256 = createHash("sha256").update(old).digest("hex");
      expect((await f.api("/api/aiking/marketplace/skill-update", body)).status).toBe(200);
      expect(readSkillFile("bot", listing.skillName)).toBe(listing.text); expect(listSkills("bot").find(skill => skill.name === listing.skillName)?.enabled).toBe(false);
      expect((await f.api("/api/aiking/marketplace/skill-update", body)).status).toBe(409);
    } finally { await f.close(); }
  });
  it("consumes tickets once, binds resume to its owner, cancels work on revocation", async () => {
    const f = await fixture(); let socket: WebSocket | undefined;
    try {
      const key = await f.ticket(); socket = await f.connect(key); const ready = once(socket, "message"); start(socket); const event = JSON.parse(String((await ready)[0])); expect(event.type).toBe("session.ready");
      await expect(f.connect(key)).rejects.toThrow(/403/);
      const closed = once(socket, "close"); socket.close(); await closed;
      socket = await f.connect(await f.ticket("owner-b")); const denied = once(socket, "message"); start(socket, event.resumeToken); expect(JSON.parse(String((await denied)[0])).type).toBe("error"); socket.terminate();
      socket = await f.connect(await f.ticket()); const resumed = once(socket, "message"); start(socket, event.resumeToken); await resumed;
      const transcript = once(socket, "message"); socket.send(Buffer.alloc(640)); socket.send(JSON.stringify({ type: "input.end" })); await transcript;
      await new Promise(resolve => setTimeout(resolve, 20));
      const revoked = once(socket, "close"); f.live.delete("owner-a"); f.services.revokeOwner("owner-a"); await revoked;
      await expect.poll(f.cancelled).toBe(true);
      const revokedKey = await f.ticket(); await expect(f.connect(revokedKey)).rejects.toThrow(/403/);
    } finally { socket?.terminate(); await f.close(); }
  });
  it("runs a voice turn through configured HTTP speech adapters", async () => {
    const speech = await speechService(); const restore = withSpeechEnv(speech.url); const heard: string[] = [];
    const f = await fixture(undefined, { offline: false, reply: async text => { heard.push(text); return "Launch review is on Friday."; } });
    let socket: WebSocket | undefined;
    try {
      expect(((await (await f.api("/api/aiking/status")).json()) as { voice: { configured: boolean } }).voice.configured).toBe(true);
      socket = await f.connect(await f.ticket()); const ready = once(socket, "message"); start(socket); expect(JSON.parse(String((await ready)[0])).type).toBe("session.ready");
      const done = collect(socket, events => events.some(event => event.type === "response.audio.end" || event.type === "error"));
      for (let i = 0; i < 25; i++) socket.send(Buffer.alloc(640, i)); socket.send(JSON.stringify({ type: "input.end" }));
      const { events, audioBytes } = await done;
      expect(events.map(event => event.type)).toEqual(["response.thinking", "transcript", "transcript", "response.audio.start", "response.audio.end"]);
      expect(events[1]).toMatchObject({ role: "user", text: "schedule the launch review", final: true });
      expect(events[2]).toMatchObject({ role: "agent", text: "Launch review is on Friday." });
      expect(events[3]).toMatchObject({ sampleRate: 22050 }); expect(audioBytes).toBe(22050 * 2);
      expect(heard).toEqual(["schedule the launch review"]);
      expect(speech.seen.stt).toMatchObject({ auth: "Bearer stt-token", model: "whisper-large-v3" });
      expect(speech.seen.stt!.wav!.subarray(0, 4).toString()).toBe("RIFF"); expect(speech.seen.stt!.wav!.length).toBe(44 + 25 * 640);
      expect(speech.seen.tts).toMatchObject({ auth: "Bearer tts-token", body: { input: "Launch review is on Friday.", voice: "nova", model: "tts-hd", response_format: "pcm" } });
    } finally { socket?.terminate(); await f.close(); restore(); await speech.close(); }
  });
  it("reports a failing speech adapter without leaking its response", async () => {
    const speech = await speechService({ failStt: true }); const restore = withSpeechEnv(speech.url);
    const f = await fixture(undefined, { offline: false, reply: async () => "unused" }); let socket: WebSocket | undefined;
    try {
      socket = await f.connect(await f.ticket()); const ready = once(socket, "message"); start(socket); await ready;
      const done = collect(socket, events => events.some(event => event.type === "error"));
      socket.send(Buffer.alloc(640)); socket.send(JSON.stringify({ type: "input.end" }));
      const failure = (await done).events.find(event => event.type === "error")!;
      expect(failure.message).toBe("Speech-to-text service returned 500."); expect(JSON.stringify(failure)).not.toContain("SECRET");
    } finally { socket?.terminate(); await f.close(); restore(); await speech.close(); }
  });
});
