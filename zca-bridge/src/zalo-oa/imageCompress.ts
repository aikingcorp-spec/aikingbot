import sharp from "sharp";

// Try progressively smaller dimensions, then progressively lower JPEG quality,
// returning the first encoding that fits the byte budget. Images with an alpha
// channel are kept as PNG (JPEG would flatten transparency); everything else
// becomes JPEG. Returns null if no combination fits, or if the input cannot be
// decoded as an image (so callers can fall back instead of treating it as a
// transient error).
// The 800px floor balances "still legible on a phone" against the ~1MB target;
// very dense images that don't fit even at 800px/q60 return null and the caller
// handles the original (e.g. via a download link).
const DIMENSIONS = [1600, 1280, 1024, 800];
const JPEG_QUALITIES = [82, 72, 60];

export async function compressImageUnder(
  data: Buffer,
  maxBytes: number,
): Promise<{ data: Buffer; ext: "jpg" | "png" } | null> {
  let hasAlpha: boolean;
  try {
    const meta = await sharp(data).metadata();
    hasAlpha = Boolean(meta.hasAlpha);
  } catch {
    return null; // undecodable input → cannot compress
  }

  for (const dim of DIMENSIONS) {
    // Fresh pipeline per attempt; .rotate() honours EXIF orientation before resizing.
    const resized = () =>
      sharp(data).rotate().resize({ width: dim, height: dim, fit: "inside", withoutEnlargement: true });

    if (hasAlpha) {
      const out = await resized().png({ compressionLevel: 9 }).toBuffer();
      if (out.length <= maxBytes) return { data: out, ext: "png" };
      continue;
    }
    for (const q of JPEG_QUALITIES) {
      const out = await resized().jpeg({ quality: q }).toBuffer();
      if (out.length <= maxBytes) return { data: out, ext: "jpg" };
    }
  }
  return null;
}
