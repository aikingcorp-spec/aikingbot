// Copyright (c) 2026 AIKING.
// The real server with the AIKINGBOT Auth API: an email code proves an address; only membership opens the workspace.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { AccountDirectory, normalizeLinkCode } from "./account-workspaces.ts";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(SERVER_DIR, "..");
const PORT = 31000 + Math.floor(Math.random() * 4000);
const HOST = "workspace.aiking.test";
const ORIGIN = `https://${HOST}`;
const CODE = "ABCD-EFGH";

let home: string;
let child: ChildProcess;
let authApi: Server;
let stderr = "";
let environmentId = "";

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; body: any }
type Jar = Map<string, string>;

function call(path: string, init: { method?: string; body?: unknown; jar?: Jar; headers?: Record<string, string>; from?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
    const cookie = init.jar && init.jar.size ? [...init.jar].map(([name, value]) => `${name}=${value}`).join("; ") : undefined;
    const req = httpRequest({
      agent: false, hostname: "127.0.0.1", port: PORT, path, method: init.method ?? (payload ? "POST" : "GET"),
      headers: {
        host: HOST, "x-forwarded-for": init.from ?? "203.0.113.20", "x-forwarded-proto": "https",
        ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)), origin: ORIGIN } : {}),
        ...(cookie ? { cookie } : {}),
        ...init.headers,
      },
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        let body: unknown = raw;
        try { body = JSON.parse(raw); } catch { /* not JSON */ }
        if (init.jar) {
          const set = res.headers["set-cookie"] ?? [];
          for (const line of Array.isArray(set) ? set : [set]) {
            const [pair] = line.split(";");
            const eq = pair!.indexOf("=");
            const name = pair!.slice(0, eq);
            const value = pair!.slice(eq + 1);
            if (!value || /Max-Age=0/.test(line)) init.jar.delete(name); else init.jar.set(name, value);
          }
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function signIn(email: string, from = "203.0.113.20"): Promise<{ jar: Jar; reply: Reply }> {
  const jar: Jar = new Map();
  expect((await call("/api/auth/email/start", { body: { email }, from })).status).toBe(200);
  const reply = await call("/api/auth/email/verify", { body: { email, code: CODE, label: "Test browser" }, jar, from });
  expect(reply.status).toBe(200);
  return { jar, reply };
}

const workspaceCookie = (jar: Jar) => [...jar.keys()].find((name) => name.startsWith("aiking_session_"));
const accountCookie = (jar: Jar) => [...jar.keys()].find((name) => name.startsWith("aikingbot_account_"));

beforeAll(async () => {
  const challenges = new Map<string, string>();
  const read = (req: IncomingMessage) => new Promise<any>((resolve) => { let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => resolve(raw ? JSON.parse(raw) : null)); });
  authApi = createServer(async (req, res) => {
    const body = await read(req);
    const send = (status: number, value: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    if (req.url === "/v1/auth/email/start") {
      const id = `challenge-${challenges.size + 1}`;
      challenges.set(id, body.email);
      return send(200, { challengeId: id, expiresAt: Date.now() + 600_000 });
    }
    if (req.url === "/v1/auth/email/verify") {
      const email = challenges.get(body.challengeId);
      if (!email || body.code !== CODE) return send(400, { error: { code: "invalid_sign_in_code" } });
      return send(200, { sessionToken: `auth-${email}`, user: { id: `user-${email}`, email } });
    }
    if (req.url === "/v1/auth/logout") { res.writeHead(204); res.end(); return; }
    send(404, { error: { code: "not_found" } });
  });
  await new Promise<void>((resolve) => authApi.listen(0, "127.0.0.1", resolve));
  home = mkdtempSync(join(tmpdir(), "aiking-account-workspaces-"));
  const staticDir = join(home, "static");
  mkdirSync(join(home, ".aikingbot"), { recursive: true });
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Served UI</title>");
  writeFileSync(join(home, ".aikingbot", "config.json"), JSON.stringify({ signIn: { admins: [], members: ["member@example.test"] } }));
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home,
      AIKING_PORT: String(PORT), AIKING_WEBHOOK_PORT: String(PORT + 1),
      AIKING_STATIC_DIR: staticDir, AIKING_PUBLIC_URL: ORIGIN, AIKING_ENVIRONMENT_LABEL: "AIKING Corp staging",
      AIKING_BROWSER_CONNECTION: join(home, "browser-test-connection.json"),
      AIKING_ACCOUNT_API_URL: `http://127.0.0.1:${(authApi.address() as AddressInfo).port}`,
      AIKING_WORKSPACE_OWNERS: "owner@aiking.test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/.well-known/aikingbot/environment`);
      if (res.ok) { environmentId = ((await res.json()) as { environmentId: string }).environmentId; return; }
    } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start:\n${stderr}`);
}, 45_000);

afterAll(async () => {
  if (child && child.exitCode !== null) console.error(`server exited early:\n${stderr}`);
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  await new Promise((resolve) => authApi?.close(resolve));
  if (home) await removeTempDir(home);
});

describe("account vs workspace on a hosted server", () => {
  it("lets a new address sign in, but gives it only an account session and an empty workspace list", async () => {
    const { jar, reply } = await signIn("newcomer@example.test");
    expect(reply.body).toEqual({ account: { email: "newcomer@example.test" }, workspace: false });
    expect(workspaceCookie(jar)).toBeUndefined();
    expect(accountCookie(jar)).toBeDefined();
    const account = await call("/api/account/session", { jar });
    expect(account.status).toBe(200);
    expect(account.body).toMatchObject({ account: { email: "newcomer@example.test" }, workspaces: [], devices: [] });
  });

  it("keeps every workspace route closed to that account, by cookie or as a bearer token", async () => {
    const { jar } = await signIn("intruder@example.test", "203.0.113.21");
    const token = jar.get(accountCookie(jar)!)!;
    for (const [method, path] of [["GET", "/api/auth/session"], ["GET", "/api/bots"], ["GET", "/api/config"], ["GET", "/api/events"], ["GET", "/api/people"], ["POST", "/api/bots"], ["POST", "/api/auth/pairing"]] as const) {
      const viaCookie = await call(path, { method, jar, ...(method === "POST" ? { body: {} } : {}) });
      expect([401, 403], `${method} ${path} by cookie`).toContain(viaCookie.status);
      const viaBearer = await call(path, { method, headers: { authorization: `Bearer ${token}` }, ...(method === "POST" ? { body: {} } : {}) });
      expect([401, 403], `${method} ${path} as bearer`).toContain(viaBearer.status);
    }
    // A forged cookie with the workspace's name holding the account token is just an unknown session.
    const forged: Jar = new Map([[`aiking_session_${PORT}_${environmentId.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`, token]]);
    expect([401, 403]).toContain((await call("/api/bots", { jar: forged })).status);
    const enter = await call(`/api/account/workspaces/${environmentId}/enter`, { jar, body: {} });
    expect(enter.status).toBe(403);
    expect(workspaceCookie(jar)).toBeUndefined();
  });

  it("opens the workspace for its owner and members, with their roles", async () => {
    const owner = await signIn("owner@aiking.test", "203.0.113.22");
    expect(owner.reply.body.workspace).toBe(true);
    const session = await call("/api/auth/session", { jar: owner.jar });
    expect(session.status).toBe(200);
    expect(session.body.scopes).toEqual(["admin", "client"]);
    expect((await call("/api/bots", { jar: owner.jar })).status).toBe(200);
    expect((await call("/api/account/session", { jar: owner.jar })).body.workspaces).toEqual([{ id: environmentId, name: "AIKING Corp staging", role: "owner", current: true }]);
    const member = await signIn("member@example.test", "203.0.113.23");
    expect((await call("/api/auth/session", { jar: member.jar })).body.scopes).toEqual(["client"]);
    expect((await call("/api/account/session", { jar: member.jar })).body.workspaces[0].role).toBe("member");
  });

  it("signs out of both sessions from the workspace, and a reload cannot regain either", async () => {
    const { jar } = await signIn("owner@aiking.test", "203.0.113.24");
    const before = new Map(jar);
    expect((await call("/api/auth/logout", { jar, body: {} })).status).toBe(200);
    expect([401, 403]).toContain((await call("/api/auth/session", { jar: before })).status);
    expect((await call("/api/account/session", { jar: before })).status).toBe(401);
  });

  it("signs out of both sessions from the account shell", async () => {
    const { jar } = await signIn("owner@aiking.test", "203.0.113.25");
    const before = new Map(jar);
    expect((await call("/api/account/logout", { jar, body: {} })).status).toBe(200);
    expect([401, 403]).toContain((await call("/api/auth/session", { jar: before })).status);
    expect((await call("/api/account/session", { jar: before })).status).toBe(401);
  });

  it("restores a member's workspace session from the account session while membership holds", async () => {
    const { jar } = await signIn("owner@aiking.test", "203.0.113.26");
    jar.delete(workspaceCookie(jar)!);
    expect([401, 403]).toContain((await call("/api/auth/session", { jar })).status);
    const entered = await call(`/api/account/workspaces/${environmentId}/enter`, { jar, body: { label: "Restored" } });
    expect(entered.status).toBe(200);
    expect((await call("/api/auth/session", { jar })).body).toMatchObject({ kind: "session", label: "Restored", scopes: ["admin", "client"] });
  });

  it("switching accounts in one browser ends the previous account's workspace session", async () => {
    const { jar } = await signIn("owner@aiking.test", "203.0.113.27");
    const ownerJar = new Map(jar);
    expect((await call("/api/auth/email/start", { body: { email: "guest@example.test" }, from: "203.0.113.27" })).status).toBe(200);
    expect((await call("/api/auth/email/verify", { body: { email: "guest@example.test", code: CODE }, jar, from: "203.0.113.27" })).body.workspace).toBe(false);
    expect([401, 403]).toContain((await call("/api/bots", { jar: ownerJar })).status);
    expect([401, 403]).toContain((await call("/api/bots", { jar })).status);
    expect((await call("/api/account/session", { jar })).body.account.email).toBe("guest@example.test");
  });

  it("lists only computers this account linked, with their status, and refuses cross-site changes", async () => {
    const alice = await signIn("alice@example.test", "203.0.113.28");
    const bob = await signIn("bob@example.test", "203.0.113.29");
    const crossSite = await call("/api/account/devices/link-code", { jar: alice.jar, body: {}, headers: { origin: "https://evil.test" } });
    expect(crossSite.status).toBe(403);
    const code = await call("/api/account/devices/link-code", { jar: alice.jar, body: {} });
    expect(code.status).toBe(200);
    expect(normalizeLinkCode(code.body.code)).not.toBeNull();
    const linked = await call("/api/account/devices/link", { body: { code: code.body.code, name: "Alice's PC", platform: "win32", appVersion: "0.3.0-rc.3" }, });
    expect(linked.status).toBe(200);
    expect(linked.body.account.email).toBe("alice@example.test");
    const reuse = await call("/api/account/devices/link", { body: { code: code.body.code, name: "Second" } });
    expect(reuse.status).toBe(401);
    const aliceView = await call("/api/account/session", { jar: alice.jar });
    expect(aliceView.body.devices).toEqual([expect.objectContaining({ name: "Alice's PC", platform: "win32", online: true })]);
    expect(aliceView.body.workspaces).toEqual([]);
    expect((await call("/api/account/session", { jar: bob.jar })).body.devices).toEqual([]);
    // Bob cannot unlink Alice's computer; the machine's token opens no workspace route.
    expect((await call(`/api/account/devices/${linked.body.deviceId}`, { method: "DELETE", jar: bob.jar, body: {} })).status).toBe(404);
    expect([401, 403]).toContain((await call("/api/bots", { headers: { authorization: `Bearer ${linked.body.deviceToken}` } })).status);
    const beat = await call("/api/account/devices/heartbeat", { body: { appVersion: "0.3.0-rc.4" }, headers: { authorization: `Bearer ${linked.body.deviceToken}` } });
    expect(beat.status).toBe(200);
    expect((await call(`/api/account/devices/${linked.body.deviceId}`, { method: "DELETE", jar: alice.jar, body: {} })).status).toBe(200);
    expect((await call("/api/account/devices/heartbeat", { body: {}, headers: { authorization: `Bearer ${linked.body.deviceToken}` } })).status).toBe(401);
  });
});

describe("AccountDirectory", () => {
  it("shows a machine offline when it stops checking in, and expires account sessions", () => {
    let now = 1_000_000;
    const directory = new AccountDirectory(join(mkdtempSync(join(tmpdir(), "aiking-account-dir-")), "dir.json"), () => now);
    const identity = { userId: "u1", email: "a@example.test" };
    const { code } = directory.openLinkCode(identity);
    const linked = directory.redeemLinkCode(code, { name: "PC", platform: "linux", appVersion: "1" });
    expect(linked.ok).toBe(true);
    expect(directory.devicesOf("u1")[0]!.online).toBe(true);
    now += 10 * 60_000;
    expect(directory.devicesOf("u1")[0]!.online).toBe(false);
    const session = directory.issueSession(identity, "x");
    expect(directory.authenticate(session.token)?.email).toBe("a@example.test");
    now += 31 * 24 * 60 * 60_000;
    expect(directory.authenticate(session.token)).toBeNull();
    expect(directory.redeemLinkCode("ZZZZ-ZZZZ", { name: "x", platform: "", appVersion: "" })).toMatchObject({ ok: false, status: 401 });
  });
});
