import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { buildRequestUserInfoPayload, sendRequestUserInfo } from "../../src/zalo-oa/requestInfoSender.js";

describe("buildRequestUserInfoPayload", () => {
  it("builds the request_user_info template payload", () => {
    expect(buildRequestUserInfoPayload("u1", { title: "T", subtitle: "S", imageUrl: "https://x/y.png" })).toEqual({
      recipient: { user_id: "u1" },
      message: { attachment: { type: "template", payload: {
        template_type: "request_user_info",
        elements: [{ title: "T", subtitle: "S", image_url: "https://x/y.png" }],
      } } },
    });
  });
});

describe("sendRequestUserInfo", () => {
  let agent: MockAgent;
  beforeEach(() => { agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent); });
  afterEach(async () => { await agent.close(); });
  const base = "https://openapi.zalo.me";

  it("posts to the CS message endpoint and reports success", async () => {
    let sentBody = "";
    agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
      .reply(200, (opts) => { sentBody = String(opts.body ?? ""); return { error: 0, data: { message_id: "m1" } }; });
    const res = await sendRequestUserInfo(async () => "AT", "u1", { title: "T", subtitle: "S", imageUrl: "https://x/y.png" });
    expect(res).toEqual({ ok: true, code: 0, message: "" });
    expect(sentBody).toContain("request_user_info");
  });

  it("reports a Zalo error code without throwing", async () => {
    agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
      .reply(200, { error: -213, message: "quota exceeded" });
    const res = await sendRequestUserInfo(async () => "AT", "u1", { title: "T", subtitle: "S", imageUrl: "https://x/y.png" });
    expect(res).toEqual({ ok: false, code: -213, message: "quota exceeded" });
  });
});
