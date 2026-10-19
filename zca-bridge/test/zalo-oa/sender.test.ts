import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { OaSender, OaWindowError, OaSendError, OaPermanentError } from "../../src/zalo-oa/sender.js";
import { ZaloThreadKind, QuoteSource, ZaloFileRejectedError } from "../../src/zalo/types.js";
import sharp from "sharp";
import { randomBytes } from "node:crypto";

function quote(msgId: string): QuoteSource {
  return { uidFrom: "u1", msgId, cliMsgId: "", msgType: "user_send_text", ts: "0", content: "", ttl: 0 };
}

let agent: MockAgent;
beforeEach(() => { agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent); });
afterEach(async () => { await agent.close(); });
const base = "https://openapi.zalo.me";

describe("OaSender.sendAttachment", () => {
  it("uploads as multipart and returns message id", async () => {
    let uploadContentType = "";
    agent.get(base).intercept({ path: "/v2.0/oa/upload/image", method: "POST" })
      .reply(200, (opts) => {
        uploadContentType = String(opts.headers["content-type"] ?? "");
        return { error: 0, data: { attachment_id: "att1" } };
      });
    agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
      .reply(200, { error: 0, data: { message_id: "zmid" } });

    const sender = new OaSender(async () => "AT");
    const res = await sender.sendAttachment("u1", ZaloThreadKind.OaUser, { filename: "pic.png", data: Buffer.from("x") }, "caption");
    expect(res).toEqual({ msgId: "zmid" });
    expect(uploadContentType).toMatch(/^multipart\/form-data/);
  });

  it("rejects with ZaloFileRejectedError carrying the filename when image upload returns no attachment_id", async () => {
    agent.get(base).intercept({ path: "/v2.0/oa/upload/image", method: "POST" })
      .reply(200, { error: -201, message: "file is invalid" });
    const sender = new OaSender(async () => "AT");
    const err = sender.sendAttachment("u1", ZaloThreadKind.OaUser, { filename: "pic.png", data: Buffer.from("x") }, "");
    await expect(err).rejects.toBeInstanceOf(ZaloFileRejectedError);
    await expect(err).rejects.toThrow(/OA upload failed/);
    await expect(err).rejects.toHaveProperty("filename", "pic.png");
  });
});

describe("OaSender.sendAttachment (non-image file)", () => {
  it("uploads via /upload/file and sends a file attachment message", async () => {
    let uploadPath = ""; let sendBody = "";
    agent.get(base).intercept({ path: "/v2.0/oa/upload/file", method: "POST" })
      .reply(200, (opts) => { uploadPath = String(opts.path); return { error: 0, data: { token: "ftok" } }; });
    agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
      .reply(200, (opts) => { sendBody = String(opts.body); return { error: 0, data: { message_id: "fmid" } }; });

    const sender = new OaSender(async () => "AT");
    const res = await sender.sendAttachment("u1", ZaloThreadKind.OaUser, { filename: "report.pdf", data: Buffer.from("PDFDATA") }, "");
    expect(res).toEqual({ msgId: "fmid" });
    expect(uploadPath).toBe("/v2.0/oa/upload/file");
    expect(sendBody).toContain('"type":"file"');
    expect(sendBody).toContain('"token":"ftok"');
  });

  it("rejects with ZaloFileRejectedError when file upload returns no token", async () => {
    agent.get(base).intercept({ path: "/v2.0/oa/upload/file", method: "POST" })
      .reply(200, { error: -201, message: "file is invalid" });
    const sender = new OaSender(async () => "AT");
    const err = sender.sendAttachment("u1", ZaloThreadKind.OaUser, { filename: "doc.xyz", data: Buffer.from("x") }, "");
    await expect(err).rejects.toBeInstanceOf(ZaloFileRejectedError);
    await expect(err).rejects.toThrow(/OA file upload failed/);
    await expect(err).rejects.toHaveProperty("filename", "doc.xyz");
  });
});

