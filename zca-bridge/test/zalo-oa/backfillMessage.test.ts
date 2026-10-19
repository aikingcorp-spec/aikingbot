import { describe, it, expect } from "vitest";
import { toIncomingMessage } from "../../src/zalo-oa/backfillMessage.js";
import { ZaloThreadKind } from "../../src/zalo/types.js";

describe("toIncomingMessage", () => {
  it("maps a user text message (src=1 -> not self)", () => {
    const out = toIncomingMessage({ message_id: "m1", src: 1, time: 300, type: "text", message: "hi" }, "user-A");
    expect(out).not.toBeNull();
    expect(out!.timeMs).toBe(300);
    expect(out!.msg.kind).toBe(ZaloThreadKind.OaUser);
    expect(out!.msg.threadId).toBe("user-A");
    expect(out!.msg.msgId).toBe("m1");
    expect(out!.msg.isSelf).toBe(false);
    expect(out!.msg.text).toBe("hi");
    expect(out!.msg.classified).toEqual({ kind: "text", text: "hi" });
    expect(out!.msg.quoteSrc.ts).toBe("300");
  });

  it("maps an OA-sent message (src=0 -> self)", () => {
    const out = toIncomingMessage({ message_id: "m2", src: 0, time: 400, type: "text", message: "reply" }, "user-A");
    expect(out!.msg.isSelf).toBe(true);
  });

  it("maps an image message to a media classified value", () => {
    const out = toIncomingMessage({ message_id: "m3", src: 1, time: 500, type: "photo", url: "https://x/y.jpg" }, "user-A");
    expect(out!.msg.classified).toMatchObject({ kind: "media", mediaType: "image", href: "https://x/y.jpg" });
  });

  it("returns null when message_id is missing", () => {
    expect(toIncomingMessage({ src: 1, time: 1, type: "text", message: "x" }, "user-A")).toBeNull();
  });
});
