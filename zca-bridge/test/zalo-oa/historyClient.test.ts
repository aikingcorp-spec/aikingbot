import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { listRecentChat, getConversationMessages } from "../../src/zalo-oa/historyClient.js";

let agent: MockAgent;
beforeEach(() => { agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent); });
afterEach(async () => { await agent.close(); });
const base = "https://openapi.zalo.me";

describe("listRecentChat", () => {
  it("GETs listrecentchat and maps entries to {userId,lastTimeMs}, deriving the non-OA party", async () => {
    let sentToken = "";
    let sentPath = "";
    agent.get(base).intercept({ path: (p) => p.startsWith("/v2.0/oa/listrecentchat"), method: "GET" })
      .reply(200, (opts) => { sentToken = String(opts.headers["access_token"] ?? ""); sentPath = String(opts.path ?? ""); return {
        error: 0, data: [
          { src: 1, time: 200, from_id: "user-A", to_id: "OA1" },
          { src: 0, time: 150, from_id: "OA1", to_id: "user-B" },
        ] }; });
    const res = await listRecentChat(async () => "AT", "OA1", 0, 10);
    expect(sentToken).toBe("AT");
    // Regression guard: these read endpoints live under v2.0 (v3.0 returns Zalo error 404 "invalid API").
    expect(sentPath.startsWith("/v2.0/oa/listrecentchat")).toBe(true);
    expect(res).toEqual([
      { userId: "user-A", lastTimeMs: 200 },
      { userId: "user-B", lastTimeMs: 150 },
    ]);
  });

  it("returns [] when Zalo reports an error code is absent and data missing", async () => {
    agent.get(base).intercept({ path: (p) => p.startsWith("/v2.0/oa/listrecentchat"), method: "GET" })
      .reply(200, { error: 0, data: [] });
    expect(await listRecentChat(async () => "AT", "OA1", 0, 10)).toEqual([]);
  });
});

describe("getConversationMessages", () => {
  it("GETs conversation for a user and returns the raw message array", async () => {
    let sentPath = "";
    agent.get(base).intercept({ path: (p) => p.startsWith("/v2.0/oa/conversation"), method: "GET" })
      .reply(200, (opts) => { sentPath = String(opts.path ?? ""); return { error: 0, data: [{ message_id: "m1", src: 1, time: 300, type: "text", message: "hi" }] }; });
    const res = await getConversationMessages(async () => "AT", "user-A", 0, 10);
    expect(res).toEqual([{ message_id: "m1", src: 1, time: 300, type: "text", message: "hi" }]);
    // Regression guard: conversation read endpoint is v2.0, not v3.0.
    expect(sentPath.startsWith("/v2.0/oa/conversation")).toBe(true);
  });

  it("throws on a Zalo error code", async () => {
    agent.get(base).intercept({ path: (p) => p.startsWith("/v2.0/oa/conversation"), method: "GET" })
      .reply(200, { error: -216, message: "token expired" });
    await expect(getConversationMessages(async () => "AT", "user-A", 0, 10)).rejects.toThrow(/-216/);
  });
});
