import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

export const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 7 * 86_400_000;

export interface PasswordHash { hash: string; salt: string; }

export function hashPassword(password: string): PasswordHash {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, salt: string, expectedHex: string): boolean {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Derive a session-signing secret from CREDENTIALS_KEY so no new env var is needed. */
export function deriveSessionSecret(credentialsKey: Buffer): Buffer {
  return createHmac("sha256", credentialsKey).update("session").digest();
}

export function signSession(username: string, secret: Buffer, now = Date.now()): string {
  const payload = JSON.stringify({ u: username, exp: now + SESSION_TTL_MS });
  const b = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", secret).update(b).digest("base64url");
  return `${b}.${sig}`;
}

export function verifySession(
  cookieHeader: string | undefined, secret: Buffer, now = Date.now(),
): { username: string } | null {
  const sid = parseCookie(cookieHeader)[SESSION_COOKIE];
  if (!sid) return null;
  const dot = sid.lastIndexOf(".");
  if (dot <= 0) return null;
  const b = sid.slice(0, dot);
  let given: Buffer;
  try {
    given = Buffer.from(sid.slice(dot + 1), "base64url");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", secret).update(b).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(b, "base64url").toString("utf8")) as { u: string; exp: number };
    if (typeof u !== "string" || typeof exp !== "number" || now > exp) return null;
    return { username: String(u) };
  } catch {
    return null;
  }
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseCookie(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeSafe(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookieHeader(sid: string, opts: { secure?: boolean; maxAgeSec?: number } = {}): string {
  const maxAgeSec = opts.maxAgeSec ?? 7 * 86_400;
  const secure = opts.secure ? "; Secure" : "";
  return `${SESSION_COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=/admin; Max-Age=${maxAgeSec}${secure}`;
}

export function clearSessionCookieHeader(opts: { secure?: boolean } = {}): string {
  const secure = opts.secure ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/admin; Max-Age=0${secure}`;
}
