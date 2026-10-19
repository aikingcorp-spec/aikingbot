import { createHmac, timingSafeEqual, type BinaryLike } from "node:crypto";

const DAY_MS = 86_400_000;

export type TokenResult = { ok: true; key: string } | { ok: false; reason: "invalid" | "expired" };

/** Sign a media archive key into an opaque, tamper-proof token. ttlDays=0 → never expires. */
export function signMediaToken(key: string, secret: BinaryLike, ttlDays = 0, now = Date.now()): string {
  const exp = ttlDays > 0 ? String(now + ttlDays * DAY_MS) : "0";
  const payload = `${key}|${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest();
  return `${Buffer.from(payload).toString("base64url")}.${sig.toString("base64url")}`;
}

export function verifyMediaToken(token: string, secret: BinaryLike, now = Date.now()): TokenResult {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  let payload: string;
  let given: Buffer;
  try {
    payload = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
    given = Buffer.from(token.slice(dot + 1), "base64url");
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const expected = createHmac("sha256", secret).update(payload).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "invalid" };
  }
  const sep = payload.lastIndexOf("|");
  const key = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (exp !== 0 && now > exp) return { ok: false, reason: "expired" };
  return { ok: true, key };
}
