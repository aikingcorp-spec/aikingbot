// Copyright (c) 2026 AIKING.
// AIKINGBOT web relay. A person signs in on this site with their email (a one-time code checked by the AIKING account
// service), picks one of their computers, and the site passes their browser's requests to the AIKINGBOT running on that
// computer. The computer connects OUT to this relay, so it needs no open port. Nothing a person does is stored here:
// requests and answers are passed through, and only the list of computers and their sign-in state are kept.
//
//   /__relay/*          this site's own pages and API (sign in, computers, enrolment)
//   /__relay/connect    the computer's WebSocket (bearer token issued when it was enrolled)
//   everything else     passed to the signed-in person's chosen computer
//
// Frames between the relay and a computer are JSON text:
//   relay -> computer   req {id,method,path,headers} · body {id,b} (base64) · bend {id} · cancel {id}
//                       wopen {id,path,headers,protocols} · wmsg {id,text|b} · wclose {id,code}
//   computer -> relay   res {id,status,headers} · data {id,b} · end {id} · err {id,message}
//                       wopened {id,protocol} · werr {id,message} · wmsg {id,text|b} · wclose {id,code}

const SESSION_COOKIE = "rl_session";
const HOST_COOKIE = "rl_host";
const SESSION_SECONDS = 30 * 24 * 3600;
const CODE_SECONDS = 10 * 60;
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const CHUNK_BYTES = 192 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
// An answer up to this size is held until it has arrived whole and been checked, so a connection that breaks halfway shows the
// browser an error instead of a short answer it would keep (and cache) as if it were complete. Event streams and larger answers
// are passed on as they arrive.
const BUFFER_LIMIT = 8 * 1024 * 1024;
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length"]);
const encoder = new TextEncoder();

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const fail = (status, error, extra = {}) => json({ error, ...extra }, status);
const offline = () => json({ error: "computer_offline" }, 503, { "x-relay-offline": "1", "retry-after": "5" });

// ---------- small crypto helpers ----------
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const unb64u = (text) => Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
const toB64 = (bytes) => { let out = ""; for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(out); };
const fromB64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const randomToken = (bytes = 32) => b64u(crypto.getRandomValues(new Uint8Array(bytes)));
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hmacKey(secret) { return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
async function signSession(env, payload) {
  const body = b64u(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env.COOKIE_KEY), encoder.encode(body));
  return `${body}.${b64u(signature)}`;
}
async function readSession(env, request) {
  const raw = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  if (!raw || !env.COOKIE_KEY) return null;
  const [body, signature] = raw.split(".");
  if (!body || !signature) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env.COOKIE_KEY), unb64u(signature), encoder.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(unb64u(body)));
    return typeof payload.u === "string" && typeof payload.e === "string" && payload.x > Date.now() / 1000 ? payload : null;
  } catch { return null; }
}
function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(/;\s*/)) { const i = part.indexOf("="); if (i > 0) out[part.slice(0, i)] = part.slice(i + 1); }
  return out;
}
const cookie = (name, value, seconds) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;

// ---------- the account service ----------
async function authCall(env, path, body) {
  let response;
  try {
    // On Cloudflare a Worker cannot fetch another Worker of the same account over workers.dev; a service binding reaches it.
    const init = { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), redirect: "manual" };
    response = await (env.AUTH ? env.AUTH.fetch(`${env.AUTH_API}${path}`, init) : fetch(`${env.AUTH_API}${path}`, init));
  } catch { return { ok: false, status: 502, error: "account_service_unreachable" }; }
  if (response.status >= 300 && response.status < 400) return { ok: false, status: 502, error: "account_service_unreachable" };
  const payload = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, status: response.status, error: typeof payload?.error?.code === "string" ? payload.error.code : `http_${response.status}`, retryAfter: response.headers.get("retry-after") };
  return { ok: true, payload };
}
const normalizeEmail = (value) => (typeof value === "string" && /^[^\s@]{1,64}@[^\s@]{1,255}$/.test(value.trim()) ? value.trim().toLowerCase() : "");

