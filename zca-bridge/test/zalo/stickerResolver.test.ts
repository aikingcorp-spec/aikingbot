import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveStickerImage, __clearStickerCache } from "../../src/zalo/stickerResolver.js";

describe("resolveStickerImage", () => {
  beforeEach(() => __clearStickerCache());

  it("returns the animated webp url when available", async () => {
    const api = { getStickersDetail: vi.fn(async () => [{ stickerWebpUrl: "https://cdn.zalo/s/9.webp", stickerUrl: "https://cdn.zalo/s/9.png" }]) };
    const img = await resolveStickerImage(api, 9);
    expect(api.getStickersDetail).toHaveBeenCalledWith(9);
    expect(img).toEqual({ href: "https://cdn.zalo/s/9.webp", filename: "sticker_9.webp" });
  });

  it("falls back to the png url when webp is null", async () => {
    const api = { getStickersDetail: vi.fn(async () => [{ stickerWebpUrl: null, stickerUrl: "https://cdn.zalo/s/9.png" }]) };
    const img = await resolveStickerImage(api, 9);
    expect(img).toEqual({ href: "https://cdn.zalo/s/9.png", filename: "sticker_9.png" });
  });

  it("caches by sticker id (immutable) — second call does not hit the API", async () => {
    const api = { getStickersDetail: vi.fn(async () => [{ stickerWebpUrl: "https://cdn.zalo/s/9.webp", stickerUrl: "" }]) };
    await resolveStickerImage(api, 9);
    await resolveStickerImage(api, 9);
    expect(api.getStickersDetail).toHaveBeenCalledTimes(1);
  });

  it("returns null (and does not cache) when the API throws, so a later call can retry", async () => {
    const api = { getStickersDetail: vi.fn(async () => { throw new Error("network"); }) };
    expect(await resolveStickerImage(api, 9)).toBeNull();
    const ok = { getStickersDetail: vi.fn(async () => [{ stickerWebpUrl: "https://cdn.zalo/s/9.webp", stickerUrl: "" }]) };
    expect(await resolveStickerImage(ok, 9)).toEqual({ href: "https://cdn.zalo/s/9.webp", filename: "sticker_9.webp" });
  });

  it("returns null for a missing/invalid sticker id without calling the API", async () => {
    const api = { getStickersDetail: vi.fn(async () => []) };
    expect(await resolveStickerImage(api, undefined)).toBeNull();
    expect(await resolveStickerImage(api, 0)).toBeNull();
    expect(api.getStickersDetail).not.toHaveBeenCalled();
  });

  it("returns null when the detail has no usable http url", async () => {
    const api = { getStickersDetail: vi.fn(async () => [{ stickerWebpUrl: null, stickerUrl: "" }]) };
    expect(await resolveStickerImage(api, 9)).toBeNull();
  });
});
