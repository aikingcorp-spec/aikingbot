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

async function fixture(existing?: string) {
  const dataDir = existing ?? mkdtempSync(join(tmpdir(), "aiking-services-"));
  let closed = false;
  const live = new Set(["owner-a", "owner-b"]); let cancelled = false;
  const services = createAikingServices({ dataDir, offline: true, isOwnerLive: owner => live.has(owner), owns: (bot, thread) => bot === "bot" && thread === "thread",
    reply: async (_bot, _thread, _text, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => { cancelled = true; reject(signal.reason); }, { once: true })) });
  const auth = (req: IncomingMessage): RequestAuth => ({ kind: "session", via: "bearer", scopes: req.headers["x-client"] ? ["client"] : ["admin"], session: { id: String(req.headers["x-owner"] || "owner-a") } as SessionRecord });
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    void services.handle({ req, res, url, path: url.pathname, method: req.method!, auth: auth(req), json, readBody }).catch(() => json(res, 500, { error: "Fixture failed" }));
  });
  services.attach(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No port");
  const origin = `http://127.0.0.1:${address.port}`;
  const api = (path: string, body?: object, headers = {}) => fetch(origin + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", origin, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const ticket = async (owner = "owner-a") => (await (await api("/api/aiking/voice/ticket", { botId: "bot", threadId: "thread" }, { "x-owner": owner })).json()).ticket;
  const connect = async (key: string) => { const socket = new WebSocket(origin.replace("http", "ws") + "/api/aiking/voice/sessions?ticket=" + key, { origin }); await once(socket, "open"); return socket; };
  return { dataDir, live, services, api, ticket, connect, origin, cancelled: () => cancelled,
    close: async (keep = false) => { if (closed) return; closed = true; services.revokeOwner("owner-a"); services.revokeOwner("owner-b"); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); if (!keep) rmSync(dataDir, { recursive: true, force: true }); } };
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
      try { expect((await (await reopened.api("/api/aiking/marketplace/records")).json()).records[0]).toEqual(record); } finally { await reopened.close(); }
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
});
