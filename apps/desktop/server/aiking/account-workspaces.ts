// Copyright (c) 2026 AIKING.
// Account layer of a hosted AIKINGBOT server. An email code proves an address and nothing more: it gives an account
// session that can read this account's own workspace list and linked machines, sign out, and link a machine. It is
// a separate credential from the workspace session, so no workspace route can ever accept it; workspace access still
// comes only from this server's membership (owners, People), checked again on every use.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { writeFileAtomic } from "../atomic.ts";
import { bearerToken, parseCookies, provesSameOrigin, requestOrigin, requestSource } from "../request-auth.ts";

export const ACCOUNT_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
export const ACCOUNT_SESSION_MAX_AGE_MS = 180 * 24 * 60 * 60_000;
export const LINK_CODE_TTL_MS = 10 * 60_000;
/** A machine that has not checked in for this long shows as offline. Desktops check in every minute. */
export const DEVICE_ONLINE_WINDOW_MS = 150_000;
export const MAX_DEVICES_PER_ACCOUNT = 20;
const MAX_ACCOUNT_SESSIONS = 5_000;
const LINK_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

export type WorkspaceRole = "owner" | "member";
export interface AccountWorkspace {
  id: string;
  name: string;
  role: WorkspaceRole;
  /** This server: opening it needs a workspace session, which `enter` issues while membership holds. */
  current: true;
}
export interface AccountIdentity { userId: string; email: string }

const accountSessionSchema = z.object({
  id: z.string().min(1).max(64),
  tokenHash: z.string().length(64),
  userId: z.string().min(1).max(256),
  email: z.string().min(3).max(320),
  label: z.string().max(80),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  expiresAt: z.number(),
});
const deviceSchema = z.object({
  id: z.string().min(1).max(64),
  tokenHash: z.string().length(64),
  userId: z.string().min(1).max(256),
  email: z.string().min(3).max(320),
  name: z.string().min(1).max(80),
  platform: z.string().max(32),
  appVersion: z.string().max(40),
  createdAt: z.number(),
  lastSeenAt: z.number(),
});
const fileSchema = z.object({ version: z.literal(1), sessions: z.array(accountSessionSchema), devices: z.array(deviceSchema) });
type AccountSessionRecord = z.infer<typeof accountSessionSchema>;
type DeviceRecord = z.infer<typeof deviceSchema>;

export interface PublicDevice {
  id: string;
  name: string;
  platform: string;
  appVersion: string;
  linkedAt: number;
  lastSeenAt: number;
  online: boolean;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\p{Cc}؜‎‏‪-‮⁦-⁩]/gu, "").trim().slice(0, max) : "";
}
export function normalizeLinkCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 32) return null;
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return code.length === 8 && [...code].every((symbol) => LINK_ALPHABET.includes(symbol)) ? code : null;
}
function newLinkCode(): string {
  const limit = Math.floor(256 / LINK_ALPHABET.length) * LINK_ALPHABET.length;
  let code = "";
  while (code.length < 8) for (const byte of randomBytes(16)) if (byte < limit && code.length < 8) code += LINK_ALPHABET[byte % LINK_ALPHABET.length];
  return code;
}

/** Persistent account sessions and linked machines; the hashes of credentials only. */
export class AccountDirectory {
  private sessions: AccountSessionRecord[] = [];
  private devices: DeviceRecord[] = [];
  private linkCodes = new Map<string, { userId: string; email: string; expiresAt: number }>();
  private lastWrite = 0;
  private readonly file: string;
  private readonly now: () => number;

  constructor(file: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    if (existsSync(file)) {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
      if (!parsed.success) throw new Error(`${file} is not a valid account directory; move it aside to start empty`);
      this.sessions = parsed.data.sessions;
      this.devices = parsed.data.devices;
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, `${JSON.stringify({ version: 1, sessions: this.sessions, devices: this.devices })}\n`, { mode: 0o600 });
    this.lastWrite = this.now();
  }

