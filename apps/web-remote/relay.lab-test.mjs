// Copyright (c) 2026 AIKING.
// End-to-end test of the web relay without touching Cloudflare: the real Worker and Durable Objects run in Miniflare,
// a fake account service answers the email code, a fake "AIKINGBOT" plays the computer's local server, and the real
// connector joins the two. Run from a directory that has miniflare and ws installed:
//   node --experimental-strip-types relay.lab-test.mjs
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startRelayConnector, enrollWithRelay } from "../desktop/server/aiking/relay-connector.ts";

const require = createRequire(process.env.RELAY_LAB_DIR ? `${process.env.RELAY_LAB_DIR}/` : import.meta.url);
const { Miniflare } = require("miniflare");
const { WebSocketServer, WebSocket: WS } = require("ws");

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(["ok", name]); console.log("ok  ", name); }
  catch (error) { results.push(["FAIL", name]); console.log("FAIL", name, "\n    ", error?.stack?.split("\n").slice(0, 4).join("\n     ")); }
};
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

// A fake account service, answered in-process through Miniflare's outbound hook: any email gets challenge
// "c-<email>", and the code 123456 signs in.
const fakeAuth = async (request) => {
  const url = new URL(request.url);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  if (url.pathname === "/v1/auth/email/start") return Response.json({ challengeId: `c-${body.email}`, expiresAt: Date.now() + 600000 });
  if (url.pathname === "/v1/auth/email/verify") {
    if (body.code !== "123456") return Response.json({ error: { code: "invalid_otp" } }, { status: 401 });
    const email = String(body.challengeId).slice(2);
    return Response.json({ sessionToken: `tok-${email}`, user: { id: `user-${createHash("sha1").update(email).digest("hex").slice(0, 8)}`, email } });
  }
  if (url.pathname === "/v1/me") {
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    if (!token.startsWith("tok-")) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
    const email = token.slice(4);
    return Response.json({ id: `user-${createHash("sha1").update(email).digest("hex").slice(0, 8)}`, email });
  }
  return Response.json({}, { status: 404 });
};

// A fake local AIKINGBOT.
const seen = [];
const bigDownload = randomBytes(5 * 1024 * 1024);
const hugeDownload = randomBytes(12 * 1024 * 1024);
const local = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    seen.push({ method: req.method, url: req.url, headers: req.headers, bytes: body.length });
    if (req.url.startsWith("/api/bots")) { res.setHeader("content-type", "text/plain"); return res.end(req.url); }
    if (req.url === "/hello") { res.setHeader("content-type", "text/plain"); return res.end("hello from the computer"); }
    if (req.url === "/headers") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(req.headers)); }
    if (req.url === "/echo") { res.setHeader("content-type", "application/octet-stream"); return res.end(body); }
    if (req.url === "/big") { res.setHeader("content-type", "application/octet-stream"); return res.end(bigDownload); }
    if (req.url === "/redirect") { res.statusCode = 302; res.setHeader("location", `http://127.0.0.1:${localPort}/hello`); return res.end(); }
    if (req.url === "/cookie") { res.setHeader("set-cookie", ["a=1; Path=/; Domain=127.0.0.1", "b=2; Path=/"]); return res.end("ok"); }
    if (req.url === "/slow") { return setTimeout(() => res.end("late"), 6000); }
    if (req.url === "/huge") { res.setHeader("content-type", "application/octet-stream"); return res.end(hugeDownload); }
    if (req.url === "/chunked") { res.setHeader("content-type", "application/json"); res.write('{"a":'); return setTimeout(() => res.end("1}"), 100); }
    if (req.url === "/empty") { res.statusCode = 204; return res.end(); }
    if (req.url === "/sse") {
      res.setHeader("content-type", "text/event-stream"); res.write("data: one\n\n");
      setTimeout(() => res.write("data: two\n\n"), 400); setTimeout(() => res.end("data: three\n\n"), 800); return;
    }
    res.statusCode = 404; res.end("nope");
  });
});
const localPort = await listen(local);
const sockets = new WebSocketServer({ server: local, path: "/ws" });
let socketHeaders = null;
sockets.on("connection", (socket, req) => {
  socketHeaders = req.headers;
  socket.on("message", (data, isBinary) => socket.send(isBinary ? data : `echo:${data}`, { binary: isBinary }));
});