// ---------- the Worker ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__relay/health") return json({ service: "aikingbot-relay", status: "ready" });
    if (url.pathname === "/__relay/connect") return connectHost(request, env, url);
    if (url.pathname === "/__relay/api/hosts/redeem" && request.method === "POST") return stub(env.INDEX, "index").fetch(new Request("https://do/redeem", { method: "POST", headers: { "content-type": "application/json", "x-ip": request.headers.get("cf-connecting-ip") ?? "" }, body: await request.text() }));
    if (url.pathname === "/__relay/api/hosts/enroll-account" && request.method === "POST") return enrollByAccount(request, env);
    if (url.pathname === "/__relay/api/hosts/self" && request.method === "DELETE") {
      const hostId = url.searchParams.get("host") ?? "";
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(hostId)) return fail(400, "invalid_host");
      return stub(env.HOST, hostId).fetch(new Request("https://do/forget-self", { method: "POST", headers: { "x-host-token": (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") } }));
    }
    if (url.pathname.startsWith("/__relay/")) return relayPages(request, env, url);

    // Everything else belongs to the person's chosen computer.
    const session = await readSession(env, request);
    if (!session) return request.method === "GET" && acceptsHtml(request) ? Response.redirect(`${url.origin}/__relay/`, 302) : fail(401, "sign_in_required");
    const state = await userState(env, session);
    if (!state) return request.method === "GET" && acceptsHtml(request) ? Response.redirect(`${url.origin}/__relay/`, 302) : fail(401, "sign_in_required");
    const hosts = state.hosts;
    const wanted = parseCookies(request.headers.get("cookie"))[HOST_COOKIE];
    const host = hosts.find((entry) => entry.id === wanted) ?? (hosts.length === 1 ? hosts[0] : null);
    if (!host) return request.method === "GET" && acceptsHtml(request) ? Response.redirect(`${url.origin}/__relay/`, 302) : fail(409, "choose_a_computer");
    const headers = new Headers(request.headers);
    headers.set("x-relay-owner", session.u);
    const answer = await stub(env.HOST, host.id).fetch(new Request(`https://do/proxy${url.pathname}${url.search}`, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body, duplex: "half", redirect: "manual" }));
    if (answer.headers.get("x-relay-offline") && request.method === "GET" && acceptsHtml(request)) {
      return new Response(OFFLINE_PAGE.replace("{{name}}", escapeHtml(host.name)), { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "5" } });
    }
    return answer;
  },
};
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
const acceptsHtml = (request) => (request.headers.get("accept") ?? "").includes("text/html");
const sidOf = (socket) => { try { return socket.deserializeAttachment()?.sid ?? ""; } catch { return ""; } };
const stub = (namespace, name) => namespace.get(namespace.idFromName(name));
const userStub = (env, session) => stub(env.USER, `u:${session.u}`);
/** The person's computers, or null when this sign-in was ended ("sign out everywhere" raises the epoch the cookie was made under). */
async function userState(env, session) {
  const response = await userStub(env, session).fetch("https://do/hosts");
  if (!response.ok) return { hosts: [] };
  const state = await response.json();
  return (session.a ?? 0) === (state.epoch ?? 0) ? state : null;
}
async function userHosts(env, session) { return (await userState(env, session))?.hosts ?? []; }

/** A computer whose app is already signed in to the AIKING account joins the relay with that sign-in: no second code. */
async function enrollByAccount(request, env) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token.length > 512) return fail(401, "invalid_account");
  let me;
  try {
    const init = { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, redirect: "manual" };
    me = await (env.AUTH ? env.AUTH.fetch(`${env.AUTH_API}/v1/me`, init) : fetch(`${env.AUTH_API}/v1/me`, init));
  } catch { return fail(502, "account_service_unreachable"); }
  if (me.status === 401) return fail(401, "invalid_account");
  const user = me.ok ? await me.json().catch(() => null) : null;
  if (typeof user?.id !== "string" || !normalizeEmail(user.email)) return fail(502, "account_service_unreachable");
  const body = await request.json().catch(() => ({}));
  await stub(env.USER, `u:${user.id}`).fetch(new Request("https://do/init", { method: "POST", body: JSON.stringify({ uid: user.id, email: normalizeEmail(user.email) }) }));
  return stub(env.INDEX, "index").fetch(new Request("https://do/enroll-user", { method: "POST", body: JSON.stringify({ uid: user.id, name: body.name }) }));
}

async function connectHost(request, env, url) {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return fail(426, "websocket_required");
  const hostId = url.searchParams.get("host") ?? "";
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(hostId) || !token) return fail(401, "invalid_host");
  const headers = new Headers({ upgrade: "websocket", "x-host-token": token });
  return stub(env.HOST, hostId).fetch(new Request("https://do/connect", { headers }));
}

