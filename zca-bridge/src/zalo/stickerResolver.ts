// Zalo sticker messages arrive as { id, catId, type } with NO image URL. The image URL
// (animated webp / static png) must be resolved via the sticker_detail API. We cache by
// sticker id because a sticker's artwork is immutable, so we never re-fetch the same one.

export interface StickerImage {
  href: string;
  filename: string;
}

interface StickerApi {
  getStickersDetail(stickerId: number): Promise<Array<{ stickerWebpUrl?: string | null; stickerUrl?: string | null }>>;
}

const cache = new Map<number, StickerImage>();

/** Test-only: reset the in-memory cache between cases. */
export function __clearStickerCache(): void {
  cache.clear();
}

function httpUrl(value: unknown): string {
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : "";
}

/**
 * Resolve a Zalo sticker id to a fetchable image (prefers animated webp, falls back to png).
 * Returns null when the id is invalid, the lookup fails, or no usable URL is available — the
 * caller then keeps the "[Sticker]" text fallback so a message is never lost. Failures are NOT
 * cached, so a transient API error can be retried on the next sticker of the same id.
 */
export async function resolveStickerImage(api: StickerApi, stickerId: unknown): Promise<StickerImage | null> {
  const id = Number(stickerId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const cached = cache.get(id);
  if (cached) return cached;

  try {
    const details = await api.getStickersDetail(id);
    const detail = Array.isArray(details) ? details[0] : null;
    const webp = httpUrl(detail?.stickerWebpUrl);
    const png = httpUrl(detail?.stickerUrl);
    const href = webp || png;
    if (!href) return null;

    const image: StickerImage = { href, filename: `sticker_${id}.${href === webp ? "webp" : "png"}` };
    cache.set(id, image);
    return image;
  } catch {
    return null;
  }
}