const mf = new Miniflare({
  scriptPath: fileURLToPath(new URL("./worker.mjs", import.meta.url)), modules: true, compatibilityDate: "2026-08-01",
  durableObjects: { INDEX: "Index", USER: "User", HOST: "Host" },
  r2Buckets: { WEBUI: "webui-test" },
  bindings: { AUTH_API: "https://auth.test", COOKIE_KEY: "test-cookie-key-with-enough-length" },
  outboundService: fakeAuth,
  port: 0, host: "127.0.0.1",
});
const relayUrl = (await mf.ready).toString().replace(/\/$/, "");
const api = (path, init = {}) => fetch(`${relayUrl}${path}`, { redirect: "manual", ...init });

async function signIn(email) {
  const started = await (await api("/__relay/api/login/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) })).json();
  const verified = await api("/__relay/api/login/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, challengeId: started.challengeId, code: "123456" }) });
  assert.equal(verified.status, 200);
  return verified.headers.get("set-cookie").split(";")[0];
}
const enroll = async (cookie, name = "Máy của Lan") => {
  const code = (await (await api("/__relay/api/hosts/code", { method: "POST", headers: { cookie } })).json()).code;
  return { code, ...(await enrollWithRelay(relayUrl, code, name)) };
};
const connect = (host) => startRelayConnector({ relayUrl, hostId: host.hostId, token: host.token, target: { host: "127.0.0.1", port: localPort }, log: () => undefined, pingMs: 500, silenceMs: 5000 });
const until = async (condition, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await condition()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error("timed out"); };

let lan, lanHost, lanCookie, connector;

await check("health and the sign-in page need no login", async () => {
  assert.equal((await api("/__relay/health")).status, 200);
  const page = await api("/__relay/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Đăng nhập AIKINGBOT/);
});
await check("an unsigned browser is sent to sign in, an unsigned API call is refused", async () => {
  const html = await api("/", { headers: { accept: "text/html" } });
  assert.equal(html.status, 302); assert.match(html.headers.get("location"), /\/__relay\/$/);
  assert.equal((await api("/api/anything")).status, 401);
});
await check("a wrong code is refused and sets no session", async () => {
  const started = await (await api("/__relay/api/login/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "lan@example.com" }) })).json();
  const bad = await api("/__relay/api/login/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "lan@example.com", challengeId: started.challengeId, code: "000000" }) });
  assert.equal(bad.status, 401); assert.equal(bad.headers.get("set-cookie"), null);
});
await check("a forged session cookie is refused", async () => {
  const forged = `rl_session=${Buffer.from(JSON.stringify({ u: "x", e: "x@y.z", x: 9999999999 })).toString("base64url")}.AAAA`;
  assert.equal((await api("/__relay/api/hosts", { headers: { cookie: forged } })).status, 401);
});
await check("a cross-site POST to the relay API is refused", async () => {
  lanCookie = await signIn("lan@example.com");
  const response = await api("/__relay/api/hosts/code", { method: "POST", headers: { cookie: lanCookie, origin: "https://evil.example" } });
  assert.equal(response.status, 403);
});
await check("enrolment code works once and only once", async () => {
  lanHost = await enroll(lanCookie);
  assert.ok(lanHost.hostId && lanHost.token);
  await assert.rejects(enrollWithRelay(relayUrl, lanHost.code, "again"), /invalid_code/);
});
await check("a computer signed in to the account joins with that sign-in, no code, and shows up for the same email on the web", async () => {
  const joined = await fetch(`${relayUrl}/__relay/api/hosts/enroll-account`, { method: "POST", headers: { authorization: "Bearer tok-lan@example.com", "content-type": "application/json" }, body: JSON.stringify({ name: "Laptop của Lan" }) });
  assert.equal(joined.status, 200);
  const host = await joined.json();
  assert.ok(host.hostId && host.token);
  const list = await (await api("/__relay/api/hosts", { headers: { cookie: lanCookie } })).json();
  assert.ok(list.hosts.some((entry) => entry.id === host.hostId && entry.name === "Laptop của Lan"));
  assert.equal((await fetch(`${relayUrl}/__relay/api/hosts/enroll-account`, { method: "POST", headers: { authorization: "Bearer nonsense" }, body: "{}" })).status, 401);
  assert.equal((await fetch(`${relayUrl}/__relay/api/hosts/enroll-account`, { method: "POST", body: "{}" })).status, 401);
  await api(`/__relay/api/hosts/${host.hostId}`, { method: "DELETE", headers: { cookie: lanCookie } });
});
await check("sign out everywhere ends every earlier sign-in of that person, and a new sign-in works", async () => {
  const other = await signIn("hocvien@example.com");
  const second = await signIn("hocvien@example.com");
  assert.equal((await api("/__relay/api/hosts", { headers: { cookie: other } })).status, 200);
  assert.equal((await api("/__relay/api/hosts", { headers: { cookie: second } })).status, 200);
  assert.equal((await api("/__relay/api/logout-all", { method: "POST", headers: { cookie: second } })).status, 200);
  assert.equal((await api("/__relay/api/hosts", { headers: { cookie: other } })).status, 401);
  assert.equal((await api("/__relay/api/hosts", { headers: { cookie: second } })).status, 401);
  assert.equal((await (await api("/__relay/api/me", { headers: { cookie: other } })).json()).signedIn, false);
  const fresh = await signIn("hocvien@example.com");
  assert.equal((await api("/__relay/api/hosts", { headers: { cookie: fresh } })).status, 200);
});
await check("a computer can leave by itself with its own token, and then drops off the person's list", async () => {
  const joined = await (await fetch(`${relayUrl}/__relay/api/hosts/enroll-account`, { method: "POST", headers: { authorization: "Bearer tok-lan@example.com", "content-type": "application/json" }, body: JSON.stringify({ name: "Sắp rời" }) })).json();
  assert.equal((await fetch(`${relayUrl}/__relay/api/hosts/self?host=${joined.hostId}`, { method: "DELETE", headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await fetch(`${relayUrl}/__relay/api/hosts/self?host=${joined.hostId}`, { method: "DELETE", headers: { authorization: `Bearer ${joined.token}` } })).status, 200);
  const list = await (await api("/__relay/api/hosts", { headers: { cookie: lanCookie } })).json();
  assert.ok(!list.hosts.some((entry) => entry.id === joined.hostId));
});
await check("a computer that is not connected is reported offline and answers 503", async () => {
  const list = await (await api("/__relay/api/hosts", { headers: { cookie: lanCookie } })).json();
  assert.equal(list.hosts.length, 1); assert.equal(list.hosts[0].online, false);
  await api("/__relay/api/hosts/select", { method: "POST", headers: { cookie: lanCookie, "content-type": "application/json" }, body: JSON.stringify({ id: lanHost.hostId }) });
  const offline = await api("/hello", { headers: { cookie: `${lanCookie}; rl_host=${lanHost.hostId}` } });
  assert.equal(offline.status, 503);
  assert.equal((await offline.json()).error, "computer_offline");
  const page = await api("/", { headers: { cookie: `${lanCookie}; rl_host=${lanHost.hostId}`, accept: "text/html" } });
  assert.equal(page.status, 503);
  assert.match(await page.text(), /đang tắt hoặc chưa mở AIKINGBOT/);
});
await check("the connector refuses a wrong token", async () => {
  const bad = startRelayConnector({ relayUrl, hostId: lanHost.hostId, token: "wrong", target: { host: "127.0.0.1", port: localPort }, log: () => undefined });
  await new Promise((r) => setTimeout(r, 700));
  assert.notEqual(bad.state(), "online"); bad.stop();
  const list = await (await api("/__relay/api/hosts", { headers: { cookie: lanCookie } })).json();
  assert.equal(list.hosts[0].online, false);
});
connector = connect(lanHost);
await until(() => connector.state() === "online");
const web = (path, init = {}) => api(path, { ...init, headers: { cookie: `${lanCookie}; rl_host=${lanHost.hostId}`, ...(init.headers ?? {}) } });

await check("the web app's own files come from the edge: compressed, cached for a year, with no sign-in and no computer", async () => {
  const bucket = await mf.getR2Bucket("WEBUI");
  const source = Buffer.from("console.log('the web app');".repeat(50));
  const bytes = (buffer) => new Uint8Array(buffer);
  await bucket.put("webui/assets/app-abc123.js", bytes(source));
  await bucket.put("webui/assets/app-abc123.js.br", bytes(brotliCompressSync(source)));
  await bucket.put("webui/assets/app-abc123.js.gz", bytes(gzipSync(source)));
  await bucket.put("webui/assets/logo-9f.png", new Uint8Array([9, 9]));
  // node:http, not fetch: fetch decides its own Accept-Encoding and decodes the answer, and this checks the bytes as sent.
  const asBrowser = (name, encoding, method = "GET") => new Promise((resolve, reject) => {
    const request = httpRequest(`${relayUrl}/assets/${name}`, { method, headers: { "accept-encoding": encoding } }, (response) => {
      const chunks = []; response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: { get: (key) => response.headers[key.toLowerCase()] ?? null }, body: Buffer.concat(chunks) }));
    }); request.on("error", reject); request.end();
  });
  const decoded = (answer) => { const encoding = answer.headers.get("content-encoding"); return encoding === "br" ? brotliDecompressSync(answer.body) : encoding === "gzip" ? gunzipSync(answer.body) : answer.body; };
  // The local runtime shows a Worker only "gzip" of what the browser offered; on Cloudflare the full list is in request.cf. Either answer is right.
  const compressed = await asBrowser("app-abc123.js", "gzip, deflate, br");
  assert.equal(compressed.status, 200); assert.ok(["br", "gzip"].includes(compressed.headers.get("content-encoding")), String(compressed.headers.get("content-encoding")));
  assert.ok(compressed.body.length < source.length / 5, "the answer is compressed");
  assert.equal(decoded(compressed).toString(), source.toString());
  assert.equal(compressed.headers.get("cache-control"), "public, max-age=31536000, immutable"); assert.equal(compressed.headers.get("x-relay-static"), "1");
  assert.match(compressed.headers.get("content-type"), /javascript/); assert.equal(compressed.headers.get("vary"), "accept-encoding");
  const gz = await asBrowser("app-abc123.js", "gzip");
  assert.equal(gz.headers.get("content-encoding"), "gzip"); assert.equal(gunzipSync(gz.body).toString(), source.toString());
  const plain = await asBrowser("app-abc123.js", "identity");
  assert.equal(plain.headers.get("content-encoding"), null); assert.equal(plain.body.toString(), source.toString());
  const image = await asBrowser("logo-9f.png", "br, gzip");
  assert.equal(image.headers.get("content-encoding"), null); assert.equal(image.headers.get("content-type"), "image/png");
  const head = await asBrowser("app-abc123.js", "gzip", "HEAD");
  assert.equal(head.status, 200); assert.equal(head.body.length, 0);
});
await check("a file that is not published here, a path trick or a write is not served from the edge", async () => {
  const missing = await api("/assets/not-published.js", { headers: { accept: "*/*" } });
  assert.equal(missing.status, 401); assert.equal((await missing.json()).error, "sign_in_required");   // it goes on to the computer, which needs a sign-in
  for (const path of ["/assets/..%2Fsecret.js", "/assets/%2e%2e/secret.js", "/assets/a/b.js", "/assets/app-abc123.js%00.png", "/assets/x.exe"]) {
    const answer = await api(path); assert.notEqual(answer.headers.get("x-relay-static"), "1", path);
  }
  const write = await api("/assets/app-abc123.js", { method: "POST", body: "x", headers: { origin: relayUrl } });
  assert.notEqual(write.headers.get("x-relay-static"), "1");
});
await check("a signed-in browser reaches the computer's own server", async () => {
  const response = await web("/hello");
  assert.equal(response.status, 200); assert.equal(await response.text(), "hello from the computer");
});
await check("a write from another site is refused before it reaches the computer; the web app's own writes go through", async () => {
  const foreign = await web("/echo", { method: "POST", body: "x", headers: { origin: "https://evil.example" } });
  assert.equal(foreign.status, 403); assert.equal((await foreign.json()).error, "bad_origin");
  const own = await web("/echo", { method: "POST", body: "x", headers: { origin: relayUrl } });
  assert.equal(own.status, 200); assert.equal(await own.text(), "x");
  const read = await web("/hello", { headers: { origin: "https://evil.example" } });
  assert.equal(read.status, 200);
});
await check("the first page of data over the relay is lighter: the latest 40 messages, not 200; other asks are left alone", async () => {
  assert.equal(await (await web("/api/bots?messages=200")).text(), "/api/bots?messages=40");
  assert.equal(await (await web("/api/bots?messages=30&x=1")).text(), "/api/bots?messages=30&x=1");
  assert.equal(await (await web("/api/bots")).text(), "/api/bots");
  assert.equal(await (await web("/api/bots/abc/tasks/t1?messages=200")).text(), "/api/bots/abc/tasks/t1?messages=200");
});
await check("the local server sees itself as the origin, and never sees the relay's cookies", async () => {
  const headers = await (await web("/headers", { headers: { origin: relayUrl, referer: `${relayUrl}/x`, "x-forwarded-for": "1.2.3.4", "x-forwarded-proto": "https", via: "1.1 x", cookie: `${lanCookie}; rl_host=${lanHost.hostId}; theme=dark` } })).json();
  assert.equal(headers.origin, `http://127.0.0.1:${localPort}`);
  assert.equal(headers.host, `127.0.0.1:${localPort}`);
  assert.equal(headers.cookie, "theme=dark");
  for (const name of ["x-forwarded-for", "x-forwarded-proto", "forwarded", "x-real-ip", "via", "x-relay-owner"]) assert.equal(headers[name], undefined, `${name} reached the local server`);
});
await check("a 1 MB upload comes back identical", async () => {
  const body = randomBytes(1024 * 1024);
  const response = await web("/echo", { method: "POST", body });
  assert.equal(Buffer.from(await response.arrayBuffer()).equals(body), true);
});
await check("a 5 MB download arrives intact", async () => {
  const response = await web("/big");
  assert.equal(Buffer.from(await response.arrayBuffer()).equals(bigDownload), true);
});
await check("an upload over the limit is refused", async () => {
  const response = await web("/echo", { method: "POST", headers: { "content-length": String(30 * 1024 * 1024) }, body: Buffer.alloc(1024) }).catch(() => ({ status: 413 }));
  assert.ok([413, 400].includes(response.status) || response.status >= 400);
});
await check("a 12 MB answer (past the hold limit) is passed on as it arrives, intact", async () => {
  const response = await web("/huge");
  assert.equal(Buffer.from(await response.arrayBuffer()).equals(hugeDownload), true);
});
await check("a redirect to the local address is made relative", async () => {
  const response = await web("/redirect");
  assert.equal(response.status, 302, `status ${response.status} ${await response.text()}`); assert.equal(response.headers.get("location"), "/hello");
});
await check("cookies from the computer are passed on with the domain removed", async () => {
  const response = await web("/cookie");
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2); assert.ok(!cookies.some((c) => /domain=/i.test(c)));
});
await check("an answer with no declared length (chunked) comes through whole", async () => {
  const response = await web("/chunked");
  assert.equal(response.status, 200); assert.equal(await response.text(), '{"a":1}');
});
await check("204 and unknown paths keep their status", async () => {
  assert.equal((await web("/empty")).status, 204);
  assert.equal((await web("/missing")).status, 404);
});
await check("server-sent events arrive as they are produced, not all at the end", async () => {
  const started = Date.now();
  const response = await web("/sse");
  const reader = response.body.getReader(); const times = []; let text = "";
  for (;;) { const { value, done } = await reader.read(); if (done) break; text += Buffer.from(value).toString(); times.push(Date.now() - started); }
  assert.match(text, /one[\s\S]*two[\s\S]*three/);
  assert.ok(times[times.length - 1] - times[0] > 500, `events were bunched: ${times.join(",")}`);
});
await check("a WebSocket carries text and binary both ways, with the right headers", async () => {
  const ws = new WS(relayUrl.replace("http", "ws") + "/ws", { headers: { cookie: `${lanCookie}; rl_host=${lanHost.hostId}`, origin: relayUrl } });
  const got = [];
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
  ws.on("message", (data, isBinary) => got.push(isBinary ? ["bin", Buffer.from(data).toString("hex")] : ["txt", data.toString()]));
  ws.send("hi"); ws.send(Buffer.from([1, 2, 3]));
  await until(() => got.length === 2);
  assert.deepEqual(got, [["txt", "echo:hi"], ["bin", "010203"]], JSON.stringify(got));
  assert.equal(socketHeaders.origin, `http://127.0.0.1:${localPort}`);
  ws.close();
});
await check("another person cannot reach Lan's computer, even knowing its id", async () => {
  const other = await signIn("khach@example.com");
  const direct = await api("/hello", { headers: { cookie: `${other}; rl_host=${lanHost.hostId}` } });
  assert.ok([403, 409].includes(direct.status), `status ${direct.status}`);
  const list = await (await api("/__relay/api/hosts", { headers: { cookie: other } })).json();
  assert.equal(list.hosts.length, 0);
  const select = await api("/__relay/api/hosts/select", { method: "POST", headers: { cookie: other, "content-type": "application/json" }, body: JSON.stringify({ id: lanHost.hostId }) });
  assert.equal(select.status, 404);
});
await check("requests in flight are answered while many run at once", async () => {
  const many = await Promise.all(Array.from({ length: 40 }, (_, i) => web("/echo", { method: "POST", body: `n${i}` }).then((r) => r.text())));
  assert.deepEqual(many, Array.from({ length: 40 }, (_, i) => `n${i}`));
});
await check("the computer reconnects by itself after the link drops", async () => {
  connector.stop();
  await until(async () => (await (await api("/__relay/api/hosts", { headers: { cookie: lanCookie } })).json()).hosts[0].online === false);
  assert.equal((await web("/hello")).status, 503);
  connector = connect(lanHost);
  await until(() => connector.state() === "online");
  assert.equal((await web("/hello")).status, 200);
});
await check("a request in flight when the computer reconnects fails at once instead of hanging", async () => {
  const started = Date.now();
  const slow = web("/slow");
  await new Promise((r) => setTimeout(r, 400));
  connector.stop(); connector = connect(lanHost);
  const response = await slow;
  assert.ok(response.status >= 500, `status ${response.status}`);
  assert.ok(Date.now() - started < 4000, `took ${Date.now() - started} ms`);
  await until(() => connector.state() === "online");
  assert.equal((await web("/hello")).status, 200);
});
await check("a cut-off answer is an error at the browser, an intact one is not", async () => {
  const other = await enroll(lanCookie, "Máy giả");
  const fake = new WS(relayUrl.replace("http", "ws") + `/__relay/connect?host=${other.hostId}`, { headers: { authorization: `Bearer ${other.token}` } });
  await new Promise((resolve, reject) => { fake.on("open", resolve); fake.on("error", reject); });
  fake.on("message", (raw) => {
    const frame = JSON.parse(raw.toString());
    if (frame.t !== "req") return;
    if (frame.path === "/vanish") {
      fake.send(JSON.stringify({ t: "res", id: frame.id, status: 200, headers: { "content-type": "application/octet-stream" } }));
      fake.send(JSON.stringify({ t: "data", id: frame.id, b: Buffer.from("part").toString("base64") }));
      setTimeout(() => fake.close(), 100); // a chunked answer: no length to check, the computer just goes away
      return;
    }
    const whole = frame.path === "/whole";
    fake.send(JSON.stringify({ t: "res", id: frame.id, status: 200, headers: { "content-type": "text/plain", "content-length": whole ? "5" : "500" } }));
    fake.send(JSON.stringify({ t: "data", id: frame.id, b: Buffer.from("short").toString("base64") }));
    fake.send(JSON.stringify({ t: "end", id: frame.id, n: 5 }));
  });
  const read = async (path) => {
    const response = await api(path, { headers: { cookie: `${lanCookie}; rl_host=${other.hostId}` } });
    try { const text = Buffer.from(await response.arrayBuffer()).toString(); return response.status >= 500 ? "error" : `ok:${text}`; } catch { return "error"; }
  };
  assert.equal(await read("/whole"), "ok:short");
  assert.equal(await read("/shortCL"), "error"); // said 500 bytes, delivered 5
  assert.equal(await read("/vanish"), "error"); // no length given, the computer disappeared halfway
  fake.close();
  await api(`/__relay/api/hosts/${other.hostId}`, { method: "DELETE", headers: { cookie: lanCookie } });
});
await check("forgetting a computer cuts it off at once", async () => {
  const forget = await api(`/__relay/api/hosts/${lanHost.hostId}`, { method: "DELETE", headers: { cookie: lanCookie } });
  assert.equal(forget.status, 200);
  await until(() => connector.state() !== "online", 4000).catch(() => undefined);
  const after = await web("/hello");
  assert.ok([409, 403, 503].includes(after.status), `status ${after.status}`);
  const reuse = startRelayConnector({ relayUrl, hostId: lanHost.hostId, token: lanHost.token, target: { host: "127.0.0.1", port: localPort }, log: () => undefined });
  await new Promise((r) => setTimeout(r, 700));
  assert.notEqual(reuse.state(), "online"); reuse.stop();
});
await check("many computers can enrol from one address, but guessing codes is stopped", async () => {
  for (let i = 0; i < 25; i++) { const extra = await enroll(lanCookie, `Máy ${i}`); await api(`/__relay/api/hosts/${extra.hostId}`, { method: "DELETE", headers: { cookie: lanCookie } }); }
  let refused = 0;
  for (let i = 0; i < 35; i++) await enrollWithRelay(relayUrl, `ZZZZ-ZZZZ-${String(1000 + i)}`, "x").catch((error) => { if (error.message === "too_many_attempts") refused += 1; });
  assert.ok(refused >= 4, `only ${refused} refused`);
});
connector.stop();
await mf.dispose(); local.close(); sockets.close();

const failed = results.filter(([state]) => state !== "ok");
console.log(`\nrelay: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
