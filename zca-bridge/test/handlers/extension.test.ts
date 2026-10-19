import { describe, it, expect } from "vitest";
import { alignExtension } from "../../src/handlers/inbound.js";

describe("alignExtension", () => {
  it("rewrites a wrong extension to match the real content-type (gif served as .png)", () => {
    expect(alignExtension("sticker_7.png", "image/gif")).toBe("sticker_7.gif");
  });

  it("keeps a correct extension untouched", () => {
    expect(alignExtension("selfie.jpg", "image/jpeg")).toBe("selfie.jpg");
  });

  it("treats jpeg/jpg as equivalent (no needless rewrite)", () => {
    expect(alignExtension("photo.jpeg", "image/jpeg")).toBe("photo.jpeg");
  });

  it("appends an extension when the filename has none", () => {
    expect(alignExtension("voice", "audio/mp4")).toBe("voice.m4a");
  });

  it("leaves the filename as-is for an unknown/unmapped content-type", () => {
    expect(alignExtension("file.bin", "application/octet-stream")).toBe("file.bin");
  });

  it("maps common media content-types to their canonical extension", () => {
    expect(alignExtension("a.x", "image/webp")).toBe("a.webp");
    expect(alignExtension("a.x", "video/mp4")).toBe("a.mp4");
    expect(alignExtension("a.x", "application/pdf")).toBe("a.pdf");
  });
});
