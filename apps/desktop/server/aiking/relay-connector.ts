// Copyright (c) 2026 AIKING.
// Connects this computer OUT to the AIKINGBOT web relay so its owner can use it from a browser. The relay passes the
// browser's requests here as frames; this module replays them against the server on this machine (loopback only) and
// sends the answers back. Nothing is opened to the network and nothing is stored by the relay.
import { request as httpRequest, type IncomingMessage, type ClientRequest } from "node:http";

export type RelayState = "off" | "connecting" | "online";
export type RelayConnectorOptions = {
  relayUrl: string;
  hostId: string;
  token: string;
  target: { host: string; port: number };
  log?: (message: string) => void;
  /** Injected for tests. */
  webSocket?: typeof WebSocket;
  /** Added to every replayed request and socket, so the server can tell relayed requests from local ones. */
  markHeader?: { name: string; value: string };
  pingMs?: number;
  silenceMs?: number;
};
export type RelayConnector = { stop(): void; state(): RelayState };

const MAX_REQUESTS = 200;
const MAX_SOCKETS = 50;
const CHUNK_BYTES = 192 * 1024;
const BACKPRESSURE_BYTES = 4 * 1024 * 1024;
const SAFE_PATH = /^\/(?!\/)[^\r\n\u0000]*$/;
// The server treats a request carrying these as one that came through a proxy and refuses it local trust. The relay has already
// authenticated the person, so the request is replayed as the local one it is.
const PROXY_HEADERS = /^(x-forwarded-|forwarded$|x-real-ip$|via$|cf-|x-relay-)/;
const FORWARD_SOCKET_HEADERS = new Set(["cookie", "user-agent", "accept-language", "authorization", "x-forwarded-for"]);

type Frame = { t: string; id?: string; [key: string]: unknown };

export function startRelayConnector(options: RelayConnectorOptions): RelayConnector {
  const WS = options.webSocket ?? WebSocket;
  const log = options.log ?? (() => undefined);
  const origin = `http://${options.target.host}:${options.target.port}`;
  const relay = new URL(options.relayUrl);
  relay.protocol = relay.protocol === "http:" ? "ws:" : "wss:";
  relay.pathname = "/__relay/connect";
  relay.search = `?host=${encodeURIComponent(options.hostId)}`;

  let socket: WebSocket | null = null;
  let state: RelayState = "connecting";
  let stopped = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let lastHeard = Date.now();
  const requests = new Map<string, ClientRequest>();
  const sockets = new Map<string, WebSocket>();

  const send = (frame: Frame) => { try { if (socket?.readyState === 1) socket.send(JSON.stringify(frame)); } catch { /* the relay went away; the reconnect handles it */ } };
  const rewriteOrigin = (value: string) => value.replace(/^https?:\/\/[^/]+/i, origin);

  function reset() {
    for (const outgoing of requests.values()) outgoing.destroy();
    requests.clear();
    for (const peer of sockets.values()) { try { peer.close(); } catch { /* closed */ } }
    sockets.clear();
  }

  function connect() {
    if (stopped) return;
    state = "connecting";
    let opened = false;
    const current = new WS(relay.toString(), { headers: { authorization: `Bearer ${options.token}` } } as never) as WebSocket;
    socket = current;
    current.onopen = () => {
      opened = true; attempt = 0; state = "online"; lastHeard = Date.now();
      log("relay connected");
      clearInterval(ping);
      ping = setInterval(() => {
        if (Date.now() - lastHeard > (options.silenceMs ?? 70_000)) { try { current.close(); } catch { /* closed */ } return; }
        try { current.send("ping"); } catch { /* closing */ }
      }, options.pingMs ?? 20_000);
    };
    current.onmessage = (event: MessageEvent) => {
      lastHeard = Date.now();
      if (typeof event.data !== "string" || event.data === "pong") return;
      let frame: Frame;
      try { frame = JSON.parse(event.data) as Frame; } catch { return; }
      handle(frame);
    };
    const gone = () => {
      if (socket === current) socket = null;
      clearInterval(ping);
      reset();
      if (stopped) { state = "off"; return; }
      state = "connecting";
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5)) * (0.7 + Math.random() * 0.6);
      attempt += 1;
      if (opened) log("relay disconnected; reconnecting");
      retry = setTimeout(connect, delay);
    };
    current.onclose = gone;
    current.onerror = () => { /* onclose follows */ };
  }

  function handle(frame: Frame) {
    const id = typeof frame.id === "string" ? frame.id : "";
    switch (frame.t) {
      case "req": return openRequest(id, frame);
      case "body": { const outgoing = requests.get(id); if (outgoing && typeof frame.b === "string") outgoing.write(Buffer.from(frame.b, "base64")); return; }
      case "bend": requests.get(id)?.end(); return;
      case "cancel": { requests.get(id)?.destroy(); requests.delete(id); return; }
      case "wopen": return openSocket(id, frame);
      case "wmsg": {
        const peer = sockets.get(id);
        if (!peer || peer.readyState !== 1) return;
        try { peer.send(typeof frame.text === "string" ? frame.text : Buffer.from(String(frame.b ?? ""), "base64")); } catch { /* closing */ }
        return;
      }
      case "wclose": { const peer = sockets.get(id); sockets.delete(id); try { peer?.close(typeof frame.code === "number" && frame.code >= 1000 && frame.code < 5000 && frame.code !== 1005 && frame.code !== 1006 ? frame.code : 1000); } catch { /* closed */ } return; }
      default: return;
    }
  }

  function openRequest(id: string, frame: Frame) {
    const path = String(frame.path ?? "");
    const method = String(frame.method ?? "GET").toUpperCase();
    if (!id || requests.size >= MAX_REQUESTS || !SAFE_PATH.test(path) || !/^[A-Z]{3,10}$/.test(method)) return send({ t: "err", id, message: "refused" });
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries((frame.headers ?? {}) as Record<string, unknown>)) {
      if (typeof value !== "string" || /[\r\n]/.test(name + value)) continue;
      const lower = name.toLowerCase();
      if (lower === "origin" || lower === "referer") headers[lower] = rewriteOrigin(value);
      else if (PROXY_HEADERS.test(lower)) continue;
      else if (!["host", "connection", "content-length"].includes(lower)) headers[lower] = value;
    }
    headers.host = `${options.target.host}:${options.target.port}`;
    if (options.markHeader) headers[options.markHeader.name] = options.markHeader.value;
    const outgoing = httpRequest({ host: options.target.host, port: options.target.port, method, path, headers }, (response: IncomingMessage) => {
      const answer: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) answer[name] = value;
      send({ t: "res", id, status: response.statusCode ?? 502, headers: answer });
      let sent = 0;
      response.on("data", (chunk: Buffer) => {
        sent += chunk.length;
        for (let i = 0; i < chunk.length; i += CHUNK_BYTES) send({ t: "data", id, b: chunk.subarray(i, i + CHUNK_BYTES).toString("base64") });
        if (socket && socket.bufferedAmount > BACKPRESSURE_BYTES) {
          response.pause();
          const timer = setInterval(() => { if (!socket || socket.bufferedAmount < BACKPRESSURE_BYTES / 2) { clearInterval(timer); response.resume(); } }, 50);
        }
      });
      response.on("end", () => { requests.delete(id); send({ t: "end", id, n: sent }); });
      response.on("error", () => { requests.delete(id); send({ t: "err", id, message: "response_error" }); });
    });
    outgoing.on("error", (error) => { requests.delete(id); send({ t: "err", id, message: (error as NodeJS.ErrnoException).code ?? "request_error" }); });
    requests.set(id, outgoing);
  }

  function openSocket(id: string, frame: Frame) {
    const path = String(frame.path ?? "");
    if (!id || sockets.size >= MAX_SOCKETS || !SAFE_PATH.test(path)) return send({ t: "werr", id, message: "refused" });
    const headers: Record<string, string> = { origin };
    for (const [name, value] of Object.entries((frame.headers ?? {}) as Record<string, unknown>)) {
      if (typeof value === "string" && !/[\r\n]/.test(value) && FORWARD_SOCKET_HEADERS.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
    }
    if (options.markHeader) headers[options.markHeader.name] = options.markHeader.value;
    const protocols = Array.isArray(frame.protocols) ? (frame.protocols as unknown[]).filter((value): value is string => typeof value === "string" && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value)) : [];
    let peer: WebSocket;
    try { peer = new WS(`ws://${options.target.host}:${options.target.port}${path}`, { protocols, headers } as never) as WebSocket; }
    catch { return send({ t: "werr", id, message: "refused" }); }
    peer.binaryType = "arraybuffer";
    sockets.set(id, peer);
    peer.onopen = () => send({ t: "wopened", id, protocol: peer.protocol });
    peer.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string") send({ t: "wmsg", id, text: event.data });
      else send({ t: "wmsg", id, b: Buffer.from(event.data as ArrayBuffer).toString("base64") });
    };
    peer.onerror = () => { if (sockets.delete(id)) send({ t: "werr", id, message: "socket_error" }); };
    peer.onclose = (event: CloseEvent) => { if (sockets.delete(id)) send({ t: "wclose", id, code: event.code }); };
  }

  connect();
  return {
    state: () => state,
    stop() {
      stopped = true; state = "off";
      clearTimeout(retry); clearInterval(ping);
      reset();
      try { socket?.close(); } catch { /* closed */ }
    },
  };
}

