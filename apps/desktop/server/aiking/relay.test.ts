import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRelay, DEFAULT_RELAY_URL, RELAYED_HEADER } from "./relay.ts";
import type { RelayConnectorOptions } from "./relay-connector.ts";
import { removeTempDir } from "../testing/cleanup.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) removeTempDir(dir); });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "relay-")); dirs.push(dir); return dir; };

function fixture(extra: { enroll?: (url: string, code: string, name: string) => Promise<{ hostId: string; token: string; name: string }> } = {}) {
  const dir = temp();
  const started: RelayConnectorOptions[] = [];
  const stops = vi.fn();
  const enroll = vi.fn(extra.enroll ?? (async (_url: string, _code: string, name: string) => ({ hostId: "host-12345678", token: "secret-token", name })));
  const make = () => createRelay({ file: join(dir, "relay.json"), port: 18799, enroll, connect: (options) => { started.push(options); return { stop: stops, state: () => "online" as const, sendSignal: () => undefined }; } });
  return { dir, file: join(dir, "relay.json"), started, stops, enroll, make };
}
async function call(relay: ReturnType<typeof createRelay>, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  let status = 0; let payload: unknown;
  const res = { setHeader: () => undefined } as unknown as ServerResponse;
  const handled = await relay.handle({ req: { headers } as unknown as IncomingMessage, res, path, method, json: (_res, code, value) => { status = code; payload = value; }, readBody: async () => body });
  return { handled, status, payload };
}

