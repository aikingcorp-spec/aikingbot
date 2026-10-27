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
  /** The owner header of this desktop app, for requests the relay brings in for the signed-in owner. */
  ownerHeader?: RelayConnectorOptions["ownerHeader"];
  /**
   * WebRTC P2P (rc8 §9.1). When set (or AIKING_REMOTE_P2P=1), inbound signal frames are queued for the
   * Electron hidden host via /api/aiking/remote/p2p/inbox; outbox posts call connector.sendSignal.
   */
  onSignal?: RelayConnectorOptions["onSignal"];
  /** Override feature flag (tests). Default: process.env.AIKING_REMOTE_P2P. */
  remoteP2p?: boolean;
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
  const p2pEnabled = options.remoteP2p === true || options.remoteP2p === false
    ? options.remoteP2p
    : process.env.AIKING_REMOTE_P2P === "1" || process.env.AIKING_REMOTE_P2P === "true";
  /** Inbound viewer→host signal frames waiting for the Electron P2P host to drain. */
  const p2pInbox: Record<string, unknown>[] = [];
  const MAX_P2P_INBOX = 64;
  let p2pPath: "p2p" | "turn" | "relay" = "relay";
  let p2pSwitching = false;
  let p2pSwitchingTimer: ReturnType<typeof setTimeout> | undefined;
  const setSwitching = (next: boolean) => {
    p2pSwitching = next;
    if (p2pSwitchingTimer) clearTimeout(p2pSwitchingTimer);
    p2pSwitchingTimer = undefined;
    if (next) {
      p2pSwitchingTimer = setTimeout(() => { p2pSwitching = false; p2pSwitchingTimer = undefined; }, 8_000);
    }
  };

  function enqueueSignal(frame: Record<string, unknown>) {
    options.onSignal?.(frame);
    if (!p2pEnabled) return;
    p2pInbox.push(frame);
    while (p2pInbox.length > MAX_P2P_INBOX) p2pInbox.shift();
  }

  function start() {
    connector?.stop(); connector = null;
    if (!saved) return;
    connector = connect({
      relayUrl: saved.relayUrl, hostId: saved.hostId, token: saved.token,
      target: { host: "127.0.0.1", port: options.port }, log,
      markHeader: { name: RELAYED_HEADER, value: nonce }, ownerHeader: options.ownerHeader,
      onSignal: enqueueSignal,
    });
  }
  const status = (): RelayStatus => ({ configured: Boolean(saved), state: connector?.state() ?? "off", ...(saved?.name ? { name: saved.name } : {}), relayUrl: saved?.relayUrl ?? relayUrl, canJoinWithAccount: Boolean(options.accountToken?.()) });

  start();
  return {
    status,
    /** Host→viewer signal via the relay WebSocket (no-op when offline / P2P off). */
    sendSignal(frame: Record<string, unknown>) {
      connector?.sendSignal(frame);
    },
    p2pEnabled: () => p2pEnabled,
    p2pStatus: () => ({ enabled: p2pEnabled, path: p2pPath, switching: p2pSwitching, pending: p2pInbox.length, relay: status() }),
    setP2pPath(path: "p2p" | "turn" | "relay", switching = false) { p2pPath = path; setSwitching(switching === true); },
    stop() { if (p2pSwitchingTimer) clearTimeout(p2pSwitchingTimer); p2pSwitchingTimer = undefined; connector?.stop(); connector = null; },
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
      const isRelay = path.startsWith("/api/aiking/relay");
      const isP2p = path.startsWith("/api/aiking/remote/p2p");
      if (!isRelay && !isP2p) return false;
      res.setHeader("cache-control", "no-store");
      // Connecting or disconnecting changes who can reach this computer: only someone at this computer may do it.
      if (ctx.req.headers[RELAYED_HEADER] !== undefined && method !== "GET") { json(res, 403, { error: "Manage the web connection from this computer, not from the web." }); return true; }

      // Local Electron host ↔ relay-connector bridge (loopback only; refused when relayed).
      if (isP2p) {
        if (!p2pEnabled) { json(res, 404, { error: "Remote P2P is off." }); return true; }
        if (path === "/api/aiking/remote/p2p/status" && method === "GET") {
          json(res, 200, { enabled: true, path: p2pPath, switching: p2pSwitching, pending: p2pInbox.length, relay: status() });
          return true;
        }
        if (path === "/api/aiking/remote/p2p/inbox" && method === "GET") {
          const frames = p2pInbox.splice(0, p2pInbox.length);
          json(res, 200, { frames });
          return true;
        }
        if (path === "/api/aiking/remote/p2p/outbox" && method === "POST") {
          const body = Object(await ctx.readBody(ctx.req).catch(() => ({}))) as Record<string, unknown>;
          if (body.t !== "signal" && body.kind === undefined) { json(res, 400, { error: "signal frame required" }); return true; }
          const frame = body.t === "signal" ? body : { ...body, t: "signal" };
          if (typeof frame.path === "string" && (frame.path === "p2p" || frame.path === "turn" || frame.path === "relay")) {
            p2pPath = frame.path;
            if (frame.path !== "relay") setSwitching(false);
          }
          connector?.sendSignal(frame);
          json(res, 200, { ok: true });
          return true;
        }
        if (path === "/api/aiking/remote/p2p/path" && method === "POST") {
          const body = Object(await ctx.readBody(ctx.req).catch(() => ({}))) as { path?: unknown; switching?: unknown };
          if (body.path !== "p2p" && body.path !== "turn" && body.path !== "relay") {
            json(res, 400, { error: "path must be p2p, turn, or relay" });
            return true;
          }
          p2pPath = body.path;
          setSwitching(body.switching === true);
          json(res, 200, { ok: true, path: p2pPath, switching: p2pSwitching });
          return true;
        }
        json(res, 404, { error: "Unknown request." });
        return true;
      }

      if (path === "/api/aiking/relay/status" && method === "GET") { json(res, 200, status()); return true; }
      if (path === "/api/aiking/relay/enroll" && method === "POST") {
        const body = Object(await ctx.readBody(ctx.req).catch(() => ({}))) as { code?: unknown; name?: unknown };
        const code = typeof body.code === "string" ? body.code.trim() : "";
        // eslint-disable-next-line no-control-regex -- strip ASCII controls from relay display names
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
        // eslint-disable-next-line no-control-regex -- strip ASCII controls from relay display names
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
