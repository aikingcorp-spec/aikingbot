// Copyright (c) 2026 AIKING.
// Signing in on the desktop app, inside the app. The person types their email and the one-time code in the app's own first-run
// screen; this module talks to the AIKING account service and keeps the result (email, user id, session token) in the data
// folder (0600). The window never leaves the person's own computer, and the same sign-in later lets this computer join the web
// relay without a second code. Only the desktop app turns this on.
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ControlPlaneError } from "../../electron/control-plane-client.mjs";
import { createAikingAccountClient } from "./account-api.ts";
import { RELAYED_HEADER } from "./relay.ts";

export const DEFAULT_ACCOUNT_API = "https://aikingbot-auth-staging.aiking-corp.workers.dev";

type Saved = { email: string; userId: string; token: string };
type AccountClient = Pick<ReturnType<typeof createAikingAccountClient>, "requestOTP" | "verifyOTP" | "signOut">;
export type DesktopAccountOptions = { file: string; /** Where an earlier version kept the sign-in (inside the data folder): adopted once, and removed at sign-out. */ legacyFile?: string; baseURL?: string; client?: AccountClient; log?: (message: string) => void; /** Runs after the person signed out: the web access they set up under that account ends with it. */ onSignOut?: () => void | Promise<void> };

/** What a failed step says, in words and as a code the screen can translate. */
function explain(error: unknown): { status: number; code: string; error: string } {
  const code = error instanceof ControlPlaneError ? error.code : "";
  if (code === "invalid_email") return { status: 400, code, error: "That email address does not look right." };
  if (code === "invalid_otp" || code === "challenge_expired" || code === "http_401" || code === "http_400") return { status: 401, code: "invalid_otp", error: "That code is not right or has expired. Ask for a new one." };
  if (code === "http_429" || code === "rate_limited") return { status: 429, code: "rate_limited", error: "Too many tries. Wait a minute and try again." };
  return { status: 502, code: "unavailable", error: "Could not reach the AIKINGBOT account service. Check the internet connection and try again." };
}

export function createDesktopAccount(options: DesktopAccountOptions) {
  const log = options.log ?? (() => undefined);
  const client: AccountClient = options.client ?? createAikingAccountClient({ baseURL: options.baseURL || process.env.AIKING_ACCOUNT_API_URL || DEFAULT_ACCOUNT_API });
  let saved = read();

  function readFrom(file: string): Saved | null {
    try {
      const value = JSON.parse(readFileSync(file, "utf8")) as Partial<Saved>;
      return typeof value.email === "string" && typeof value.userId === "string" && typeof value.token === "string" ? { email: value.email, userId: value.userId, token: value.token } : null;
    } catch { return null; }
  }
  function read(): Saved | null {
    const current = readFrom(options.file);
    if (current || !options.legacyFile) return current;
    // One sign-in per computer, not per server folder: an earlier version's sign-in moves to the shared place.
    const old = readFrom(options.legacyFile);
    if (old) { try { write(old); } catch { /* read-only place: the sign-in still works for this run */ } }
    return old;
  }
  function write(value: Saved) {
    mkdirSync(dirname(options.file), { recursive: true, mode: 0o700 });
    const temporary = `${options.file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, options.file);
  }
  const status = () => ({ signedIn: Boolean(saved), ...(saved ? { email: saved.email } : {}) });

  return {
    status,
    /** The session token, for the one caller that proves this person's identity to another AIKING service. Never sent to the screen. */
    token: () => saved?.token ?? null,
    email: () => saved?.email ?? null,
    async handle(ctx: { req: IncomingMessage; res: ServerResponse; path: string; method: string; json(res: ServerResponse, status: number, body: unknown): void; readBody(req: IncomingMessage): Promise<unknown> }): Promise<boolean> {
      const { res, path, method, json } = ctx;
      if (!path.startsWith("/api/aiking/account/")) return false;
      res.setHeader("cache-control", "no-store");
      if (path === "/api/aiking/account/status" && method === "GET") { json(res, 200, status()); return true; }
      // Signing in or out changes who this computer belongs to: only someone at this computer may do it, never through the relay.
      if (ctx.req.headers[RELAYED_HEADER] !== undefined && method !== "GET") { json(res, 403, { error: "Sign in on this computer, not from the web.", code: "local_only" }); return true; }
      const body = method === "POST" ? Object(await ctx.readBody(ctx.req).catch(() => ({}))) as { email?: unknown; code?: unknown } : {};
      if (path === "/api/aiking/account/otp" && method === "POST") {
        try { await client.requestOTP(String(body.email ?? "")); json(res, 200, { ok: true }); }
        catch (error) { const failure = explain(error); json(res, failure.status, { error: failure.error, code: failure.code }); }
        return true;
      }
      if (path === "/api/aiking/account/verify" && method === "POST") {
        try {
          const result = await client.verifyOTP(String(body.email ?? ""), String(body.code ?? "")) as { accountToken: string; user: { id: string; email: string } };
          saved = { email: result.user.email, userId: result.user.id, token: result.accountToken };
          write(saved);
          log("signed in");
          json(res, 200, status());
        } catch (error) { const failure = explain(error); json(res, failure.status, { error: failure.error, code: failure.code }); }
        return true;
      }
      if (path === "/api/aiking/account/logout" && method === "POST") {
        const token = saved?.token;
        saved = null;
        rmSync(options.file, { force: true });
        if (options.legacyFile) rmSync(options.legacyFile, { force: true });
        if (token) await client.signOut(token).catch(() => undefined);
        try { await options.onSignOut?.(); } catch (error) { log(`sign-out hook failed: ${(error as Error).message}`); }
        json(res, 200, status());
        return true;
      }
      json(res, 404, { error: "Unknown request." });
      return true;
    },
  };
}
export type DesktopAccount = ReturnType<typeof createDesktopAccount>;