describe("OaSender.sendText", () => {
  it("posts a text message and returns the message id", async () => {
    let body = ""; let token = "";
    agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
      .reply(200, (opts) => { body = String(opts.body); token = String(opts.headers.access_token); return { error: 0, data: { message_id: "zmid" } }; });
    const sender = new OaSender(async () => "AT");
    const res = await sender.sendText("u1", ZaloThreadKind.OaUser, "hello");
    expect(res).toEqual({ msgId: "zmid" });
    expect(token).toBe("AT");
    expect(body).toContain('"user_id":"u1"');
    expect(body).toContain('"text":"hello"');
  });

  it("throws OaWindowError on a real out-of-window / cannot-reach-user code", async () => {
    for (const code of [-230, -232, -213, -217, -227, -234, -244]) {
      agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
        .reply(200, { error: code, message: "cannot send" });
      const sender = new OaSender(async () => "AT");
      await expect(sender.sendText("u1", ZaloThreadKind.OaUser, "hi")).rejects.toBeInstanceOf(OaWindowError);
    }
  });

  it("throws OaSendError (retryable) on a rate-limit / expired-id code", async () => {
    for (const code of [-32, -100]) {
      agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
        .reply(200, { error: code, message: "retry me" });
      const sender = new OaSender(async () => "AT");
      const err = sender.sendText("u1", ZaloThreadKind.OaUser, "hi");
      await expect(err).rejects.toBeInstanceOf(OaSendError);
      await expect(err).rejects.not.toBeInstanceOf(OaPermanentError);
    }
  });

  it("throws OaPermanentError (no retry) on a permanent/unknown app error", async () => {
    for (const code of [-211, -201, -248, -999]) {
      agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
        .reply(200, { error: code, message: "rejected" });
      const sender = new OaSender(async () => "AT");
      const err = sender.sendText("u1", ZaloThreadKind.OaUser, "hi");
      await expect(err).rejects.toBeInstanceOf(OaPermanentError);
      await expect(err).rejects.not.toBeInstanceOf(OaWindowError);
    }
  });

  it("includes quote_message_id when a quote is provided", async () => {
    let body = "";
    agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
      .reply(200, (opts) => { body = String(opts.body); return { error: 0, data: { message_id: "zmid" } }; });
    const sender = new OaSender(async () => "AT");
    const res = await sender.sendText("u1", ZaloThreadKind.OaUser, "hi", quote("qm1"));
    expect(res).toEqual({ msgId: "zmid" });
    expect(body).toContain('"quote_message_id":"qm1"');
  });

  it("omits quote_message_id when the quote msgId is empty/whitespace", async () => {
    let body = "";
    agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
      .reply(200, (opts) => { body = String(opts.body); return { error: 0, data: { message_id: "zmid" } }; });
    const sender = new OaSender(async () => "AT");
    await sender.sendText("u1", ZaloThreadKind.OaUser, "hi", quote("   "));
    expect(body).not.toContain("quote_message_id");
  });

  it("falls back to an unquoted send when Zalo rejects the quote", async () => {
    const bodies: string[] = [];
    agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
      .reply(200, (opts) => {
        const body = String(opts.body); bodies.push(body);
        return body.includes("quote_message_id")
          ? { error: -1, message: "invalid quote message id" }
          : { error: 0, data: { message_id: "ok" } };
      }).times(2);
    const sender = new OaSender(async () => "AT");
    const res = await sender.sendText("u1", ZaloThreadKind.OaUser, "hi", quote("stale"));
    expect(res).toEqual({ msgId: "ok" });
    expect(bodies.length).toBe(2);
    expect(bodies[0]).toContain("quote_message_id");
    expect(bodies[1]).not.toContain("quote_message_id");
  });

  it("does NOT fall back on a window error for a quoted send", async () => {
    let calls = 0;
    agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
      .reply(200, () => { calls++; return { error: -230, message: "no interaction in 7 days" }; }).persist();
    const sender = new OaSender(async () => "AT");
    await expect(sender.sendText("u1", ZaloThreadKind.OaUser, "hi", quote("qm1"))).rejects.toBeInstanceOf(OaWindowError);
    expect(calls).toBe(1);
  });

  it("does NOT fall back on a transport error for a quoted send", async () => {
    // getAccessToken throwing makes send() reject before any HTTP call, with a non-OaSendError.
    // A wrongful fallback would call send() (and thus the token provider) a second time.
    let tokenCalls = 0;
    const sender = new OaSender(async () => { tokenCalls++; throw new Error("token boom"); });
    await expect(sender.sendText("u1", ZaloThreadKind.OaUser, "hi", quote("qm1"))).rejects.toThrow(/token boom/);
    expect(tokenCalls).toBe(1);
  });
});

