export interface ContactInfo {
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  district?: string;
}

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function pick(o: unknown): ContactInfo | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const out: ContactInfo = {};
  const name = str(r.name) ?? str(r.display_name);
  const phone = str(r.phone) ?? str(r.phone_number);
  const address = str(r.address);
  const city = str(r.city);
  const district = str(r.district);
  if (name) out.name = name;
  if (phone) out.phone = phone;
  if (address) out.address = address;
  if (city) out.city = city;
  if (district) out.district = district;
  return Object.keys(out).length ? out : null;
}

/**
 * Extract shared contact info from either a `user_submit_info` webhook event or a
 * `user/detail` response. The exact field path is not fully documented, so probe the
 * known candidates in priority order and return the first that yields a usable field.
 */
export function parseSharedInfo(src: unknown): ContactInfo | null {
  if (!src || typeof src !== "object") return null;
  const s = src as Record<string, any>;
  const candidates: unknown[] = [s.info, s.message?.info, s.shared_info, s.data?.shared_info, s.data?.info, s];
  for (const c of candidates) {
    const r = pick(c);
    if (r) return r;
  }
  return null;
}
