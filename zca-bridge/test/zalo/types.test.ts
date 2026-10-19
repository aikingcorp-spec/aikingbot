import { describe, it, expect } from "vitest";
import { normalizeIncoming, normalizeReaction, normalizeUndo, ZaloThreadKind, toRoutingKindOf } from "../../src/zalo/types.js";

describe("normalizeIncoming", () => {
  it("normalizes a user text message", () => {
    const raw = {
      type: 0, // ThreadType.User
      threadId: "84900",
      isSelf: false,
      data: { msgId: "m1", uidFrom: "84900", dName: "Khach A", content: "xin chao", msgType: "chat.msg" },
    };
    const n = normalizeIncoming(raw);
    expect(n).toMatchObject({
      kind: ZaloThreadKind.User, threadId: "84900", msgId: "m1",
      senderUid: "84900", senderName: "Khach A", text: "xin chao",
      isSelf: false,
    });
    expect(n.classified).toMatchObject({ kind: "text", text: "xin chao" });
  });

  it("classifies a photo message as media", () => {
    const raw = {
      type: 0, threadId: "84900", isSelf: false,
      data: { msgId: "m2", uidFrom: "84900", dName: "A", msgType: "chat.photo",
        content: { href: "http://zalo/a.jpg", title: "photo" } },
    };
    const n = normalizeIncoming(raw);
    expect(n.classified).toMatchObject({ kind: "media", mediaType: "image", href: "http://zalo/a.jpg" });
    expect(n.text).toBe(""); // caption for photo is empty
  });

  it("marks self messages", () => {
    const raw = { type: 1, threadId: "g1", isSelf: true, data: { msgId: "m3", uidFrom: "0", content: "x" } };
    const n = normalizeIncoming(raw);
    expect(n.isSelf).toBe(true);
    expect(n.kind).toBe(ZaloThreadKind.Group);
  });

  it("captures the quoted message id when the message is a reply", () => {
    const raw = { type: 0, threadId: "84900", isSelf: false, data: { msgId: "m5", uidFrom: "84900", content: "tra loi", quote: { globalMsgId: 12345 } } };
    expect(normalizeIncoming(raw).quoteMsgId).toBe("12345");
  });

  it("leaves quoteMsgId undefined for a non-reply", () => {
    const raw = { type: 0, threadId: "84900", isSelf: false, data: { msgId: "m6", uidFrom: "84900", content: "hi" } };
    expect(normalizeIncoming(raw).quoteMsgId).toBeUndefined();
  });
});

describe("normalizeReaction", () => {
  it("extracts the reacted message id, icon, and sender", () => {
    const raw = { threadId: "84900", isGroup: false, isSelf: false,
      data: { uidFrom: "84900", dName: "Khach A", content: { rMsg: [{ gMsgID: "m1" }], rIcon: "/-heart" } } };
    expect(normalizeReaction(raw)).toMatchObject({
      kind: ZaloThreadKind.User, threadId: "84900", reactedMsgId: "m1", icon: "/-heart", senderName: "Khach A", isSelf: false,
    });
  });

  it("flags the operator's own reaction as self", () => {
    const raw = { threadId: "84900", isGroup: false, isSelf: true, data: { uidFrom: "0", content: { rMsg: [{ gMsgID: "m1" }], rIcon: "/-strong" } } };
    expect(normalizeReaction(raw).isSelf).toBe(true);
  });
});

describe("normalizeUndo", () => {
  it("extracts the recalled message global id and self flag", () => {
    const raw = { threadId: "84900", isGroup: false, isSelf: true, data: { uidFrom: "0", content: { globalMsgId: 999 } } };
    expect(normalizeUndo(raw)).toMatchObject({ kind: ZaloThreadKind.User, threadId: "84900", recalledMsgId: "999", isSelf: true });
  });
});

describe("toRoutingKindOf", () => {
  it("maps OA user thread kind to the oa-user routing kind", () => {
    expect(toRoutingKindOf(ZaloThreadKind.OaUser)).toBe("oa-user");
  });
  it("maps group and user", () => {
    expect(toRoutingKindOf(ZaloThreadKind.Group)).toBe("group");
    expect(toRoutingKindOf(ZaloThreadKind.User)).toBe("user");
  });
});
