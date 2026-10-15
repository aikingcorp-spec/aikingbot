// Copyright (c) 2026 AIKING.
// Client for the first-party AIKINGBOT Auth API (email one-time codes). It has the shape of the upstream control-plane
// client that server/account-signin.ts drives, so the host's allow-list, scopes, live revocation and People settings
// stay the single workspace-membership authority. Signing in here proves an email address only; this server decides
// what that address may do.
import { ControlPlaneError, normalizeAccountEmail } from "../../electron/control-plane-client.mjs";

const CHALLENGE_TTL_MS = 10 * 60_000;
const MAX_PENDING = 1_000;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** The Auth API's code: 8 symbols from its alphabet, any case; spaces and the dash are optional. */
export function normalizeAccountCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 32) return null;
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return code.length === 8 && [...code].every((symbol) => CODE_ALPHABET.includes(symbol)) ? `${code.slice(0, 4)}-${code.slice(4)}` : null;
}

export function accountApiOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function createAikingAccountClient(options: { baseURL: string; fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number }) {
  const origin = accountApiOrigin(options.baseURL);
  if (!origin) throw new ControlPlaneError("control_plane_unavailable");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  // The Auth API binds a code to the challenge it started; the browser only ever talks to this server, so the
  // challenge stays here, keyed by address, and the newest request for an address wins.
  const challenges = new Map<string, { id: string; expiresAt: number }>();

  const request = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
    const headers = new Headers({ accept: "application/json" });
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    let response: Response;
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method: init.method ?? "GET",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch {
      throw new ControlPlaneError("network_unavailable");
    }
    const payload = (response.status === 204 ? null : await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const reported = (payload?.error as { code?: unknown } | undefined)?.code;
      const code = typeof reported === "string" && /^[a-z0-9_]{1,64}$/.test(reported) ? reported : `http_${response.status}`;
      const retry = Number(response.headers.get("retry-after"));
      throw new ControlPlaneError(code, response.status, "", Number.isFinite(retry) && retry > 0 ? retry * 1000 : 0);
    }
    return payload;
  };

  const prune = () => {
    const at = now();
    for (const [email, challenge] of challenges) if (challenge.expiresAt <= at) challenges.delete(email);
    while (challenges.size > MAX_PENDING) challenges.delete(challenges.keys().next().value!);
  };

  return {
    origin,
    async requestOTP(rawEmail: string) {
      const email = normalizeAccountEmail(rawEmail);
      if (!email) throw new ControlPlaneError("invalid_email");
      const payload = await request("/v1/auth/email/start", { method: "POST", body: { email } });
      const id = typeof payload?.challengeId === "string" ? payload.challengeId : "";
      if (!id || id.length > 128) throw new ControlPlaneError("invalid_response");
      prune();
      const expiresAt = typeof payload?.expiresAt === "number" ? Math.min(payload.expiresAt, now() + CHALLENGE_TTL_MS) : now() + CHALLENGE_TTL_MS;
      challenges.set(email, { id, expiresAt });
      return { email };
    },
    async verifyOTP(rawEmail: string, rawCode: string) {
      const email = normalizeAccountEmail(rawEmail);
      if (!email) throw new ControlPlaneError("invalid_email");
      const code = normalizeAccountCode(rawCode);
      if (!code) throw new ControlPlaneError("invalid_otp");
      prune();
      const challenge = challenges.get(email);
      if (!challenge) throw new ControlPlaneError("challenge_expired", 401);
      const payload = await request("/v1/auth/email/verify", { method: "POST", body: { challengeId: challenge.id, code } });
      const accountToken = typeof payload?.sessionToken === "string" && payload.sessionToken.length <= 512 ? payload.sessionToken : "";
      const user = payload?.user as { id?: unknown; email?: unknown } | undefined;
      const userEmail = normalizeAccountEmail(user?.email);
      if (!accountToken || typeof user?.id !== "string" || !user.id || user.id.length > 256 || userEmail !== email) {
        throw new ControlPlaneError("invalid_response");
      }
      challenges.delete(email);
      return { accountToken, user: { id: user.id, email: userEmail } };
    },
    async signOut(accountToken: string) {
      if (!accountToken) return;
      await request("/v1/auth/logout", { method: "POST", token: accountToken });
    },
  };
}
