// Copyright (c) 2026 AIKING.
import type { IncomingMessage, ServerResponse } from "node:http";
import { isSameOrigin, requestSource } from "../request-auth.ts";

export class WindowLimiter {
  private entries = new Map<string, { count: number; until: number }>();
  private limit: number;
  private windowMs: number;
  private maxKeys: number;
  private now: () => number;
  constructor(limit: number, windowMs: number, maxKeys: number, now = Date.now) {
    this.limit = limit; this.windowMs = windowMs; this.maxKeys = maxKeys; this.now = now;
  }
  take(key: string): number {
    const now = this.now();
    let entry = this.entries.get(key);
    if (entry && entry.until <= now) { this.entries.delete(key); entry = undefined; }
    if (!entry) {
      if (this.entries.size >= this.maxKeys) {
        for (const [id, value] of this.entries) if (value.until <= now) this.entries.delete(id);
        if (this.entries.size >= this.maxKeys) return Math.ceil(this.windowMs / 1000);
      }
      entry = { count: 0, until: now + this.windowMs };
      this.entries.set(key, entry);
    }
    if (entry.count >= this.limit) return Math.max(1, Math.ceil((entry.until - now) / 1000));
    entry.count++;
    return 0;
  }
}
const PUBLIC_AUTH = new Set(["/api/auth/email/start", "/api/auth/email/verify", "/api/auth/pair", "/api/pair", "/api/account/devices/link", "/api/account/devices/heartbeat"]);
export function createPublicAuthGuard(now = Date.now) {
  const sources = new WindowLimiter(60, 60_000, 4096, now);
  const total = new WindowLimiter(300, 60_000, 1, now);
  return (req: IncomingMessage, path: string, method: string): { status: number; error: string; retryAfter?: number } | null => {
    if (method !== "POST" || !PUBLIC_AUTH.has(path)) return null;
    if (!isSameOrigin(req) || req.headers["sec-fetch-site"] === "cross-site") return {status:403,error:"cross-origin sign-in request refused"};
    const retryAfter = sources.take(requestSource(req)) || total.take("auth");
    return retryAfter ? {status:429,error:"Too many sign-in requests; wait before trying again.",retryAfter} : null;
  };
}
export const publicAuthRefusal = createPublicAuthGuard();
export function securityResponseHeaders(res: ServerResponse, path: string): void {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "SAMEORIGIN");
  res.setHeader("referrer-policy", "no-referrer");
  if (path.startsWith("/api/") || path === "/pair") res.setHeader("cache-control", "no-store");
}
