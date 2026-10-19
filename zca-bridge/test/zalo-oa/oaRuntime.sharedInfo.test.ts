import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { fetchUserProfile } from "../../src/zalo-oa/oaRuntime.js";

let agent: MockAgent;
beforeEach(() => { agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent); });
afterEach(async () => { await agent.close(); });
const base = "https://openapi.zalo.me";

describe("fetchUserProfile shared_info", () => {
  it("returns sharedInfo when user/detail includes a shared_info block", async () => {
    agent.get(base).intercept({ path: (p) => p.startsWith("/v3.0/oa/user/detail"), method: "GET" })
      .reply(200, { data: { display_name: "A", avatar: "http://a/x.jpg", shared_info: { phone: "0900", address: "1 Le Loi" } } });
    const p = await fetchUserProfile("AT", "u1");
    expect(p).toEqual({ displayName: "A", avatar: "http://a/x.jpg", sharedInfo: { phone: "0900", address: "1 Le Loi" } });
  });

  it("omits sharedInfo when none is present", async () => {
    agent.get(base).intercept({ path: (p) => p.startsWith("/v3.0/oa/user/detail"), method: "GET" })
      .reply(200, { data: { display_name: "A", avatar: "http://a/x.jpg" } });
    const p = await fetchUserProfile("AT", "u1");
    expect(p).toEqual({ displayName: "A", avatar: "http://a/x.jpg" });
  });
});