  issueSession(identity: AccountIdentity, label: string): { token: string; expiresAt: number } {
    const now = this.now();
    this.sessions = this.sessions.filter((session) => session.expiresAt > now);
    while (this.sessions.length >= MAX_ACCOUNT_SESSIONS) this.sessions.shift();
    const token = `aka_${randomBytes(32).toString("base64url")}`;
    const expiresAt = now + ACCOUNT_SESSION_TTL_MS;
    this.sessions.push({ id: randomUUID(), tokenHash: sha256(token), userId: identity.userId, email: identity.email, label: cleanText(label, 80), createdAt: now, lastSeenAt: now, expiresAt });
    this.save();
    return { token, expiresAt };
  }

  /** Slides the term on use (never past the maximum age); expired and unknown tokens are null. */
  authenticate(token: string | undefined): (AccountIdentity & { sessionId: string; expiresAt: number }) | null {
    if (!token || !token.startsWith("aka_") || token.length > 100) return null;
    const hash = sha256(token);
    const now = this.now();
    const record = this.sessions.find((session) => sameDigest(session.tokenHash, hash));
    if (!record || record.expiresAt <= now) return null;
    record.lastSeenAt = now;
    if (record.expiresAt - now < ACCOUNT_SESSION_TTL_MS / 2) record.expiresAt = Math.min(now + ACCOUNT_SESSION_TTL_MS, record.createdAt + ACCOUNT_SESSION_MAX_AGE_MS);
    if (now - this.lastWrite > LAST_SEEN_WRITE_INTERVAL_MS) this.save();
    return { userId: record.userId, email: record.email, sessionId: record.id, expiresAt: record.expiresAt };
  }

  revokeSession(sessionId: string): void {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((session) => session.id !== sessionId);
    if (this.sessions.length !== before) this.save();
  }

  openLinkCode(identity: AccountIdentity): { code: string; expiresAt: number } {
    const now = this.now();
    for (const [hash, entry] of this.linkCodes) if (entry.expiresAt <= now || entry.userId === identity.userId) this.linkCodes.delete(hash);
    const code = newLinkCode();
    const expiresAt = now + LINK_CODE_TTL_MS;
    this.linkCodes.set(sha256(code), { userId: identity.userId, email: identity.email, expiresAt });
    return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt };
  }

  /** Single use: the code is spent whether or not linking succeeds. */
  redeemLinkCode(rawCode: unknown, input: { name: unknown; platform: unknown; appVersion: unknown }): { ok: true; deviceId: string; token: string; email: string } | { ok: false; status: number; error: string } {
    const code = normalizeLinkCode(rawCode);
    if (!code) return { ok: false, status: 400, error: "enter the 8-character link code shown in AIKINGBOT on the web" };
    const hash = sha256(code);
    const entry = this.linkCodes.get(hash);
    this.linkCodes.delete(hash);
    if (!entry || entry.expiresAt <= this.now()) return { ok: false, status: 401, error: "that link code is wrong or has expired; create a new one on the web" };
    if (this.devices.filter((device) => device.userId === entry.userId).length >= MAX_DEVICES_PER_ACCOUNT) {
      return { ok: false, status: 409, error: `an account can link at most ${MAX_DEVICES_PER_ACCOUNT} machines; unlink one first` };
    }
    const now = this.now();
    const token = `akd_${randomBytes(32).toString("base64url")}`;
    const device: DeviceRecord = {
      id: randomUUID(), tokenHash: sha256(token), userId: entry.userId, email: entry.email,
      name: cleanText(input.name, 80) || "Computer", platform: cleanText(input.platform, 32), appVersion: cleanText(input.appVersion, 40),
      createdAt: now, lastSeenAt: now,
    };
    this.devices.push(device);
    this.save();
    return { ok: true, deviceId: device.id, token, email: entry.email };
  }

  heartbeat(token: string | undefined, input: { appVersion?: unknown; name?: unknown }): DeviceRecord | null {
    if (!token || !token.startsWith("akd_") || token.length > 100) return null;
    const hash = sha256(token);
    const device = this.devices.find((entry) => sameDigest(entry.tokenHash, hash));
    if (!device) return null;
    const appVersion = cleanText(input.appVersion, 40);
    const name = cleanText(input.name, 80);
    const changed = (appVersion && appVersion !== device.appVersion) || (name && name !== device.name);
    if (appVersion) device.appVersion = appVersion;
    if (name) device.name = name;
    device.lastSeenAt = this.now();
    if (changed || this.now() - this.lastWrite > LAST_SEEN_WRITE_INTERVAL_MS) this.save();
    return device;
  }

  /** Only the account that linked a machine sees it; a machine never appears because it is on the same network or host. */
  devicesOf(userId: string): PublicDevice[] {
    const now = this.now();
    return this.devices.filter((device) => device.userId === userId).map((device) => ({
      id: device.id, name: device.name, platform: device.platform, appVersion: device.appVersion,
      linkedAt: device.createdAt, lastSeenAt: device.lastSeenAt, online: now - device.lastSeenAt <= DEVICE_ONLINE_WINDOW_MS,
    }));
  }

  unlink(userId: string, deviceId: string): boolean {
    const before = this.devices.length;
    this.devices = this.devices.filter((device) => !(device.id === deviceId && device.userId === userId));
    if (this.devices.length === before) return false;
    this.save();
    return true;
  }
}

