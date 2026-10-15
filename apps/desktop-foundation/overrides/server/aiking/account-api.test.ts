// Copyright (c) 2026 AIKING.
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createEmailSignIn } from "../account-signin.ts";
import { accountApiOrigin, createAikingAccountClient, normalizeAccountCode } from "./account-api.ts";

/** The Auth API contract as deployed: start returns a challenge, verify needs it and the code, logout takes the bearer. */
async function startAuthApiStub() {
  const calls: Array<{ method: string; path: string; body: unknown; authorization?: string }> = [];
  const code = "ABCD-EFGH";
  let challenge = 0;
  const read = (req: IncomingMessage) => new Promise<unknown>((resolve) => {
    let raw = ""; req.on("data", (chunk) => { raw += chunk; }); req.on("end", () => resolve(raw ? JSON.parse(raw) : null));
  });
  const server = createServer(async (req, res) => {
    const body = await read(req) as Record<string, string> | null;
    calls.push({ method: req.method ?? "", path: req.url ?? "", body, authorization: req.headers.authorization });
    const send = (status: number, payload: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
    if (req.url === "/v1/auth/email/start") {
      if (body?.email === "limited@example.test") return send(429, { error: { code: "rate_limited", message: "Too many requests." } });
      return send(200, { challengeId: `challenge-${++challenge}`, expiresAt: Date.now() + 600_000, resendAt: Date.now() + 60_000 });
    }
    if (req.url === "/v1/auth/email/verify") {
      if (body?.challengeId !== `challenge-${challenge}` || body?.code !== code) return send(400, { error: { code: "invalid_sign_in_code", message: "The sign-in code is incorrect." } });
      const email = calls.filter((call) => call.path === "/v1/auth/email/start").at(-1)?.body as { email: string };
      return send(200, { sessionToken: "account-session-token", user: { id: "user-1", email: email.email, name: null } });
    }
    if (req.url === "/v1/auth/logout") { res.writeHead(204); res.end(); return; }
    send(404, { error: { code: "not_found", message: "Not found." } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, code, calls, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe("the AIKINGBOT Auth API client", () => {
  it("accepts only https or loopback origins and the 8-symbol code alphabet", () => {
    expect(accountApiOrigin("https://auth.example.test/v1")).toBe("https://auth.example.test");
    expect(accountApiOrigin("http://auth.example.test")).toBeNull();
    expect(accountApiOrigin("https://user:pass@auth.example.test")).toBeNull();
    expect(normalizeAccountCode("abcd efgh")).toBe("ABCD-EFGH");
    expect(normalizeAccountCode("ABCD-EFG")).toBeNull();
    expect(normalizeAccountCode("ABCD-EFG0")).toBeNull();
  });

  it("keeps the challenge on the server and signs the account session out after use", async () => {
    const stub = await startAuthApiStub();
    try {
      const client = createAikingAccountClient({ baseURL: stub.url });
      await expect(client.verifyOTP("her@example.test", stub.code)).rejects.toMatchObject({ code: "challenge_expired", status: 401 });
      await client.requestOTP("Her@Example.test");
      await expect(client.verifyOTP("her@example.test", "WXYZ-WXYZ")).rejects.toMatchObject({ code: "invalid_sign_in_code", status: 400 });
      const verified = await client.verifyOTP("her@example.test", "abcd-efgh");
      expect(verified).toEqual({ accountToken: "account-session-token", user: { id: "user-1", email: "her@example.test" } });
      await client.signOut(verified.accountToken);
      expect(stub.calls.at(-1)).toMatchObject({ path: "/v1/auth/logout", authorization: "Bearer account-session-token" });
    } finally {
      await stub.close();
    }
  });

  it("drives the workspace sign-in: members get their scopes, others are refused before any email is sent", async () => {
    const stub = await startAuthApiStub();
    try {
      const signIn = createEmailSignIn({
        allow: { admins: ["owner@example.test"], members: ["@team.test", "limited@example.test"] },
        env: { AIKING_ACCOUNT_API_URL: stub.url },
      });
      expect(await signIn.start("stranger@example.test")).toMatchObject({ ok: false, status: 403, error: expect.stringMatching(/not a member of this workspace/) });
      expect(stub.calls).toHaveLength(0);
      expect(await signIn.start("limited@example.test")).toMatchObject({ ok: false, status: 429 });
      expect(await signIn.start("owner@example.test")).toEqual({ ok: true });
      expect(await signIn.verify("owner@example.test", "12")).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/8-character/) });
      expect(await signIn.verify("owner@example.test", "WXYZ-WXYZ")).toMatchObject({ ok: false, status: 401 });
      expect(await signIn.verify("owner@example.test", stub.code)).toEqual({ ok: true, email: "owner@example.test", userId: "user-1", scopes: ["admin", "client"] });
      expect(await signIn.start("someone@team.test")).toEqual({ ok: true });
      expect(await signIn.verify("someone@team.test", stub.code)).toMatchObject({ ok: true, scopes: ["client"] });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(stub.calls.filter((call) => call.path === "/v1/auth/logout")).toHaveLength(2);
    } finally {
      await stub.close();
    }
  });
});
