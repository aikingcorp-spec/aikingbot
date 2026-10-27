// Copyright (c) 2026 AIKING.
// The browser's view of its AIKINGBOT account: what the server says this account owns or was invited to, nothing more.

import { at } from "../strings";

export interface AccountWorkspace { id: string; name: string; role: "owner" | "member"; current: boolean; url?: string }
export interface AccountDevice { id: string; name: string; platform: string; appVersion: string; linkedAt: number; lastSeenAt: number; online: boolean }
export interface AccountState {
  account: { email: string };
  workspaces: AccountWorkspace[];
  devices: AccountDevice[];
  hostedComputers: "available" | "not-offered";
}

function isState(value: unknown): value is AccountState {
  const record = Object(value) as Partial<AccountState>;
  return typeof record.account?.email === "string" && Array.isArray(record.workspaces) && Array.isArray(record.devices);
}

/** Null when this browser has no account session (signed out, expired or revoked). */
export async function readAccountState(fetchImpl: typeof fetch = fetch): Promise<AccountState | null> {
  try {
    const res = await fetchImpl("/api/account/session", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return null;
    const body: unknown = await res.json().catch(() => null);
    return isState(body) ? body : null;
  } catch {
    return null;
  }
}

async function post(path: string, method: "POST" | "DELETE", body: unknown, fetchImpl: typeof fetch): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetchImpl(path, { method, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  } catch (error) {
    return { ok: false, error: `could not reach the server (${error instanceof Error ? error.message : String(error)})` };
  }
  const parsed: unknown = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, body: parsed };
  const error = Reflect.get(Object(parsed), "error");
  return { ok: false, error: typeof error === "string" ? error : `${res.status} ${res.statusText}` };
}

export function signOutAccount(fetchImpl: typeof fetch = fetch) {
  return post("/api/account/logout", "POST", {}, fetchImpl);
}

export function enterWorkspace(id: string, label: string, fetchImpl: typeof fetch = fetch) {
  return post(`/api/account/workspaces/${encodeURIComponent(id)}/enter`, "POST", { label }, fetchImpl);
}

export async function createLinkCode(fetchImpl: typeof fetch = fetch): Promise<{ ok: true; code: string; expiresAt: number } | { ok: false; error: string }> {
  const result = await post("/api/account/devices/link-code", "POST", {}, fetchImpl);
  if (!result.ok) return result;
  const { code, expiresAt } = Object(result.body) as { code?: unknown; expiresAt?: unknown };
  return typeof code === "string" && typeof expiresAt === "number" ? { ok: true, code, expiresAt } : { ok: false, error: "the server sent an unexpected answer" };
}

export function unlinkDevice(id: string, fetchImpl: typeof fetch = fetch) {
  return post(`/api/account/devices/${encodeURIComponent(id)}`, "DELETE", {}, fetchImpl);
}

export function lastSeenText(device: Pick<AccountDevice, "online" | "lastSeenAt">, now = Date.now()): string {
  if (device.online) return at("account.online");
  const minutes = Math.max(1, Math.round((now - device.lastSeenAt) / 60_000));
  if (minutes < 60) return at("account.offlineMinutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return at("account.offlineHours", { count: hours });
  return at("account.offlineDays", { count: Math.round(hours / 24) });
}