describe("the web connection", () => {
  it("hands the owner header on to the connector, so changes made on the web are the owner's own", () => {
    const seen: Array<unknown> = [];
    const ownerHeader = () => ({ name: "x-owner", value: "token" });
    const relay = createRelay({ file: join(temp(), "relay.json"), port: 1, ownerHeader, connect: (options) => { seen.push(options.ownerHeader); return { state: () => "online" as const, stop: () => undefined, sendSignal: () => undefined }; },
      enroll: async () => ({ hostId: "h", token: "t", name: "n" }) });
    return relay.enrollWith("ABCD-EFGH", "n").then(() => { expect(seen.at(-1)).toBe(ownerHeader); relay.stop(); });
  });
  it("is off until a code is entered, and ignores other paths", async () => {
    const f = fixture(); const relay = f.make();
    expect(relay.status()).toEqual({ configured: false, state: "off", relayUrl: DEFAULT_RELAY_URL, canJoinWithAccount: false });
    expect((await call(relay, "GET", "/api/aiking/other")).handled).toBe(false);
    expect(f.started).toHaveLength(0);
  });

  it("enrols with a code, starts the link, and keeps the credentials private (0600, never in the API)", async () => {
    const f = fixture(); const relay = f.make();
    const result = await call(relay, "POST", "/api/aiking/relay/enroll", { code: "ABCD-EFGH-JKLM", name: "Máy của Lan" });
    expect(result.status).toBe(200);
    expect(result.payload).toEqual({ configured: true, state: "online", name: "Máy của Lan", relayUrl: DEFAULT_RELAY_URL, canJoinWithAccount: false });
    expect(JSON.stringify(result.payload)).not.toContain("secret-token");
    expect(f.enroll).toHaveBeenCalledWith(DEFAULT_RELAY_URL, "ABCD-EFGH-JKLM", "Máy của Lan");
    expect(f.started).toHaveLength(1);
    expect(f.started[0]).toMatchObject({ hostId: "host-12345678", token: "secret-token", target: { host: "127.0.0.1", port: 18799 } });
    if (process.platform !== "win32") expect(statSync(f.file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(f.file, "utf8"))).toMatchObject({ hostId: "host-12345678" });
  });

  it("reconnects by itself the next time the app starts", async () => {
    const f = fixture(); await f.make().enrollWith("ABCD-EFGH-JKLM", "Lan");
    f.started.length = 0;
    const again = f.make();
    expect(again.status().configured).toBe(true);
    expect(f.started).toHaveLength(1);
    expect(f.started[0]!.token).toBe("secret-token");
  });

  it("can be disconnected, which tells the relay it left, stops the link and forgets the credentials", async () => {
    const dir = temp(); const leave = vi.fn(async () => true); const stops = vi.fn();
    const relay = createRelay({ file: join(dir, "relay.json"), port: 18799, leave, enroll: async (_u, _c, name) => ({ hostId: "host-12345678", token: "secret-token", name }), connect: () => ({ stop: stops, state: () => "online" as const, sendSignal: () => undefined }) });
    await relay.enrollWith("ABCD-EFGH-JKLM", "Lan");
    const result = await call(relay, "DELETE", "/api/aiking/relay");
    expect(leave).toHaveBeenCalledWith(DEFAULT_RELAY_URL, "host-12345678", "secret-token");
    expect(stops).toHaveBeenCalled();
    expect(result.status).toBe(200);
    expect(existsSync(join(dir, "relay.json"))).toBe(false);
  });

  it("is disconnected even when the relay cannot be told", async () => {
    const dir = temp();
    const relay = createRelay({ file: join(dir, "relay.json"), port: 18799, leave: async () => false, enroll: async (_u, _c, name) => ({ hostId: "host-12345678", token: "t", name }), connect: () => ({ stop: () => undefined, state: () => "online" as const, sendSignal: () => undefined }) });
    await relay.enrollWith("ABCD-EFGH-JKLM", "Lan");
    expect((await call(relay, "DELETE", "/api/aiking/relay")).payload).toMatchObject({ configured: false, state: "off" });
    expect(existsSync(join(dir, "relay.json"))).toBe(false);
  });

  it("can be disconnected (old fixture)", async () => {
    const f = fixture(); const relay = f.make(); await relay.enrollWith("ABCD-EFGH-JKLM", "Lan");
    const result = await call(relay, "DELETE", "/api/aiking/relay");
    expect(result.status).toBe(200);
    expect(result.payload).toMatchObject({ configured: false, state: "off" });
    expect(f.stops).toHaveBeenCalled();
    expect(existsSync(f.file)).toBe(false);
  });

  it("refuses a malformed code without calling the web service", async () => {
    const f = fixture(); const relay = f.make();
    for (const code of ["", "abc", "x".repeat(40), "AB CD", 5, null]) expect((await call(relay, "POST", "/api/aiking/relay/enroll", { code })).status).toBe(400);
    expect(f.enroll).not.toHaveBeenCalled();
  });

  it("explains a wrong code and a network failure in words", async () => {
    const wrong = fixture({ enroll: async () => { throw new Error("invalid_code"); } }); const relay = wrong.make();
    const bad = await call(relay, "POST", "/api/aiking/relay/enroll", { code: "ABCD-EFGH-JKLM" });
    expect(bad.status).toBe(404); expect(String((bad.payload as { error: string }).error)).toMatch(/not right or has expired/);
    expect(relay.status().configured).toBe(false);
    const offline = fixture({ enroll: async () => { throw new TypeError("fetch failed"); } });
    const down = await call(offline.make(), "POST", "/api/aiking/relay/enroll", { code: "ABCD-EFGH-JKLM" });
    expect(down.status).toBe(502); expect(String((down.payload as { error: string }).error)).toMatch(/Check the internet/);
  });

  it("cannot be connected or disconnected through the relay itself", async () => {
    const f = fixture(); const relay = f.make(); await relay.enrollWith("ABCD-EFGH-JKLM", "Lan");
    const marked = { [RELAYED_HEADER]: f.started[0]!.markHeader!.value };
    expect((await call(relay, "DELETE", "/api/aiking/relay", undefined, marked)).status).toBe(403);
    expect((await call(relay, "POST", "/api/aiking/relay/enroll", { code: "ABCD-EFGH-JKLM" }, marked)).status).toBe(403);
    expect(relay.status().configured).toBe(true);
    expect((await call(relay, "GET", "/api/aiking/relay/status", undefined, marked)).status).toBe(200); // reading is fine
  });

  it("joins with the account this computer is signed in to: no code, no second sign-in", async () => {
    const dir = temp(); const started: RelayConnectorOptions[] = [];
    const enrollAccount = vi.fn(async (_url: string, token: string, name: string) => ({ hostId: "host-from-account", token: `relay-for-${token}`, name }));
    let signedIn: string | null = null;
    const relay = createRelay({ file: join(dir, "relay.json"), port: 18799, accountToken: () => signedIn, enrollAccount, connect: (options) => { started.push(options); return { stop: () => undefined, state: () => "online" as const, sendSignal: () => undefined }; } });
    expect(relay.status().canJoinWithAccount).toBe(false);
    expect((await call(relay, "POST", "/api/aiking/relay/enroll-account", { name: "Laptop" })).status).toBe(401);
    signedIn = "account-session";
    expect(relay.status().canJoinWithAccount).toBe(true);
    const result = await call(relay, "POST", "/api/aiking/relay/enroll-account", { name: "Laptop" });
    expect(result.status).toBe(200);
    expect(result.payload).toMatchObject({ configured: true, state: "online", name: "Laptop", canJoinWithAccount: true });
    expect(JSON.stringify(result.payload)).not.toContain("relay-for");
    expect(enrollAccount).toHaveBeenCalledWith(DEFAULT_RELAY_URL, "account-session", "Laptop");
    expect(started[0]).toMatchObject({ hostId: "host-from-account", token: "relay-for-account-session" });
    // through the relay itself this is refused like the other management calls
    const marked = { [RELAYED_HEADER]: started[0]!.markHeader!.value };
    expect((await call(relay, "POST", "/api/aiking/relay/enroll-account", { name: "x" }, marked)).status).toBe(403);
  });

  it("uses AIKING_RELAY_URL for a custom domain", () => {
    vi.stubEnv("AIKING_RELAY_URL", "https://relay.example.vn/");
    try { expect(fixture().make().status().relayUrl).toBe("https://relay.example.vn"); } finally { vi.unstubAllEnvs(); }
  });
});