export interface AccountRoutesOptions {
  directory: AccountDirectory;
  cookieName: string;
  /** This server's memberships for the address: the single authority, read live on every request. */
  workspacesFor(email: string): AccountWorkspace[];
  /** Issues a workspace session for a member (same path as a member's email sign-in); returns its cookie header. */
  enterWorkspace(identity: AccountIdentity, label: string, req: IncomingMessage): string | null;
  /** Ends the workspace session this browser holds, if any; returns the header that clears its cookie. */
  endWorkspaceSession(req: IncomingMessage): string;
  attemptAllowed(source: string): { ok: true } | { ok: false; retryAfterMs: number };
  noteFailure(source: string): void;
  readBody(req: IncomingMessage): Promise<Record<string, unknown> | null>;
  json(res: ServerResponse, status: number, body: unknown): void;
  hostedComputers?: boolean;
}

export function accountCookieName(environmentId: string): string {
  return `aikingbot_account_${environmentId.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`;
}

export function serializeAccountCookie(name: string, token: string, maxAgeSeconds: number, secure: boolean): string {
  return [`${name}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}`, ...(secure ? ["Secure"] : [])].join("; ");
}
export function clearAccountCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** `/api/account/*`: before the workspace gate, and never a way into it. */
export function createAccountRoutes(options: AccountRoutesOptions) {
  const { directory, json } = options;
  const secureFor = (req: IncomingMessage) => requestOrigin(req)?.startsWith("https://") === true;
  const current = (req: IncomingMessage) => directory.authenticate(parseCookies(req.headers.cookie).get(options.cookieName));
  const isJson = (req: IncomingMessage) => /^application\/json\b/i.test(String(req.headers["content-type"] ?? ""));
  const summary = (identity: AccountIdentity) => ({
    account: { email: identity.email },
    workspaces: options.workspacesFor(identity.email),
    devices: directory.devicesOf(identity.userId),
    hostedComputers: options.hostedComputers === true ? "available" : "not-offered",
  });

  return {
    /** The account cookie a verified email sign-in sets; always, member or not. */
    signInCookie(identity: AccountIdentity, label: string, req: IncomingMessage): string {
      const previous = current(req);
      if (previous) directory.revokeSession(previous.sessionId);
      const issued = directory.issueSession(identity, label);
      return serializeAccountCookie(options.cookieName, issued.token, (issued.expiresAt - Date.now()) / 1000, secureFor(req));
    },
    /** Workspace sign-out ends the account session of this browser too, so a reload cannot regain either. */
    endAccount(req: IncomingMessage): string {
      const identity = current(req);
      if (identity) directory.revokeSession(identity.sessionId);
      return clearAccountCookie(options.cookieName);
    },
    summary,
    async handle(req: IncomingMessage, res: ServerResponse, path: string, method: string): Promise<boolean> {
      if (!path.startsWith("/api/account/")) return false;
      res.setHeader("cache-control", "no-store");
      // A machine checks in with its own credential, never a cookie.
      if (path === "/api/account/devices/link" || path === "/api/account/devices/heartbeat") {
        if (method !== "POST") { json(res, 405, { error: "method not allowed" }); return true; }
        if (!isJson(req)) { json(res, 415, { error: "send JSON (content-type: application/json)" }); return true; }
        const source = requestSource(req);
        const allowed = options.attemptAllowed(source);
        if (!allowed.ok) { json(res, 429, { error: `too many failed attempts from your address; try again in ${Math.ceil(allowed.retryAfterMs / 1000)}s` }); return true; }
        const body = (await options.readBody(req)) ?? {};
        if (path === "/api/account/devices/link") {
          const linked = directory.redeemLinkCode(body.code, { name: body.name, platform: body.platform, appVersion: body.appVersion });
          if (!linked.ok) { if (linked.status === 401) options.noteFailure(source); json(res, linked.status, { error: linked.error }); return true; }
          json(res, 200, { deviceId: linked.deviceId, deviceToken: linked.token, account: { email: linked.email } });
          return true;
        }
        const device = directory.heartbeat(bearerToken(req.headers.authorization), { appVersion: body.appVersion, name: body.name });
        if (!device) { options.noteFailure(source); json(res, 401, { error: "this machine is no longer linked to an account" }); return true; }
        json(res, 200, { ok: true, deviceId: device.id, account: { email: device.email } });
        return true;
      }
      const identity = current(req);
      if (method === "GET" && path === "/api/account/session") {
        if (!identity) { json(res, 401, { error: "sign in with your email to continue" }); return true; }
        const secure = secureFor(req);
        res.setHeader("set-cookie", serializeAccountCookie(options.cookieName, parseCookies(req.headers.cookie).get(options.cookieName)!, (identity.expiresAt - Date.now()) / 1000, secure));
        json(res, 200, summary(identity));
        return true;
      }
      let body: Record<string, unknown> = {};
      if (method !== "GET") {
        // Cookie-authenticated changes: a cross-site page cannot send JSON with a proven same origin.
        if (!isJson(req) || !provesSameOrigin(req)) { json(res, 403, { error: "cross-origin request refused" }); return true; }
        // Read every change's body before answering, so a kept-alive connection is never left with unread bytes.
        body = (await options.readBody(req)) ?? {};
      }
      if (method === "POST" && path === "/api/account/logout") {
        if (identity) directory.revokeSession(identity.sessionId);
        res.setHeader("set-cookie", [clearAccountCookie(options.cookieName), options.endWorkspaceSession(req)]);
        json(res, 200, { ok: true });
        return true;
      }
      if (!identity) { json(res, 401, { error: "sign in with your email to continue" }); return true; }
      const enter = /^\/api\/account\/workspaces\/([^/]+)\/enter$/.exec(path);
      if (method === "POST" && enter) {
        const workspace = options.workspacesFor(identity.email).find((entry) => entry.id === decodeURIComponent(enter[1]!));
        if (!workspace) { json(res, 403, { error: "this account is not a member of that workspace; ask its owner to invite you" }); return true; }
        const cookie = options.enterWorkspace(identity, cleanText(body.label, 80), req);
        if (!cookie) { json(res, 403, { error: "this account is not a member of that workspace; ask its owner to invite you" }); return true; }
        res.setHeader("set-cookie", cookie);
        json(res, 200, { ok: true, workspace });
        return true;
      }
      if (method === "POST" && path === "/api/account/devices/link-code") {
        json(res, 200, directory.openLinkCode(identity));
        return true;
      }
      const device = /^\/api\/account\/devices\/([\w-]{1,64})$/.exec(path);
      if (method === "DELETE" && device) {
        json(res, directory.unlink(identity.userId, device[1]!) ? 200 : 404, directory.devicesOf(identity.userId));
        return true;
      }
      json(res, 404, { error: "not found" });
      return true;
    },
  };
}
