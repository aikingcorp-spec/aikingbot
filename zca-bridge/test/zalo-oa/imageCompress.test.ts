import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { compressImageUnder } from "../../src/zalo-oa/imageCompress.js";

// Random-noise images are (near-)incompressible, so output size is driven by pixel
// count — ideal for exercising the resize ladder deterministically.
async function noiseJpeg(w: number, h: number): Promise<Buffer> {
  return sharp(randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
}
async function noisePngAlpha(w: number, h: number): Promise<Buffer> {
  return sharp(randomBytes(w * h * 4), { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

describe("compressImageUnder", () => {
  it("compresses a large image to at or under maxBytes", async () => {
    const big = await noiseJpeg(2000, 2000);
    const out = await compressImageUnder(big, 200_000);
    expect(out).not.toBeNull();
    expect(out!.data.length).toBeLessThanOrEqual(200_000);
    expect(out!.ext).toBe("jpg");
  });

  it("returns null when the target is impossibly small", async () => {
    const big = await noiseJpeg(1000, 1000);
    const out = await compressImageUnder(big, 50);
    expect(out).toBeNull();
  });

  it("keeps an image with alpha as png", async () => {
    const alpha = await noisePngAlpha(400, 400);
    const out = await compressImageUnder(alpha, 5_000_000);
    expect(out).not.toBeNull();
    expect(out!.ext).toBe("png");
  });

  it("encodes a non-alpha image as jpg", async () => {
    const rgb = await noiseJpeg(400, 400);
    const out = await compressImageUnder(rgb, 5_000_000);
    expect(out).not.toBeNull();
    expect(out!.ext).toBe("jpg");
  });

  it("returns null when the input buffer is not a decodable image", async () => {
    const out = await compressImageUnder(Buffer.from("not an image"), 5_000_000);
    expect(out).toBeNull();
  });
});