// ---------- the pages and API a person uses ----------
async function relayPages(request, env, url) {
  const path = url.pathname.replace(/^\/__relay/, "") || "/";
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && request.method !== "HEAD" && origin && origin !== url.origin) return fail(403, "bad_origin");
  const session = await readSession(env, request);
  if (path === "/" || path === "/index.html") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  if (path === "/api/me") {
    const live = session && (await userState(env, session));
    return json(live ? { signedIn: true, email: session.e } : { signedIn: false });
  }
  if (path === "/api/login/start" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!email) return fail(400, "invalid_email");
    const result = await authCall(env, "/v1/auth/email/start", { email });
    if (!result.ok) return fail(result.status === 429 ? 429 : 502, result.error, result.retryAfter ? { retryAfter: Number(result.retryAfter) } : {});
    return json({ challengeId: String(result.payload.challengeId ?? "") });
  }
  if (path === "/api/login/verify" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const code = String(body.code ?? "").replace(/\s+/g, "");
    if (!email || !/^[A-Za-z0-9-]{4,16}$/.test(code) || typeof body.challengeId !== "string" || body.challengeId.length > 128) return fail(400, "invalid_request");
    const result = await authCall(env, "/v1/auth/email/verify", { challengeId: body.challengeId, code });
    if (!result.ok) return fail(result.status === 429 ? 429 : result.status === 401 || result.status === 400 ? 401 : 502, result.error);
    const user = result.payload?.user;
    if (typeof user?.id !== "string" || normalizeEmail(user.email) !== email) return fail(502, "invalid_response");
    const init = await (await stub(env.USER, `u:${user.id}`).fetch(new Request("https://do/init", { method: "POST", body: JSON.stringify({ uid: user.id, email }) }))).json().catch(() => ({}));
    const value = await signSession(env, { u: user.id, e: email, a: init.epoch ?? 0, x: Math.floor(Date.now() / 1000) + SESSION_SECONDS });
    const out = json({ ok: true });
    out.headers.append("set-cookie", cookie(SESSION_COOKIE, value, SESSION_SECONDS));
    // Readable by the page (not HttpOnly): the web app asks only for a name, because the email is already proven.
    out.headers.append("set-cookie", `rl_email=${encodeURIComponent(email)}; Path=/; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`);
    return out;
  }
  if (!session || !(await userState(env, session))) return fail(401, "sign_in_required");
  if (path === "/api/logout-all" && request.method === "POST") {
    await userStub(env, session).fetch(new Request("https://do/revoke-sessions", { method: "POST" }));
    const out = json({ ok: true });
    out.headers.append("set-cookie", cookie(SESSION_COOKIE, "", 0));
    out.headers.append("set-cookie", cookie(HOST_COOKIE, "", 0));
    out.headers.append("set-cookie", "rl_email=; Path=/; Secure; SameSite=Lax; Max-Age=0");
    return out;
  }
  if (path === "/api/logout" && request.method === "POST") {
    const out = json({ ok: true });
    out.headers.append("set-cookie", cookie(SESSION_COOKIE, "", 0));
    out.headers.append("set-cookie", cookie(HOST_COOKIE, "", 0));
    out.headers.append("set-cookie", "rl_email=; Path=/; Secure; SameSite=Lax; Max-Age=0");
    return out;
  }
  if (path === "/api/hosts" && request.method === "GET") {
    const hosts = await userHosts(env, session);
    const withState = await Promise.all(hosts.map(async (host) => {
      const state = await stub(env.HOST, host.id).fetch("https://do/status").then((response) => response.json()).catch(() => ({ online: false }));
      return { id: host.id, name: host.name, createdAt: host.createdAt, online: Boolean(state.online) };
    }));
    return json({ hosts: withState });
  }
  if (path === "/api/hosts/code" && request.method === "POST") {
    const response = await stub(env.INDEX, "index").fetch(new Request("https://do/code", { method: "POST", body: JSON.stringify({ uid: session.u }) }));
    return response;
  }
  if (path === "/api/hosts/select" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const hosts = await userHosts(env, session);
    if (!hosts.some((host) => host.id === body.id)) return fail(404, "unknown_computer");
    return json({ ok: true }, 200, { "set-cookie": cookie(HOST_COOKIE, body.id, SESSION_SECONDS) });
  }
  const forget = /^\/api\/hosts\/([A-Za-z0-9_-]{8,64})$/.exec(path);
  if (forget && request.method === "DELETE") {
    const response = await userStub(env, session).fetch(new Request(`https://do/hosts/${forget[1]}`, { method: "DELETE" }));
    if (response.ok) await stub(env.HOST, forget[1]).fetch("https://do/revoke", { method: "POST" }).catch(() => undefined);
    return response;
  }
  return fail(404, "not_found");
}

