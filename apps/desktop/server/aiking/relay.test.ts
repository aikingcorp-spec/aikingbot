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
  const make = () => createRelay({ file: join(dir, "relay.json"), port: 18799, enroll, connect: (options) => { started.push(options); return { stop: stops, state: () => "online" as const }; } });
  return { dir, file: join(dir, "relay.json"), started, stops, enroll, make };
}
async function call(relay: ReturnType<typeof createRelay>, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  let status = 0; let payload: unknown;
  const res = { setHeader: () => undefined } as unknown as ServerResponse;
  const handled = await relay.handle({ req: { headers } as unknown as IncomingMessage, res, path, method, json: (_res, code, value) => { status = code; payload = value; }, readBody: async () => body });
  return { handled, status, payload };
}

describe("the web connection", () => {
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

  it("can be disconnected, which stops the link and forgets the credentials", async () => {
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
    const relay = createRelay({ file: join(dir, "relay.json"), port: 18799, accountToken: () => signedIn, enrollAccount, connect: (options) => { started.push(options); return { stop: () => undefined, state: () => "online" as const }; } });
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
