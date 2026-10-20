// Copyright (c) 2026 AIKING.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.ts";
import catalogDocument from "../../aiking/catalog.json" with { type: "json" };
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import type { RouteContext } from "../routes/table.ts";
import { isLoopbackHost } from "../request-auth.ts";
import { redactSecretsInText } from "../../shared/redact.ts";
import { decodeCatalog } from "../../aiking/catalog-schema.mjs";
import { updateCatalogSkill } from "../skills.ts";

const startSchema = z.object({ type: z.literal("session.start"), botId: z.string().min(1).max(200), threadId: z.string().min(1).max(200), resumeToken: z.string().optional(), format: z.object({ sampleRate: z.literal(16000), encoding: z.literal("pcm16") }) });
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/).max(32);
const recordSchema = z.object({ listingId: z.string().regex(/^[a-z0-9-]{1,100}$/), version: versionSchema, kind: z.enum(["agent", "app", "skill"]), targets: z.array(z.string().max(200)).max(100), installedAt: z.string().datetime(), targetVersions: z.record(z.string().max(200), versionSchema).optional() });
const ticketBody = z.object({ botId: z.string().min(1).max(200), threadId: z.string().min(1).max(200) });
type ServicesOptions = { dataDir: string; offline: boolean; isOwnerLive(owner: string): boolean; owns(bot: string, thread: string): boolean; reply(bot: string, thread: string, text: string, signal: AbortSignal): Promise<string>; speechKeys?: () => { openai?: string } };
type SpeechAdapter = { url: string; token?: string; model: string; provider: string };
/** Speech for calls: the operator's adapters (AIKING_STT_URL/AIKING_TTS_URL) win; otherwise the workspace's own OpenAI key in Connections. */
export type SpeechConfig = { stt: SpeechAdapter | null; tts: (SpeechAdapter & { voice: string }) | null };

export function speechConfig(env: NodeJS.ProcessEnv, keys: { openai?: string } = {}): SpeechConfig {
  const openai = keys.openai?.trim();
  const stt = env.AIKING_STT_URL
    ? { url: env.AIKING_STT_URL, token: env.AIKING_STT_TOKEN, model: env.AIKING_STT_MODEL || "whisper-1", provider: "operator" }
    : openai ? { url: "https://api.openai.com/v1/audio/transcriptions", token: openai, model: env.AIKING_STT_MODEL || "whisper-1", provider: "openai" } : null;
  const tts = env.AIKING_TTS_URL
    ? { url: env.AIKING_TTS_URL, token: env.AIKING_TTS_TOKEN, model: env.AIKING_TTS_MODEL || "tts-1", voice: env.AIKING_TTS_VOICE || "alloy", provider: "operator" }
    : openai ? { url: "https://api.openai.com/v1/audio/speech", token: openai, model: env.AIKING_TTS_MODEL || "gpt-4o-mini-tts", voice: env.AIKING_TTS_VOICE || "alloy", provider: "openai" } : null;
  return { stt, tts };
}

function speechEndpoint(value: string) {
  const url = new URL(value);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) || url.username || url.password) throw new Error("Speech adapters require HTTPS or loopback HTTP, with credentials in server headers.");
  return url;
}
async function limitedBody(response: Response, limit: number) {
  const reader = response.body?.getReader(); if (!reader) throw new Error("Speech adapter returned no body.");
  const parts: Buffer[] = []; let size = 0;
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > limit) throw new Error("Speech adapter response is too large."); parts.push(Buffer.from(chunk.value)); } }
  finally { await reader.cancel(); }
  return Buffer.concat(parts);
}

function wav(pcm: Buffer) {
  const header = Buffer.alloc(44); header.write("RIFF"); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40); return Buffer.concat([header, pcm]);
}