// ---------- Durable Object: global index (enrolment codes) ----------
export class Index {
  constructor(state, env) { this.state = state; this.env = env; }
  async createHost(uid, rawName) {
    const name = String(rawName ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) || "My computer";
    const hostId = randomToken(12);
    const token = randomToken(32);
    const tokenHash = await sha256Hex(token);
    const room = await this.env.HOST.get(this.env.HOST.idFromName(hostId)).fetch(new Request("https://do/init", { method: "POST", body: JSON.stringify({ ownerUid: uid, tokenHash, name }) }));
    if (!room.ok) return fail(500, "enrol_failed");
    const added = await this.env.USER.get(this.env.USER.idFromName(`u:${uid}`)).fetch(new Request("https://do/hosts", { method: "POST", body: JSON.stringify({ id: hostId, name }) }));
    if (!added.ok) { await this.env.HOST.get(this.env.HOST.idFromName(hostId)).fetch("https://do/revoke", { method: "POST" }); return added.status === 409 ? added : fail(500, "enrol_failed"); }
    return json({ hostId, token, name });
  }
  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    if (url.pathname === "/code") {
      const { uid } = await request.json();
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const raw = [...crypto.getRandomValues(new Uint8Array(12))].map((byte) => alphabet[byte % alphabet.length]).join("");
      const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
      await this.state.storage.put(`code:${code}`, { uid, exp: now + CODE_SECONDS * 1000 });
      return json({ code, expiresInSeconds: CODE_SECONDS });
    }
    if (url.pathname === "/redeem") {
      // Only wrong codes count against an address: a whole classroom behind one address must be able to enrol its computers.
      const ip = request.headers.get("x-ip") || "unknown";
      const key = `miss:${ip}:${Math.floor(now / 600_000)}`;
      const misses = (await this.state.storage.get(key)) ?? 0;
      if (misses >= 30) return fail(429, "too_many_attempts");
      const body = await request.json().catch(() => ({}));
      const code = String(body.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})(.{4})$/, "$1-$2-$3");
      const entry = await this.state.storage.get(`code:${code}`);
      await this.state.storage.delete(`code:${code}`); // single use, even when it has expired
      if (!entry || entry.exp < now) { await this.state.storage.put(key, misses + 1); return fail(404, "invalid_code"); }
      return this.createHost(entry.uid, body.name);
    }
    if (url.pathname === "/enroll-user") {
      const { uid, name } = await request.json();
      const key = `acct:${uid}:${Math.floor(now / 600_000)}`;
      const made = ((await this.state.storage.get(key)) ?? 0) + 1;
      await this.state.storage.put(key, made);
      if (made > 10) return fail(429, "too_many_attempts");
      return this.createHost(uid, name);
    }
    return fail(404, "not_found");
  }
}

// ---------- Durable Object: one person's list of computers ----------
export class User {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/init" && request.method === "POST") {
      const { uid, email } = await request.json();
      await this.state.storage.put({ uid, email });
      return json({ ok: true, epoch: (await this.state.storage.get("epoch")) ?? 0 });
    }
    if (url.pathname === "/revoke-sessions" && request.method === "POST") {
      const epoch = ((await this.state.storage.get("epoch")) ?? 0) + 1;
      await this.state.storage.put("epoch", epoch);
      return json({ ok: true, epoch });
    }
    const hosts = (await this.state.storage.get("hosts")) ?? [];
    if (url.pathname === "/hosts" && request.method === "GET") return json({ hosts, epoch: (await this.state.storage.get("epoch")) ?? 0 });
    if (url.pathname === "/hosts" && request.method === "POST") {
      const { id, name } = await request.json();
      if (hosts.length >= 20) return fail(409, "too_many_computers");
      await this.state.storage.put("hosts", [...hosts, { id, name, createdAt: Date.now() }]);
      return json({ ok: true });
    }
    const one = /^\/hosts\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (one && request.method === "DELETE") {
      await this.state.storage.put("hosts", hosts.filter((host) => host.id !== one[1]));
      return json({ ok: true });
    }
    return fail(404, "not_found");
  }
}

