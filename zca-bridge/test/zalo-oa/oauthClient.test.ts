import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { OaOAuthClient } from "../../src/zalo-oa/oauthClient.js";

let agent: MockAgent;
beforeEach(() => { agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent); });
afterEach(async () => { await agent.close(); });

const base = "https://oauth.zaloapp.com";

describe("OaOAuthClient", () => {
  it("exchanges an authorization code for tokens", async () => {
    let body = ""; let secret = "";
    agent.get(base).intercept({ path: "/v4/oa/access_token", method: "POST" })
      .reply(200, (opts) => { body = String(opts.body); secret = String(opts.headers.secret_key); return { access_token: "AT", refresh_token: "RT", expires_in: "3600" }; });
    const c = new OaOAuthClient("APPID", "SECRET");
    const res = await c.exchangeCode("CODE123");
    expect(res).toMatchObject({ accessToken: "AT", refreshToken: "RT", expiresInSec: 3600 });
    expect(secret).toBe("SECRET");
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=CODE123");
    expect(body).toContain("app_id=APPID");
  });

  it("refreshes using a refresh token", async () => {
    let body = "";
    agent.get(base).intercept({ path: "/v4/oa/access_token", method: "POST" })
      .reply(200, (opts) => { body = String(opts.body); return { access_token: "AT2", refresh_token: "RT2", expires_in: "3600" }; });
    const c = new OaOAuthClient("APPID", "SECRET");
    const res = await c.refresh("OLDRT");
    expect(res.accessToken).toBe("AT2");
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=OLDRT");
  });

  it("throws on a Zalo error payload", async () => {
    agent.get(base).intercept({ path: "/v4/oa/access_token", method: "POST" })
      .reply(200, { error: -201, message: "invalid code" });
    const c = new OaOAuthClient("APPID", "SECRET");
    await expect(c.exchangeCode("BAD")).rejects.toThrow(/invalid code|-201/);
  });
});