export function createAikingServices(options: ServicesOptions) {
  const root = join(options.dataDir, "aiking"); mkdirSync(root, { recursive: true, mode: 0o700 });
  const recordsPath = join(root, "marketplace-installs.json");
  const catalog = decodeCatalog(process.env.AIKING_CATALOG_FILE ? JSON.parse(readFileSync(process.env.AIKING_CATALOG_FILE, "utf8")) : catalogDocument);
  let records = existsSync(recordsPath) ? z.array(recordSchema).parse(JSON.parse(readFileSync(recordsPath, "utf8"))) : [];
  const persist = (next: typeof records) => { writeFileAtomic(recordsPath, JSON.stringify(next), { mode: 0o600 }); records = next; };
  type Ticket = { botId: string; threadId: string; origin: string; owner: string; expires: number };
  const tickets = new Map<string, Ticket>();
  const resumes = new Map<string, { botId: string; threadId: string; owner: string; expires: number }>();
  const owners = new Map<WebSocket, string>();
  const cancellations = new Map<WebSocket, () => void>();
  const active = new Set<string>();
  const websocket = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  websocket.on("connection", (socket: WebSocket, _req: IncomingMessage, ticket: Ticket) => {
    owners.set(socket, ticket.owner);
    let ready = false; let chunks: Buffer[] = []; let bytes = 0; let abort: AbortController | undefined;
    const address = JSON.stringify([ticket.botId, ticket.threadId]);
    const send = (event: object) => { if (!options.isOwnerLive(ticket.owner)) { socket.close(1008, "Session revoked"); return; } if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event)); };
    const error = (message: string) => send({ type: "error", code: "provider-unavailable", message: redactSecretsInText(message), retryable: false });
    const cancel = () => { abort?.abort(); abort = undefined; chunks = []; bytes = 0; };
    cancellations.set(socket, cancel);
    const handshake = setTimeout(() => socket.close(1008, "Handshake timeout"), 10000);
    socket.on("message", (data, binary) => {
      const raw = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
      try {
        if (!options.isOwnerLive(ticket.owner)) throw new Error("Workspace session was revoked.");
        if (binary) {
          if (!ready || raw.length !== 640) throw new Error("Expected 20 ms PCM16 mono at 16 kHz.");
          bytes += raw.length; if (bytes > 32000 * 60) throw new Error("Utterance exceeded 60 seconds.");
          chunks.push(raw); return;
        }
        const event = JSON.parse(raw.toString());
        if (event.type === "session.start") {
          const start = startSchema.parse(event);
          if (ready || start.botId !== ticket.botId || start.threadId !== ticket.threadId || !options.owns(start.botId, start.threadId)) throw new Error("Voice session does not own this conversation.");
          if (!options.offline) {
            const speech = speechConfig(process.env, options.speechKeys?.());
            if (!speech.stt || !speech.tts) throw new Error("Voice calls need a speech service: add an OpenAI API key in Settings → Connections, or ask the workspace operator to configure speech adapters.");
            speechEndpoint(speech.stt.url); speechEndpoint(speech.tts.url);
          }
          if (start.resumeToken) { const old = resumes.get(start.resumeToken); if (!old || old.expires < Date.now() || old.botId !== start.botId || old.threadId !== start.threadId || old.owner !== ticket.owner) throw new Error("Resume token is not valid for this conversation."); resumes.delete(start.resumeToken); }
          if (active.has(address)) throw new Error("Another call is active on this conversation.");
          if (active.size >= 20 || resumes.size >= 1000) throw new Error("Voice service is at capacity.");
          active.add(address); ready = true; clearTimeout(handshake);
          const resumeToken = randomUUID(); resumes.set(resumeToken, { botId: start.botId, threadId: start.threadId, owner: ticket.owner, expires: Date.now() + 5 * 60_000 });
          send({ type: "session.ready", resumeToken });
        } else if (event.type === "response.cancel") cancel();
        else if (event.type === "session.close") { cancel(); socket.close(1000); }
        else if (event.type === "input.end" && ready) {
          if (!bytes || abort) return;
          const pcm = Buffer.concat(chunks); chunks = []; bytes = 0;
          const controller = new AbortController(); abort = controller;
          void (async () => {
            try {
              send({ type: "response.thinking" });
              let text: string;
              if (options.offline) text = "Offline microphone fixture: plan the AIKING voice test.";
              else {
                const stt = speechConfig(process.env, options.speechKeys?.()).stt; if (!stt) throw new Error("The speech-to-text service is no longer configured.");
                const form = new FormData(); form.set("file", new Blob([wav(pcm)]), "speech.wav"); form.set("model", stt.model);
                const response = await fetch(speechEndpoint(stt.url), { method: "POST", body: form, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]), headers: stt.token ? { authorization: `Bearer ${stt.token}` } : {} });
                if (!response.ok) throw new Error(`Speech-to-text service returned ${response.status}.`);
                text = String((JSON.parse((await limitedBody(response, 1024 * 1024)).toString()) as { text?: unknown }).text ?? "").trim(); if (!text || text.length > 20000) throw new Error("No valid speech text was recognized.");
              }
              if (controller.signal.aborted) return;
              send({ type: "transcript", role: "user", text, final: true });
              const reply = await options.reply(ticket.botId, ticket.threadId, text, controller.signal);
              if (controller.signal.aborted) return;
              send({ type: "transcript", role: "agent", text: reply, final: true });
              let audio: Buffer; let sampleRate = 24000;
              if (options.offline) { audio = Buffer.alloc(24000 * 2); for (let i = 0; i < 24000; i++) audio.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 24000) * 1600), i * 2); }
              else {
                const tts = speechConfig(process.env, options.speechKeys?.()).tts; if (!tts) throw new Error("The text-to-speech service is no longer configured.");
                const response = await fetch(speechEndpoint(tts.url), { method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]), headers: { "content-type": "application/json", ...(tts.token ? { authorization: `Bearer ${tts.token}` } : {}) }, body: JSON.stringify(tts.provider === "openai" ? { input: reply, voice: tts.voice, model: tts.model, response_format: "pcm" } : { text: reply, input: reply, voice: tts.voice, model: tts.model, response_format: "pcm" }) });
                if (!response.ok) throw new Error(`Text-to-speech service returned ${response.status}.`);
                sampleRate = Number(response.headers.get("x-sample-rate") || 24000);
                audio = await limitedBody(response, 16 * 1024 * 1024); if (audio.length % 2 || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error("Invalid PCM16 speech response.");
              }
              if (controller.signal.aborted) return;
              send({ type: "response.audio.start", sampleRate });
              for (let offset = 0; offset < audio.length; offset += 4800) { if (socket.readyState !== WebSocket.OPEN || controller.signal.aborted || !options.isOwnerLive(ticket.owner)) return; socket.send(audio.subarray(offset, offset + 4800)); }
              send({ type: "response.audio.end" });
            } catch (cause) { if (!controller.signal.aborted) error(cause instanceof Error ? cause.message : "Voice provider failed."); }
            finally { if (abort === controller) abort = undefined; }
          })();
        } else throw new Error("Unsupported voice protocol event.");
      } catch (cause) { error(cause instanceof Error ? cause.message : "Invalid voice event."); socket.close(1008); }
    });
    socket.on("close", () => { owners.delete(socket); cancellations.delete(socket); clearTimeout(handshake); cancel(); if (ready) active.delete(address); });
  });
  return {
    async handle(context: RouteContext) {
      const { req, res, path, method, json, readBody, auth } = context;
      if (!path.startsWith("/api/aiking/")) return false;
      if (method !== "GET" && !/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) { json(res, 415, { error: "Send JSON with application/json content type." }); return true; }
      if (!auth.scopes.includes("admin")) { json(res, 403, { error: "AIKING settings require workspace owner access." }); return true; }
      if (method === "GET" && path === "/api/aiking/status") { const speech = speechConfig(process.env, options.speechKeys?.()); json(res, 200, { coreIntegrated: true, voice: { mode: options.offline ? "offline-scripted" : "configured-provider", configured: options.offline || Boolean(speech.stt && speech.tts), stt: speech.stt?.provider ?? null, tts: speech.tts?.provider ?? null }, marketplace: "server-persistent", schema: 1 }); }
      else if (method === "GET" && path === "/api/aiking/v1/catalog") json(res, 200, catalog);
      else if (method === "GET" && path.startsWith("/api/aiking/v1/catalog/listings/")) { const listing = catalog.listings.find((listing) => listing.id === path.split("/").at(-1)); json(res, listing ? 200 : 404, listing ?? { error: "Unknown listing." }); }
      else if (path === "/api/aiking/marketplace/records") {
        if (method === "GET") json(res, 200, { records });
        else if (method === "POST") {
          let draft = structuredClone(records);
          const body = await readBody(req);
          if (body?.action === "add") {
            const parsed = recordSchema.safeParse(body.record);
            if (!parsed.success || !catalog.listings.some(listing => listing.id === parsed.data.listingId && listing.kind === parsed.data.kind)) { json(res, 400, { error: "Invalid install record." }); return true; }
            const old = draft.find(record => record.listingId === parsed.data.listingId);
            if (old) {
              const targets = [...new Set([...old.targets, ...parsed.data.targets])];
              if (targets.length > 100) { json(res, 409, { error: "Install target limit reached." }); return true; }
              old.targetVersions = { ...Object.fromEntries(old.targets.map(target => [target, old.targetVersions?.[target] ?? old.version])), ...Object.fromEntries(parsed.data.targets.map(target => [target, parsed.data.version])) };
              old.version = parsed.data.version; old.targets = targets; old.installedAt = parsed.data.installedAt;
            }
            else if (draft.length < 2000) draft.push({ ...parsed.data, targetVersions: Object.fromEntries(parsed.data.targets.map(target => [target, parsed.data.version])) });
            else { json(res, 409, { error: "Install record limit reached." }); return true; }
          } else if (body?.action === "remove" && typeof body.listingId === "string") {
            draft = draft.map(record => record.listingId === body.listingId && typeof body.target === "string" ? { ...record, targets: record.targets.filter(target => target !== body.target) } : record)
              .filter(record => record.listingId !== body.listingId || (typeof body.target === "string" && record.targets.length > 0));
          } else { json(res, 400, { error: "Invalid install operation." }); return true; }
          persist(draft); json(res, 200, { records });
        }
        else json(res, 405, { error: "Unsupported method." });
      } else if (method === "POST" && path === "/api/aiking/marketplace/skill-update") {
        const body = z.object({ listingId: z.string(), botId: z.string(), threadId: z.string(), baseSha256: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(await readBody(req));
        if (!body.success || !options.owns(body.data.botId, body.data.threadId)) { json(res, 403, { error: "This conversation does not belong to that agent." }); return true; }
        const listing = catalog.listings.find(listing => listing.id === body.data.listingId);
        if (!listing || listing.kind !== "skill") { json(res, 404, { error: "Unknown catalog skill." }); return true; }
        const result = updateCatalogSkill(body.data.botId, listing.skillName, listing.text, `aiking-marketplace:${listing.id}@${listing.version}`, body.data.baseSha256);
        json(res, "error" in result ? 409 : 200, result);
      } else if (method === "POST" && path === "/api/aiking/voice/ticket") {
        const body = ticketBody.safeParse(await readBody(req));
        if (!body.success || !options.owns(body.data.botId, body.data.threadId)) json(res, 403, { error: "This conversation does not belong to that agent." });
        else {
          for (const [key, ticket] of tickets) if (ticket.expires < Date.now()) tickets.delete(key);
          for (const [key, resume] of resumes) if (resume.expires < Date.now()) resumes.delete(key);
          if (tickets.size > 100) { json(res, 429, { error: "Too many voice connection requests." }); return true; }
          const ticket = randomBytes(32).toString("hex"); tickets.set(ticket, { ...body.data, owner: auth.kind === "session" ? auth.session.id : "loopback", origin: String(req.headers.origin ?? `http://${req.headers.host}`), expires: Date.now() + 30000 }); json(res, 200, { ticket, path: "/api/aiking/voice/sessions" });
        }
      } else json(res, 404, { error: "Unknown AIKING route." });
      return true;
    },
    attach(server: Server) {
      server.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!["/api/aiking/voice/sessions", "/v1/voice/sessions"].includes(url.pathname)) return;
        const key = url.searchParams.get("ticket") ?? ""; const ticket = tickets.get(key); tickets.delete(key);
        if (!ticket || ticket.expires < Date.now() || !options.isOwnerLive(ticket.owner) || String(req.headers.origin ?? "") !== ticket.origin) { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
        websocket.handleUpgrade(req, socket, head, (ws) => websocket.emit("connection", ws, req, ticket));
      });
      server.on("close", () => { for (const socket of owners.keys()) { cancellations.get(socket)?.(); socket.terminate(); } websocket.close(); });
    },
    revokeOwner(owner: string) { for (const [key, ticket] of tickets) if (ticket.owner === owner) tickets.delete(key); for (const [key, resume] of resumes) if (resume.owner === owner) resumes.delete(key); for (const [socket, id] of owners) if (id === owner) { cancellations.get(socket)?.(); socket.close(1008, "Session revoked"); } },
  };
}