describe("OaSender.sendImage compression", () => {
  it("uploads a small image unchanged (no compression path)", async () => {
    let bodyLen = 0;
    agent.get(base).intercept({ path: "/v2.0/oa/upload/image", method: "POST" })
      .reply(200, (opts) => { bodyLen = (opts.body as Buffer).length; return { error: 0, data: { attachment_id: "att1" } }; });
    agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
      .reply(200, { error: 0, data: { message_id: "m" } });
    const small = Buffer.from("tiny-image-bytes");
    const sender = new OaSender(async () => "AT");
    await sender.sendAttachment("u1", ZaloThreadKind.OaUser, { filename: "p.png", data: small }, "");
    // multipart wraps the original bytes with only boundary overhead — not a re-encoded image
    expect(bodyLen).toBeGreaterThan(0);
    expect(bodyLen).toBeLessThan(small.length + 500);
  });

  it("compresses an oversized image below the source size before upload", async () => {
    let bodyLen = 0;
    agent.get(base).intercept({ path: "/v2.0/oa/upload/image", method: "POST" })
      .reply(200, (opts) => { bodyLen = (opts.body as Buffer).length; return { error: 0, data: { attachment_id: "att1" } }; });
    agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
      .reply(200, { error: 0, data: { message_id: "m" } });
    // a 2000x2000 random-noise JPEG is several MB, well over the 900KB threshold
    const big = await sharp(randomBytes(2000 * 2000 * 3), { raw: { width: 2000, height: 2000, channels: 3 } }).jpeg().toBuffer();
    expect(big.length).toBeGreaterThan(900_000);
    const sender = new OaSender(async () => "AT");
    await sender.sendAttachment("u1", ZaloThreadKind.OaUser, { filename: "huge.jpg", data: big }, "");
    expect(bodyLen).toBeGreaterThan(0);
    expect(bodyLen).toBeLessThan(big.length); // uploaded compressed bytes are smaller than the source
    expect(bodyLen).toBeLessThanOrEqual(900_000 + 2000); // compressed payload ≤ threshold + small multipart overhead
  });

  it("aligns filename and content-type when a large png is re-encoded to jpg", async () => {
    let uploadBody = Buffer.alloc(0);
    agent.get(base).intercept({ path: "/v2.0/oa/upload/image", method: "POST" })
      .reply(200, (opts) => { uploadBody = opts.body as Buffer; return { error: 0, data: { attachment_id: "att1" } }; });
    agent.get(base).intercept({ path: "/v3.0/oa/message/cs", method: "POST" })
      .reply(200, { error: 0, data: { message_id: "m" } });
    // large opaque (no-alpha) PNG → compressImageUnder emits JPEG, so the upload must switch to .jpg
    const bigPng = await sharp(randomBytes(2000 * 2000 * 3), { raw: { width: 2000, height: 2000, channels: 3 } }).png().toBuffer();
    expect(bigPng.length).toBeGreaterThan(900_000);
    const sender = new OaSender(async () => "AT");
    await sender.sendAttachment("u1", ZaloThreadKind.OaUser, { filename: "shot.png", data: bigPng }, "");
    const head = uploadBody.toString("latin1");
    expect(head).toContain('filename="shot.jpg"');
    expect(head).toContain("Content-Type: image/jpeg");
  });
});
