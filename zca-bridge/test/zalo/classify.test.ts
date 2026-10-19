import { describe, it, expect } from "vitest";
import { classifyMessage } from "../../src/zalo/classify.js";

describe("classifyMessage", () => {
  it("classifies a plain text message", () => {
    expect(classifyMessage({ msgType: "webchat", content: "xin chao" }))
      .toEqual({ kind: "text", text: "xin chao" });
  });

  it("treats string content as text even without msgType", () => {
    expect(classifyMessage({ content: "hi" })).toEqual({ kind: "text", text: "hi" });
  });

  it("classifies a photo as image media with a fetchable href", () => {
    const r = classifyMessage({ msgType: "chat.photo", content: { href: "https://cdn.zalo/x.jpg", title: "x.jpg" } });
    expect(r).toEqual({ kind: "media", mediaType: "image", href: "https://cdn.zalo/x.jpg", filename: "x.jpg", caption: "" });
  });

  it("classifies a voice message and forces an audio extension", () => {
    const r = classifyMessage({ msgType: "chat.voice", content: { href: "https://cdn.zalo/v123" } });
    expect(r).toMatchObject({ kind: "media", mediaType: "audio", filename: expect.stringMatching(/\.m4a$/) });
  });

  it("classifies a video using the video href, forcing .mp4", () => {
    const r = classifyMessage({ msgType: "chat.video.msg", content: { href: "https://cdn.zalo/clip", thumb: "https://cdn.zalo/thumb.jpg" } });
    expect(r).toMatchObject({ kind: "media", mediaType: "video", href: "https://cdn.zalo/clip", filename: expect.stringMatching(/\.mp4$/) });
  });

  it("classifies share.file using the original title as filename", () => {
    const r = classifyMessage({ msgType: "share.file", content: { href: "https://cdn.zalo/abc", title: "baocao.pdf" } });
    expect(r).toMatchObject({ kind: "media", mediaType: "file", filename: "baocao.pdf" });
  });

  it("renders a media type with no fetchable href as a non-blank fallback", () => {
    expect(classifyMessage({ msgType: "chat.photo", content: { href: "content://local" } }))
      .toEqual({ kind: "fallback", text: "[Ảnh]" });
  });

  it("renders a sticker as a text fallback", () => {
    expect(classifyMessage({ msgType: "chat.sticker", content: { catId: 1 } }))
      .toEqual({ kind: "fallback", text: "[Sticker]" });
  });

  it("renders a location with a maps link parsed from params", () => {
    expect(classifyMessage({ msgType: "chat.location.new", content: { params: '{"lat":10.77,"lng":106.7}' } }))
      .toEqual({ kind: "fallback", text: "📍 Vị trí: https://www.google.com/maps?q=10.77,106.7" });
  });

  it("renders a contact card with name and phone", () => {
    expect(classifyMessage({ msgType: "chat.recommended", content: { title: "Nguyen A", params: '{"phone":"0900"}' } }))
      .toEqual({ kind: "fallback", text: "👤 Danh thiếp: Nguyen A — 0900" });
  });

  it("renders a shared link as title + url, never downloading it", () => {
    expect(classifyMessage({ msgType: "chat.link", content: { href: "https://vnexpress.net/x", title: "Tin nong" } }))
      .toEqual({ kind: "fallback", text: "🔗 Tin nong\nhttps://vnexpress.net/x" });
  });

  it("renders an unknown type without ever blanking", () => {
    expect(classifyMessage({ msgType: "chat.future.thing", content: { foo: 1 } }))
      .toEqual({ kind: "fallback", text: "[Tin Zalo loại chat.future.thing — mở app để xem]" });
  });

  it("degrades malformed location params to a safe fallback", () => {
    expect(classifyMessage({ msgType: "chat.location.new", content: { params: "not-json" } }))
      .toEqual({ kind: "fallback", text: "📍 Vị trí" });
  });

  it("degrades empty, null, and undefined input to a safe fallback", () => {
    const expected = { kind: "fallback", text: "[Tin Zalo loại không rõ — mở app để xem]" };
    expect(classifyMessage({})).toEqual(expected);
    expect(classifyMessage(null)).toEqual(expected);
    expect(classifyMessage(undefined)).toEqual(expected);
  });
});
