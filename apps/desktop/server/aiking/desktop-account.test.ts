import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPlaneError } from "../../electron/control-plane-client.mjs";
import { createDesktopAccount } from "./desktop-account.ts";
import { RELAYED_HEADER } from "./relay.ts";
import { removeTempDir } from "../testing/cleanup.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) removeTempDir(dir); });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "acct-")); dirs.push(dir); return dir; };

function fixture(overrides: Partial<{ requestOTP: (email: string) => Promise<unknown>; verifyOTP: (email: string, code: string) => Promise<unknown>; signOut: (token: string) => Promise<void> }> = {}) {
  const file = join(temp(), "account.json");
  const client = {
    requestOTP: vi.fn(overrides.requestOTP ?? (async (email: string) => ({ email }))),
    verifyOTP: vi.fn(overrides.verifyOTP ?? (async (email: string) => ({ accountToken: "session-token", user: { id: "user-1", email } }))),
    signOut: vi.fn(overrides.signOut ?? (async () => undefined)),
  };
  return { file, client, make: () => createDesktopAccount({ file, client: client as never }) };
}
async function call(account: ReturnType<typeof createDesktopAccount>, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  let status = 0; let payload: any;
  const res = { setHeader: () => undefined } as unknown as ServerResponse;
  const handled = await account.handle({ req: { headers } as unknown as IncomingMessage, res, path, method, json: (_r, code, value) => { status = code; payload = value; }, readBody: async () => body });
  return { handled, status, payload };
}

describe("signing in on the desktop, inside the app", () => {
  it("starts signed out and ignores other paths", async () => {
    const f = fixture(); const account = f.make();
    expect(account.status()).toEqual({ signedIn: false });
    expect((await call(account, "GET", "/api/aiking/other")).handled).toBe(false);
    expect((await call(account, "GET", "/api/aiking/account/status")).payload).toEqual({ signedIn: false });
  });

  it("asks for a code, then signs in once and remembers it (0600, token never in the answer)", async () => {
    const f = fixture(); const account = f.make();
    expect((await call(account, "POST", "/api/aiking/account/otp", { email: "Lan@Example.com" })).status).toBe(200);
    expect(f.client.requestOTP).toHaveBeenCalledWith("Lan@Example.com");
    const verified = await call(account, "POST", "/api/aiking/account/verify", { email: "lan@example.com", code: "ABCD-EFGH" });
    expect(verified.status).toBe(200);
    expect(verified.payload).toEqual({ signedIn: true, email: "lan@example.com" });
    expect(JSON.stringify(verified.payload)).not.toContain("session-token");
    if (process.platform !== "win32") expect(statSync(f.file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(f.file, "utf8"))).toMatchObject({ userId: "user-1", token: "session-token" });
    expect(account.token()).toBe("session-token");
  });

  it("is still signed in after the app restarts, and signing out forgets everything", async () => {
    const f = fixture(); const first = f.make();
    await call(first, "POST", "/api/aiking/account/verify", { email: "lan@example.com", code: "ABCD-EFGH" });
    const again = f.make();
    expect(again.status()).toEqual({ signedIn: true, email: "lan@example.com" });
    const out = await call(again, "POST", "/api/aiking/account/logout");
    expect(out.payload).toEqual({ signedIn: false });
    expect(f.client.signOut).toHaveBeenCalledWith("session-token");
    expect(existsSync(f.file)).toBe(false);
    expect(f.make().status()).toEqual({ signedIn: false });
  });

  it("says in words and codes what went wrong, and does not sign in", async () => {
    const wrong = fixture({ verifyOTP: async () => { throw new ControlPlaneError("invalid_otp", 401); } });
    const bad = await call(wrong.make(), "POST", "/api/aiking/account/verify", { email: "lan@example.com", code: "0000-0000" });
    expect(bad.status).toBe(401); expect(bad.payload.code).toBe("invalid_otp");
    expect(existsSync(wrong.file)).toBe(false);
    const email = fixture({ requestOTP: async () => { throw new ControlPlaneError("invalid_email"); } });
    expect((await call(email.make(), "POST", "/api/aiking/account/otp", { email: "nope" })).payload.code).toBe("invalid_email");
    const slow = fixture({ requestOTP: async () => { throw new ControlPlaneError("http_429", 429); } });
    expect((await call(slow.make(), "POST", "/api/aiking/account/otp", { email: "lan@example.com" })).status).toBe(429);
    const down = fixture({ requestOTP: async () => { throw new ControlPlaneError("network_unavailable"); } });
    const unreachable = await call(down.make(), "POST", "/api/aiking/account/otp", { email: "lan@example.com" });
    expect(unreachable.status).toBe(502); expect(unreachable.payload.error).toMatch(/Check the internet/);
  });

  it("cannot be signed in or out through the web relay", async () => {
    const f = fixture(); const account = f.make();
    const relayed = { [RELAYED_HEADER]: "x" };
    expect((await call(account, "POST", "/api/aiking/account/otp", { email: "lan@example.com" }, relayed)).status).toBe(403);
    expect((await call(account, "POST", "/api/aiking/account/logout", undefined, relayed)).status).toBe(403);
    expect((await call(account, "GET", "/api/aiking/account/status", undefined, relayed)).status).toBe(200);
    expect(f.client.requestOTP).not.toHaveBeenCalled();
  });
});