// ---------- Durable Object: one computer ----------
export class Host {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.pending = new Map(); // request id -> { resolve, reject, writer, timer }
    this.browserSockets = new Map(); // websocket id -> server-side socket
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }
  hostSocket() { return this.state.getWebSockets("host")[0] ?? null; }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/init") {
      await this.state.storage.put(await request.json());
      return json({ ok: true });
    }
    if (url.pathname === "/revoke") {
      await this.state.storage.deleteAll();
      for (const socket of this.state.getWebSockets()) try { socket.close(1008, "revoked"); } catch { /* closed */ }
      return json({ ok: true });
    }
    if (url.pathname === "/status") return json({ online: Boolean(this.hostSocket()) });
    if (url.pathname === "/forget-self") {
      // The computer itself leaves (its owner turned remote access off): it proves who it is with its own token.
      const config = await this.state.storage.get(["tokenHash", "ownerUid"]);
      const presented = await sha256Hex(request.headers.get("x-host-token") ?? "");
      if (!config.get("tokenHash") || !timingSafeEqual(config.get("tokenHash"), presented)) return fail(401, "invalid_host");
      await this.env.USER.get(this.env.USER.idFromName(`u:${config.get("ownerUid")}`)).fetch(new Request(`https://do/hosts/${this.state.id.name}`, { method: "DELETE" })).catch(() => undefined);
      await this.state.storage.deleteAll();
      for (const socket of this.state.getWebSockets()) try { socket.close(1000, "left"); } catch { /* closed */ }
      return json({ ok: true });
    }
    if (url.pathname === "/connect") return this.accept(request);
    if (url.pathname.startsWith("/proxy/")) return this.proxy(request, url);
    return fail(404, "not_found");
  }

  async accept(request) {
    const config = await this.state.storage.get(["tokenHash", "ownerUid"]);
    const tokenHash = config.get("tokenHash");
    const presented = await sha256Hex(request.headers.get("x-host-token") ?? "");
    if (!tokenHash || !timingSafeEqual(tokenHash, presented)) return fail(401, "invalid_host");
    for (const old of this.state.getWebSockets("host")) try { old.close(1000, "replaced"); } catch { /* closed */ }
    const pair = new WebSocketPair();
    pair[1].serializeAttachment({ sid: randomToken(8) }); // sockets are compared by this id, not by object identity
    this.state.acceptWebSocket(pair[1], ["host"]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async proxy(request, url) {
    const owner = await this.state.storage.get("ownerUid");
    if (!owner || request.headers.get("x-relay-owner") !== owner) return fail(403, "not_your_computer");
    const host = this.hostSocket();
    if (!host) return offline();
    const path = url.pathname.slice("/proxy".length) + url.search;
    const headers = {};
    for (const [name, value] of request.headers) if (!HOP_BY_HOP.has(name) && !/^(x-relay-|cf-|x-forwarded-|forwarded$|x-real-ip$|via$)/.test(name) && name !== "cookie") headers[name] = value;
    const cookies = (request.headers.get("cookie") ?? "").split(/;\s*/).filter((part) => !part.startsWith(`${SESSION_COOKIE}=`) && !part.startsWith(`${HOST_COOKIE}=`) && !part.startsWith("rl_email=")).join("; ");
    if (cookies) headers.cookie = cookies;
    const id = randomToken(9);
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return this.proxySocket(host, id, path, headers, request);

    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) return fail(413, "body_too_large");
    // The body is a stream the answer's frames are put into. If the computer goes away mid-answer the stream is errored, which
    // makes the browser's connection fail, rather than being closed, which would look like a complete (but short) answer.
    let controller;
    const readable = new ReadableStream({ start(c) { controller = c; } });
    const entry = {
      write: (bytes) => { try { controller.enqueue(bytes); } catch { /* browser went away */ } },
      close: () => { try { controller.close(); } catch { /* already ended */ } },
      abort: (error) => { try { controller.error(error); } catch { /* already ended */ } },
      headersReady: null, timer: null, done: false, sid: sidOf(host), received: 0,
    };
    const responded = new Promise((resolve, reject) => { entry.headersReady = { resolve, reject }; });
    const arm = () => { clearTimeout(entry.timer); entry.timer = setTimeout(() => this.finish(id, new Error("timeout")), REQUEST_TIMEOUT_MS); };
    entry.arm = arm; arm();
    this.pending.set(id, entry);
    try { host.send(JSON.stringify({ t: "req", id, method: request.method, path, headers })); } catch { this.pending.delete(id); return offline(); }
    void this.pump(host, id, request);
    try {
      const head = await responded;
      const out = new Headers();
      for (const [name, value] of Object.entries(head.headers ?? {})) {
        // A known length is kept: with it a connection that dies mid-answer is an error at the browser, not a silent cut-off.
        if (HOP_BY_HOP.has(name.toLowerCase()) && name.toLowerCase() !== "content-length") continue;
        if (name.toLowerCase() === "location") out.set("location", String(value).replace(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i, ""));
        else if (name.toLowerCase() === "set-cookie") for (const one of [].concat(value)) out.append("set-cookie", one.replace(/;\s*Domain=[^;]*/i, ""));
        else out.set(name, [].concat(value).join(", "));
      }
      return new Response(head.status === 204 || head.status === 304 ? null : head.body ?? readable, { status: head.status, headers: out });
    } catch (error) {
      this.pending.delete(id);
      return fail(error?.message === "timeout" ? 504 : 502, error?.message === "timeout" ? "computer_timeout" : "computer_error");
    }
  }

  async pump(host, id, request) {
    if (!request.body) { try { host.send(JSON.stringify({ t: "bend", id })); } catch { /* closed */ } return; }
    let total = 0;
    try {
      const reader = request.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_BODY_BYTES) { host.send(JSON.stringify({ t: "cancel", id })); this.finish(id, new Error("too_large")); return; }
        for (let i = 0; i < value.length; i += CHUNK_BYTES) host.send(JSON.stringify({ t: "body", id, b: toB64(value.subarray(i, i + CHUNK_BYTES)) }));
        this.pending.get(id)?.arm?.();
      }
      host.send(JSON.stringify({ t: "bend", id }));
    } catch { /* the browser went away; the answer side cleans up */ }
  }

  finish(id, error) {
    const entry = this.pending.get(id);
    if (!entry || entry.done) return;
    entry.done = true;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    if (error) { entry.headersReady.reject(error); entry.abort(error); }
    else entry.close();
    if (error) { const host = this.hostSocket(); try { host?.send(JSON.stringify({ t: "cancel", id })); } catch { /* closed */ } }
  }

  proxySocket(host, id, path, headers, request) {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    server.binaryType = "arraybuffer"; // newer compatibility dates default to Blob, which cannot be read synchronously
    this.browserSockets.set(id, { server, opened: false, sid: sidOf(host) });
    const protocols = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
    try { host.send(JSON.stringify({ t: "wopen", id, path, headers, protocols })); } catch { return offline(); }
    server.addEventListener("message", async (event) => {
      const target = this.hostSocket();
      if (!target) return server.close(1011, "computer_offline");
      try {
        if (typeof event.data === "string") target.send(JSON.stringify({ t: "wmsg", id, text: event.data }));
        else target.send(JSON.stringify({ t: "wmsg", id, b: toB64(new Uint8Array(event.data instanceof Blob ? await event.data.arrayBuffer() : event.data)) }));
      } catch { server.close(1011, "computer_offline"); }
    });
    server.addEventListener("close", (event) => {
      this.browserSockets.delete(id);
      try { this.hostSocket()?.send(JSON.stringify({ t: "wclose", id, code: event.code })); } catch { /* closed */ }
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Frames from the computer.
  webSocketMessage(socket, message) {
    if (typeof message !== "string") return;
    let frame;
    try { frame = JSON.parse(message); } catch { return; }
    const id = frame.id;
    const entry = this.pending.get(id);
    switch (frame.t) {
      case "res": {
        if (!entry) break;
        const headers = frame.headers ?? {};
        const declared = headers["content-length"];
        const length = declared === undefined ? Number.NaN : Number([].concat(declared)[0]);
        const status = Number(frame.status) || 502;
        const held = !(Number.isFinite(length) && length > BUFFER_LIMIT) && !/event-stream/i.test(String(headers["content-type"] ?? "")) && status !== 204 && status !== 304;
        if (held) entry.held = { status, headers, length, chunks: [] };
        else entry.headersReady.resolve({ status, headers });
        entry.arm();
        break;
      }
      case "data": if (entry) { const bytes = fromB64(String(frame.b ?? "")); entry.received += bytes.length;
        if (entry.held) {
          entry.held.chunks.push(bytes);
          if (entry.received > BUFFER_LIMIT) { // bigger than expected: stop holding and let it through as it comes
            const { status, headers, chunks } = entry.held; entry.held = null;
            entry.headersReady.resolve({ status, headers });
            for (const chunk of chunks) entry.write(chunk);
          }
        } else entry.write(bytes);
        entry.arm(); } break;
      // The end frame says how many bytes were sent: a short or long answer is cut off as an error, never passed on as complete.
      case "end": {
        if (!entry) break;
        if (typeof frame.n === "number" && frame.n !== entry.received) { this.finish(id, new Error("truncated")); break; }
        if (entry.held) {
          const { status, headers, length, chunks } = entry.held;
          if (Number.isFinite(length) && entry.received !== length) { this.finish(id, new Error("truncated")); break; }
          const body = new Uint8Array(entry.received); let at = 0;
          for (const chunk of chunks) { body.set(chunk, at); at += chunk.length; }
          entry.held = null;
          entry.headersReady.resolve({ status, headers, body });
        }
        this.finish(id);
        break;
      }
      case "err": this.finish(id, new Error(String(frame.message ?? "error"))); break;
      case "wopened": { const peer = this.browserSockets.get(id); if (peer) peer.opened = true; break; }
      case "werr": { const peer = this.browserSockets.get(id); if (peer) { try { peer.server.close(1011, "computer_error"); } catch { /* closed */ } this.browserSockets.delete(id); } break; }
      case "wmsg": {
        const peer = this.browserSockets.get(id);
        if (!peer) break;
        try { if (typeof frame.text === "string") peer.server.send(frame.text); else if (typeof frame.b === "string") peer.server.send(fromB64(frame.b)); } catch { /* closed */ }
        break;
      }
      case "wclose": { const peer = this.browserSockets.get(id); if (peer) { try { peer.server.close(frame.code >= 1000 && frame.code < 5000 && frame.code !== 1005 && frame.code !== 1006 ? frame.code : 1000); } catch { /* closed */ } this.browserSockets.delete(id); } break; }
      default: break;
    }
  }
  webSocketClose(socket) { this.dropFor(socket); }
  webSocketError(socket) { this.dropFor(socket); }
  /** Everything that was riding on a computer's socket ends with it; a reconnected computer never answers its predecessor's calls. */
  dropFor(socket) {
    const sid = sidOf(socket);
    for (const [id, entry] of [...this.pending]) if (entry.sid === sid) this.finish(id, new Error("computer_disconnected"));
    for (const [id, peer] of [...this.browserSockets]) if (peer.sid === sid) { try { peer.server.close(1011, "computer_disconnected"); } catch { /* closed */ } this.browserSockets.delete(id); }
  }
}

// ---------- the pages ----------
const OFFLINE_PAGE = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><title>AIKINGBOT</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#161616;color:#f2f2f2;font:16px/1.5 system-ui,sans-serif}main{width:min(460px,92vw)}h1{font-size:24px;margin:0 0 8px}p{color:#9a9a9a}a{color:#3ddc97}</style></head>
<body><main><h1>Máy “{{name}}” đang tắt hoặc chưa mở AIKINGBOT</h1><p>Chat và tệp của bạn nằm trên máy đó, nên cần mở AIKINGBOT trên máy ấy (và để máy không ngủ). Trang này tự thử lại sau vài giây.</p><p><a href="/__relay/">Chọn máy khác</a></p></main></body></html>`;


const PAGE = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AIKINGBOT</title>
<style>
:root{color-scheme:dark;--bg:#161616;--card:#222;--ink:#f2f2f2;--dim:#9a9a9a;--line:#333;--accent:#3ddc97}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
main{width:min(460px,92vw);padding:28px 0}h1{font-size:26px;margin:0 0 6px}p{color:var(--dim);margin:4px 0 16px}
input,button{width:100%;font:inherit;border-radius:10px;border:1px solid var(--line);padding:12px 14px;background:var(--card);color:var(--ink)}
button{background:var(--accent);color:#0b2a1c;border:0;font-weight:600;cursor:pointer;margin-top:10px}button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
button:disabled{opacity:.5}.row{display:flex;gap:10px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:8px 0}
.row b{flex:1}.dot{width:9px;height:9px;border-radius:50%;background:#777}.dot.on{background:var(--accent)}.err{color:#ff8a80;min-height:1.4em}.code{font:700 26px/1.2 ui-monospace,monospace;letter-spacing:.08em;text-align:center;background:var(--card);border:1px dashed var(--line);border-radius:12px;padding:16px;margin:10px 0}
small{color:var(--dim)}
</style></head><body><main id="app"></main>
<script>
const $=(s)=>document.querySelector(s),app=$("#app");
const api=async(p,o={})=>{const r=await fetch("/__relay/api"+p,{method:o.method||"GET",headers:o.body?{"content-type":"application/json"}:{},body:o.body?JSON.stringify(o.body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(j.error||"error"),{status:r.status,data:j});return j};
const msg={invalid_email:"Email chưa đúng.",invalid_request:"Mã chưa đúng định dạng.",account_service_unreachable:"Chưa kết nối được dịch vụ tài khoản. Thử lại sau ít phút.",too_many_attempts:"Thử quá nhiều lần. Đợi một lúc rồi thử lại.",invalid_code:"Mã không đúng hoặc đã hết hạn."};
const say=(e)=>msg[e.message]||(e.status===429?(e.data&&e.data.retryAfter?"Mã vừa được gửi rồi. Đợi "+e.data.retryAfter+" giây rồi thử lại.":"Bạn thử quá nhanh. Đợi một chút rồi thử lại."):e.status===401?"Mã không đúng hoặc đã hết hạn.":"Có lỗi, thử lại giúp mình.");
const esc=(s)=>String(s).replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let email="",challengeId="";
function login(){app.innerHTML='<h1>Đăng nhập AIKINGBOT</h1><p>Nhập email, mình sẽ gửi một mã dùng một lần.</p><input id="e" type="email" placeholder="ban@example.com" autocomplete="email"><button id="go">Gửi mã</button><p class="err" id="err"></p>';
 $("#go").onclick=async()=>{$("#go").disabled=true;$("#err").textContent="";try{email=$("#e").value.trim();const r=await api("/login/start",{method:"POST",body:{email}});challengeId=r.challengeId;codeStep()}catch(e){$("#err").textContent=say(e);$("#go").disabled=false}}}
function codeStep(){app.innerHTML='<h1>Nhập mã</h1><p>Mã đã gửi tới '+esc(email)+'.</p><input id="c" inputmode="numeric" autocomplete="one-time-code" placeholder="Mã"><button id="go">Đăng nhập</button><button class="ghost" id="back">Đổi email</button><p class="err" id="err"></p>';
 $("#back").onclick=login;$("#go").onclick=async()=>{$("#go").disabled=true;$("#err").textContent="";try{await api("/login/verify",{method:"POST",body:{email,challengeId,code:$("#c").value}});hosts()}catch(e){$("#err").textContent=say(e);$("#go").disabled=false}}}
async function hosts(){const r=await api("/hosts");const list=r.hosts.map((h)=>'<div class="row"><span class="dot '+(h.online?"on":"")+'"></span><b>'+esc(h.name)+'</b><button style="width:auto;margin:0" data-id="'+esc(h.id)+'" '+(h.online?"":"disabled")+'>'+(h.online?"Mở":"Đang tắt")+'</button></div>').join("");
 app.innerHTML='<h1>Máy của bạn</h1><p>Chat và tệp nằm trên máy bạn, trang này chỉ là cổng vào.</p>'+(list||'<p>Chưa có máy nào. Cài AIKINGBOT trên máy của bạn, đăng nhập bằng đúng email này, rồi bật <b>Truy cập từ xa</b> trong Cài đặt. Máy sẽ hiện ở đây. (Hoặc dùng mã bên dưới.)</p>')+'<button class="ghost" id="add">Thêm máy mới</button><button class="ghost" id="out">Đăng xuất</button><button class="ghost" id="outall">Đăng xuất mọi thiết bị</button><div id="box"></div>';
 app.querySelectorAll("button[data-id]").forEach((b)=>b.onclick=async()=>{await api("/hosts/select",{method:"POST",body:{id:b.dataset.id}});location.href="/"});
 $("#add").onclick=async()=>{const c=await api("/hosts/code",{method:"POST"});$("#box").innerHTML='<p>Trên máy cần kết nối, mở AIKINGBOT → Cài đặt → Tài khoản → Dùng trên web, rồi nhập mã này trong 10 phút:</p><div class="code">'+c.code+'</div>'};
 $("#out").onclick=async()=>{await api("/logout",{method:"POST"});login()};
 $("#outall").onclick=async()=>{if(confirm("Đăng xuất tài khoản này khỏi mọi trình duyệt và điện thoại?")){await api("/logout-all",{method:"POST"});login()}};
 if(r.hosts.some((h)=>h.online)){setTimeout(()=>{if(document.visibilityState==="visible")hosts().catch(()=>{})},15000)}}
api("/me").then((m)=>m.signedIn?hosts():login()).catch(login);
</script></body></html>`;
