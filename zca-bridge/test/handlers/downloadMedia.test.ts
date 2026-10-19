import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { downloadMedia } from "../../src/handlers/inbound.js";

let agent: MockAgent;
beforeEach(() => { agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent); });
afterEach(async () => { await agent.close(); });

const cdn = "https://cdn.zalo.test";

describe("downloadMedia", () => {
  it("follows a redirect to the real object and returns the bytes", async () => {
    agent.get(cdn).intercept({ path: "/img/abc.jpg", method: "GET" })
      .reply(302, "", { headers: { location: `${cdn}/store/abc.jpg`, "content-type": "image/jpeg" } });
    agent.get(cdn).intercept({ path: "/store/abc.jpg", method: "GET" })
      .reply(200, Buffer.from("JPEGDATA"), { headers: { "content-type": "image/jpeg" } });

    const out = await downloadMedia(`${cdn}/img/abc.jpg`);
    expect(out.bytes.toString()).toBe("JPEGDATA");
    expect(out.contentType).toBe("image/jpeg");
  });

  it("throws on an empty body so the broken image is not archived", async () => {
    agent.get(cdn).intercept({ path: "/img/empty.jpg", method: "GET" })
      .reply(200, "", { headers: { "content-type": "image/jpeg" } });

    await expect(downloadMedia(`${cdn}/img/empty.jpg`)).rejects.toThrow(/empty body/);
  });

  it("throws on a 4xx/5xx status", async () => {
    agent.get(cdn).intercept({ path: "/img/gone.jpg", method: "GET" })
      .reply(404, "nope");

    await expect(downloadMedia(`${cdn}/img/gone.jpg`)).rejects.toThrow(/download failed \(404\)/);
  });
});
