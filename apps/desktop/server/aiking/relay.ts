// Copyright (c) 2026 AIKING.
// "Use on the web": this computer joins the AIKINGBOT web relay with a one-time code from the web page, keeps the link up
// whenever the app runs, and can be disconnected here at any time. The credentials live in the data folder (0600) and are
// never returned by the API. The relay's address is the product's own; AIKING_RELAY_URL changes it (a custom domain later).
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { enrollWithAccount, enrollWithRelay, leaveRelay, startRelayConnector, type RelayConnector, type RelayConnectorOptions, type RelayState } from "./relay-connector.ts";

export const DEFAULT_RELAY_URL = "https://app.aikingxbot.com";
/** Added by the connector to every request it replays, so management calls arriving over the relay itself can be refused. */
export const RELAYED_HEADER = "x-aiking-relayed";

type Saved = { relayUrl: string; hostId: string; token: string; name: string };
export type RelayStatus = { configured: boolean; state: RelayState; name?: string; relayUrl: string; /** This computer is signed in to the account, so it can join without a code. */ canJoinWithAccount: boolean };
export type RelayOptions = {
  file: string;
  port: number;
  relayUrl?: string;
  log?: (message: string) => void;
  enroll?: typeof enrollWithRelay;
  /** The account sign-in of this computer, when it has one. */
  accountToken?: () => string | null;
  enrollAccount?: typeof enrollWithAccount;
  leave?: typeof leaveRelay;
  connect?: (options: RelayConnectorOptions) => RelayConnector;
};

const MESSAGES: Record<string, [number, string]> = {
  invalid_account: [401, "Your sign-in has expired. Sign in again in Settings → Account, then try again."],
  invalid_code: [404, "That code is not right or has expired. Make a new one on the web page."],
  too_many_attempts: [429, "Too many tries. Wait a few minutes and try again."],
  network: [502, "Could not reach the AIKINGBOT web service. Check the internet connection and try again."],
};

export function createRelay(options: RelayOptions) {
  const log = options.log ?? (() => undefined);
  const relayUrl = (options.relayUrl || process.env.AIKING_RELAY_URL || DEFAULT_RELAY_URL).replace(/\/+$/, "");
  const enroll = options.enroll ?? enrollWithRelay;
  const enrollAccount = options.enrollAccount ?? enrollWithAccount;
  const leave = options.leave ?? leaveRelay;
  const connect = options.connect ?? startRelayConnector;
  const nonce = randomBytes(16).toString("hex");
  let saved = read();
  let connector: RelayConnector | null = null;

  function read(): Saved | null {
    try {
      const value = JSON.parse(readFileSync(options.file, "utf8")) as Partial<Saved>;
      return typeof value.hostId === "string" && typeof value.token === "string" && typeof value.relayUrl === "string"
        ? { hostId: value.hostId, token: value.token, relayUrl: value.relayUrl, name: typeof value.name === "string" ? value.name : "" } : null;
    } catch { return null; }
  }
  function write(value: Saved) {
    mkdirSync(dirname(options.file), { recursive: true, mode: 0o700 });
    const temporary = `${options.file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, options.file);
  }
  function start() {
    connector?.stop(); connector = null;
    if (!saved) return;
    connector = connect({ relayUrl: saved.relayUrl, hostId: saved.hostId, token: saved.token, target: { host: "127.0.0.1", port: options.port }, log, markHeader: { name: RELAYED_HEADER, value: nonce } });
  }
  const status = (): RelayStatus => ({ configured: Boolean(saved), state: connector?.state() ?? "off", ...(saved?.name ? { name: saved.name } : {}), relayUrl: saved?.relayUrl ?? relayUrl, canJoinWithAccount: Boolean(options.accountToken?.()) });

  start();
  return {
    status,
    stop() { connector?.stop(); connector = null; },
    async enrollWith(code: string, name: string): Promise<RelayStatus> {
      const result = await enroll(relayUrl, code, name).catch((error: Error) => { throw Object.assign(new Error(error.message), { relay: true }); });
      saved = { relayUrl, hostId: result.hostId, token: result.token, name: result.name };
      write(saved);
      start();
      log("relay enrolled");
      return status();
    },
    async enrollWithAccountSignIn(name: string): Promise<RelayStatus> {
      const token = options.accountToken?.();
      if (!token) throw Object.assign(new Error("invalid_account"), { relay: true });
      const result = await enrollAccount(relayUrl, token, name).catch((error: Error) => { throw Object.assign(new Error(error.message), { relay: true }); });
      saved = { relayUrl, hostId: result.hostId, token: result.token, name: result.name };
      write(saved);
      start();
      log("relay joined with the account sign-in");
      return status();
    },
    /** Remote access off: the computer leaves the relay (so the web no longer lists it), stops the link and forgets its credentials. */
    async disconnect(): Promise<RelayStatus> {
      const previous = saved;
      connector?.stop(); connector = null; saved = null;
      rmSync(options.file, { force: true });
      if (previous) await leave(previous.relayUrl, previous.hostId, previous.token);
      return status();
    },
    async handle(ctx: { req: IncomingMessage; res: ServerResponse; path: string; method: string; json(res: ServerResponse, status: number, body: unknown): void; readBody(req: IncomingMessage): Promise<unknown> }): Promise<boolean> {
      const { res, path, method, json } = ctx;
      if (!path.startsWith("/api/aiking/relay")) return false;
      res.setHeader("cache-control", "no-store");
      // Connecting or disconnecting changes who can reach this computer: only someone at this computer may do it.
      if (ctx.req.headers[RELAYED_HEADER] !== undefined && method !== "GET") { json(res, 403, { error: "Manage the web connection from this computer, not from the web." }); return true; }
      if (path === "/api/aiking/relay/status" && method === "GET") { json(res, 200, status()); return true; }
      if (path === "/api/aiking/relay/enroll" && method === "POST") {
        const body = Object(await ctx.readBody(ctx.req).catch(() => ({}))) as { code?: unknown; name?: unknown };
        const code = typeof body.code === "string" ? body.code.trim() : "";
        const name = typeof body.name === "string" ? body.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) : "";
        if (!/^[A-Za-z0-9-]{8,24}$/.test(code)) { json(res, 400, { error: "Enter the code shown on the web page." }); return true; }
        try { json(res, 200, await this.enrollWith(code, name || "My computer")); }
        catch (error) {
          const [code2, message] = MESSAGES[(error as Error).message] ?? (/^http_|fetch|abort|timeout|network/i.test((error as Error).message) ? MESSAGES.network! : [502, "The web service did not accept the code. Try again."]);
          json(res, code2, { error: message });
        }
        return true;
      }
      if (path === "/api/aiking/relay/enroll-account" && method === "POST") {
        const body = Object(await ctx.readBody(ctx.req).catch(() => ({}))) as { name?: unknown };
        const name = typeof body.name === "string" ? body.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) : "";
        try { json(res, 200, await this.enrollWithAccountSignIn(name || "My computer")); }
        catch (error) {
          const [status2, message] = MESSAGES[(error as Error).message] ?? (/^http_|fetch|abort|timeout|network/i.test((error as Error).message) ? MESSAGES.network! : [502, "The web service did not accept this computer. Try again."]);
          json(res, status2, { error: message });
        }
        return true;
      }
      if (path === "/api/aiking/relay" && method === "DELETE") { json(res, 200, await this.disconnect()); return true; }
      json(res, 404, { error: "Unknown request." });
      return true;
    },
  };
}
export type Relay = ReturnType<typeof createRelay>;
export const relayFileExists = (file: string) => existsSync(file);
