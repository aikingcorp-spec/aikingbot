// Copyright (c) 2026 AIKING.
/** Standalone servers admit only public metadata and bearer-checked internal capabilities without a session. */
export function strictServiceAllowed(method: string, path: string, env: NodeJS.ProcessEnv = process.env): boolean | null {
  if (env.AIKING_STRICT_SERVICE_LOOPBACK !== "1") return null;
  const verb = method.toUpperCase();
  if (verb === "GET" && ["/api/health", "/api/auth/session", "/api/edition", "/api/brand"].includes(path)) return true;
  return ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(verb) && path.startsWith("/api/internal/");
}