describe("remote P2P inbox/outbox (rc8 §9.1 slice B)", () => {
  it("returns 404 for p2p routes when the flag is off", async () => {
    const f = fixture();
    const relay = createRelay({
      file: f.file, port: 18799, remoteP2p: false,
      enroll: f.enroll,
      connect: (options) => { f.started.push(options); return { stop: f.stops, state: () => "online" as const, sendSignal: () => undefined }; },
    });
    const result = await call(relay, "GET", "/api/aiking/remote/p2p/status");
    expect(result.handled).toBe(true);
    expect(result.status).toBe(404);
    relay.stop();
  });

  it("queues onSignal frames into inbox and drains them", async () => {
    const f = fixture();
    const sent: unknown[] = [];
    const relay = createRelay({
      file: f.file, port: 18799, remoteP2p: true,
      enroll: f.enroll,
      connect: (options) => {
        f.started.push(options);
        // Simulate worker → host signal
        options.onSignal?.({ t: "signal", sid: "s1", kind: "offer", from: "viewer", sdp: "v=0" });
        return {
          stop: f.stops,
          state: () => "online" as const,
          sendSignal: (frame) => { sent.push(frame); },
        };
      },
    });
    await relay.enrollWith("ABCD-EFGH-JKLM", "P2P");
    const status = await call(relay, "GET", "/api/aiking/remote/p2p/status");
    expect(status.status).toBe(200);
    expect((status.payload as { enabled: boolean; pending: number }).enabled).toBe(true);
    expect((status.payload as { pending: number }).pending).toBeGreaterThanOrEqual(1);

    const inbox = await call(relay, "GET", "/api/aiking/remote/p2p/inbox");
    expect(inbox.status).toBe(200);
    const frames = (inbox.payload as { frames: unknown[] }).frames;
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0]).toMatchObject({ kind: "offer", from: "viewer" });

    const empty = await call(relay, "GET", "/api/aiking/remote/p2p/inbox");
    expect((empty.payload as { frames: unknown[] }).frames).toEqual([]);

    const out = await call(relay, "POST", "/api/aiking/remote/p2p/outbox", {
      t: "signal", sid: "s1", kind: "answer", from: "host", sdp: "answer",
    });
    expect(out.status).toBe(200);
    expect(sent.at(-1)).toMatchObject({ kind: "answer", from: "host" });

    const pathSet = await call(relay, "POST", "/api/aiking/remote/p2p/path", { path: "p2p" });
    expect(pathSet.status).toBe(200);
    const again = await call(relay, "GET", "/api/aiking/remote/p2p/status");
    expect((again.payload as { path: string }).path).toBe("p2p");
    relay.stop();
  });

  it("refuses p2p mutations when the request is relayed", async () => {
    const f = fixture();
    const relay = createRelay({
      file: f.file, port: 18799, remoteP2p: true,
      enroll: f.enroll,
      connect: (options) => { f.started.push(options); return { stop: f.stops, state: () => "online" as const, sendSignal: () => undefined }; },
    });
    await relay.enrollWith("ABCD-EFGH-JKLM", "P2P");
    const result = await call(relay, "POST", "/api/aiking/remote/p2p/outbox", { t: "signal", kind: "ice" }, { [RELAYED_HEADER]: "1" });
    expect(result.status).toBe(403);
    relay.stop();
  });

  it("switching to relay is reflected on status", async () => {
    const f = fixture();
    const relay = createRelay({
      file: f.file, port: 18799, remoteP2p: true,
      enroll: f.enroll,
      connect: (options) => { f.started.push(options); return { stop: f.stops, state: () => "online" as const, sendSignal: () => undefined }; },
    });
    await relay.enrollWith("ABCD-EFGH-JKLM", "P2P");
    const switching = await call(relay, "POST", "/api/aiking/remote/p2p/path", { path: "relay", switching: true });
    expect(switching.status).toBe(200);
    expect(switching.payload).toMatchObject({ path: "relay", switching: true });
    const status = await call(relay, "GET", "/api/aiking/remote/p2p/status");
    expect(status.payload).toMatchObject({ path: "relay", switching: true });
    const settled = await call(relay, "POST", "/api/aiking/remote/p2p/path", { path: "relay", switching: false });
    expect(settled.payload).toMatchObject({ path: "relay", switching: false });
    const again = await call(relay, "GET", "/api/aiking/remote/p2p/status");
    expect(again.payload).toMatchObject({ path: "relay", switching: false });
    relay.stop();
  });
});

