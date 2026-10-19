import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerOaOAuthRoutes } from "../../src/zalo-oa/oauthRoute.js";
import { deriveSessionSecret, signSession } from "../../src/admin/auth.js";

const secret = deriveSessionSecret(Buffer.alloc(32, 3));
const cookie = `sid=${signSession("admin", secret)}`;

function build(over: any = {}) {
  const app = Fastify();
  const oauth = { permissionUrl: vi.fn(() => "https://oauth.zaloapp.com/perm?x=1"), exchangeCode: vi.fn(async () => ({ accessToken: "AT", refreshToken: "RT", expiresInSec: 3600 })) };
  const tokens = { save: vi.fn(async () => {}) };
  const accounts = { setOaId: vi.fn(async () => {}), updateStatus: vi.fn(async () => {}) };
  const profile = vi.fn(async () => "oa55");
  const onConnected = vi.fn(() => {});
  registerOaOAuthRoutes(app, { oauth: oauth as any, tokens: tokens as any, accounts: accounts as any, redirectUri: "https://b/cb", sessionSecret: secret, fetchOaId: profile, onConnected, ...over });
  return { app, oauth, tokens, accounts, profile, onConnected };
}

describe("OA OAuth routes", () => {
  it("redirects to the Zalo permission url for an authenticated admin", async () => {
    const { app, oauth } = build();
    const res = await app.inject({ method: "GET", url: "/admin/oa/connect?accountId=5", headers: { cookie } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("oauth.zaloapp.com");
    expect(oauth.permissionUrl).toHaveBeenCalledWith("https://b/cb", "5");
  });

  it("redirects to /admin/ when there is no valid session", async () => {
    const { app } = build();
    const res = await app.inject({ method: "GET", url: "/admin/oa/connect?accountId=5" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/admin/");
  });

  it("exchanges the code and stores tokens on callback", async () => {
    const { app, tokens, accounts, onConnected } = build();
    const res = await app.inject({ method: "GET", url: "/oa/oauth/callback?code=C&state=5" });
    expect(res.statusCode).toBe(302);
    expect(tokens.save).toHaveBeenCalledWith(5, { accessToken: "AT", refreshToken: "RT" }, expect.any(Date));
    expect(accounts.setOaId).toHaveBeenCalledWith(5, "oa55");
    expect(accounts.updateStatus).toHaveBeenCalledWith(5, "connected");
    expect(onConnected).toHaveBeenCalledWith(5);
  });
});
