import { describe, it, expect } from "vitest";
import { classifyOaMessage } from "../../src/zalo-oa/classify.js";
import { ZaloThreadKind } from "../../src/zalo/types.js";

const base = (over: any) => ({ sender: { id: "u1" }, recipient: { id: "oa1" }, timestamp: "1700", message: { msg_id: "m1" }, ...over });

describe("classifyOaMessage", () => {
  it("classifies a text message", () => {
    const msg = classifyOaMessage(base({ event_name: "user_send_text", message: { msg_id: "m1", text: "xin chao" } }), false);
    expect(msg).toMatchObject({ kind: ZaloThreadKind.OaUser, threadId: "u1", msgId: "m1", senderUid: "u1", isSelf: false, text: "xin chao" });
    expect(msg.classified).toEqual({ kind: "text", text: "xin chao" });
  });

  it("classifies an image as media", () => {
    const msg = classifyOaMessage(base({ event_name: "user_send_image", message: { msg_id: "m2", attachments: [{ type: "image", payload: { url: "https://cdn/x.jpg" } }] } }), false);
    expect(msg.classified).toMatchObject({ kind: "media", mediaType: "image", href: "https://cdn/x.jpg" });
  });

  it("classifies a sticker as a non-blank fallback", () => {
    const msg = classifyOaMessage(base({ event_name: "user_send_sticker", message: { msg_id: "m3", attachments: [{ type: "sticker", payload: { url: "https://cdn/s.png" } }] } }), false);
    expect(msg.classified).toMatchObject({ kind: "media", mediaType: "image", href: "https://cdn/s.png" });
  });

  it("renders a location as a maps fallback", () => {
    const msg = classifyOaMessage(base({ event_name: "user_send_location", message: { msg_id: "m4", attachments: [{ type: "location", payload: { coordinates: { latitude: 10.7, longitude: 106.6 } } }] } }), false);
    expect(msg.classified).toMatchObject({ kind: "fallback" });
    expect((msg.classified as any).text).toContain("10.7");
  });

  it("marks oa_send_* events as self", () => {
    const msg = classifyOaMessage(base({ event_name: "oa_send_text", sender: { id: "oa1" }, recipient: { id: "u1" }, message: { msg_id: "m5", text: "reply" } }), true);
    expect(msg.isSelf).toBe(true);
    expect(msg.threadId).toBe("u1");
  });

  it("never blanks an unknown event", () => {
    const msg = classifyOaMessage(base({ event_name: "user_send_weird", message: { msg_id: "m6" } }), false);
    expect(msg.classified.kind).toBe("fallback");
    expect((msg.classified as any).text.length).toBeGreaterThan(0);
  });

  it("extracts quote_msg_id into quoteMsgId for a quoted reply", () => {
    const msg = classifyOaMessage(base({ event_name: "user_send_text", message: { msg_id: "m7", text: "ok", quote_msg_id: "q123" } }), false);
    expect(msg.quoteMsgId).toBe("q123");
    expect(msg.classified).toEqual({ kind: "text", text: "ok" });
  });

  it("leaves quoteMsgId undefined when the message is not a reply", () => {
    const msg = classifyOaMessage(base({ event_name: "user_send_text", message: { msg_id: "m8", text: "hi" } }), false);
    expect(msg.quoteMsgId).toBeUndefined();
  });
});