/** Exchanges the one-time code from the web page for this computer's relay credentials. */
export async function enrollWithRelay(relayUrl: string, code: string, name: string, fetchImpl: typeof fetch = fetch): Promise<{ hostId: string; token: string; name: string }> {
  const response = await fetchImpl(new URL("/__relay/api/hosts/redeem", relayUrl), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }),
    redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as { hostId?: unknown; token?: unknown; name?: unknown; error?: unknown } | null;
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `http_${response.status}`);
  if (typeof payload?.hostId !== "string" || typeof payload.token !== "string") throw new Error("invalid_response");
  return { hostId: payload.hostId, token: payload.token, name: typeof payload.name === "string" ? payload.name : name };
}

/** Joins the relay with the account this computer is already signed in to: no code to type, no second sign-in. */
export async function enrollWithAccount(relayUrl: string, accountToken: string, name: string, fetchImpl: typeof fetch = fetch): Promise<{ hostId: string; token: string; name: string }> {
  const response = await fetchImpl(new URL("/__relay/api/hosts/enroll-account", relayUrl), {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` }, body: JSON.stringify({ name }),
    redirect: "manual", signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as { hostId?: unknown; token?: unknown; name?: unknown; error?: unknown } | null;
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `http_${response.status}`);
  if (typeof payload?.hostId !== "string" || typeof payload.token !== "string") throw new Error("invalid_response");
  return { hostId: payload.hostId, token: payload.token, name: typeof payload.name === "string" ? payload.name : name };
}

/** Tells the relay this computer is leaving (remote access turned off), so it drops off the person's list. Best effort. */
export async function leaveRelay(relayUrl: string, hostId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(new URL(`/__relay/api/hosts/self?host=${encodeURIComponent(hostId)}`, relayUrl), { method: "DELETE", headers: { authorization: `Bearer ${token}` }, redirect: "manual", signal: AbortSignal.timeout(8_000) });
    return response.ok;
  } catch { return false; }
}
