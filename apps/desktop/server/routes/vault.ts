import { PASS, type RouteHandler } from "./table.ts";
import type { VaultBackend, VaultPurpose } from "../vault-key.ts";

export interface VaultRouteDeps {
  status(): { backend: VaultBackend; banner?: string };
  rotate(purpose: VaultPurpose): void;
  revoke(purpose: VaultPurpose): void;
  removeLogin?(id: string): boolean;
  /** Revoke one custom vault secret by slug (custom/<name> without prefix). */
  removeCustomSecret?(name: string): boolean;
}

const PURPOSE = new Set<VaultPurpose>(["browser-engine", "logins", "custom-secrets"]);

function isJson(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  return String(req.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase() === "application/json";
}

export function createVaultRoutes(deps: VaultRouteDeps): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (path !== "/api/vault" && !path.startsWith("/api/vault/")) return PASS;
    res.setHeader("cache-control", "no-store");
    if (path === "/api/vault" && method === "GET") return json(res, 200, deps.status());
    if (method !== "POST" || !isJson(req)) return json(res, method === "POST" ? 415 : 405, { error: method === "POST" ? "content-type must be application/json" : "method not allowed" });
    const body = (await readBody(req)) ?? {};
    if (path === "/api/vault/rotate") {
      const purpose = body.purpose;
      if (typeof purpose !== "string" || !PURPOSE.has(purpose as VaultPurpose)) {
        return json(res, 400, { error: "purpose must be browser-engine, logins, or custom-secrets" });
      }
      try {
        deps.rotate(purpose as VaultPurpose);
        return json(res, 200, { ok: true, ...deps.status() });
      } catch (error) {
        return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (path === "/api/vault/revoke") {
      // Per-entry revoke for logins / custom secrets; purpose-level revoke clears the vault key (operator recovery).
      if (typeof body.loginId === "string" && body.loginId && deps.removeLogin) {
        if (!deps.removeLogin(body.loginId)) return json(res, 404, { error: "login not found" });
        return json(res, 200, { ok: true });
      }
      if (typeof body.ref === "string" && body.ref && deps.removeCustomSecret) {
        const match = /^secret:custom\/([a-z0-9_-]{1,40})$/u.exec(body.ref.trim());
        if (!match) return json(res, 400, { error: "ref must be secret:custom/<name>" });
        if (!deps.removeCustomSecret(match[1]!)) return json(res, 404, { error: "custom secret not found" });
        return json(res, 200, { ok: true });
      }
      if (typeof body.customName === "string" && body.customName && deps.removeCustomSecret) {
        if (!deps.removeCustomSecret(body.customName)) return json(res, 404, { error: "custom secret not found" });
        return json(res, 200, { ok: true });
      }
      const purpose = body.purpose;
      if (typeof purpose !== "string" || !PURPOSE.has(purpose as VaultPurpose)) {
        return json(res, 400, { error: "provide loginId, ref, customName, or purpose (browser-engine|logins|custom-secrets)" });
      }
      deps.revoke(purpose as VaultPurpose);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: "not found" });
  };
}
