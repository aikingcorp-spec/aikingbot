import { request } from "undici";
import { OaTokenRepo } from "../store/oaTokenRepo.js";
import { OaOAuthClient } from "./oauthClient.js";
import { parseSharedInfo, ContactInfo } from "./sharedInfo.js";

/** Returns a fresh access token, refreshing on the fly if expired. */
export function accessTokenProvider(tokens: OaTokenRepo, oauth: OaOAuthClient, accountId: number): () => Promise<string> {
  return async () => {
    const stored = await tokens.load(accountId);
    if (!stored) throw new Error(`No OA tokens for account ${accountId}`);
    if (stored.accessExpiresAt.getTime() > Date.now() + 60_000) return stored.accessToken;
    const t = await oauth.refresh(stored.refreshToken);
    await tokens.save(accountId, { accessToken: t.accessToken, refreshToken: t.refreshToken }, new Date(Date.now() + t.expiresInSec * 1000));
    return t.accessToken;
  };
}

/** Resolve the OA id for a freshly-issued access token (GET /v2.0/oa/getoa). */
export async function fetchOaId(accessToken: string): Promise<string> {
  const res = await request("https://openapi.zalo.me/v2.0/oa/getoa", { method: "GET", headers: { access_token: accessToken } });
  const json = (await res.body.json()) as any;
  const oaId = json?.data?.oa_id;
  if (!oaId) throw new Error(`getoa failed: ${json?.error} ${json?.message ?? ""}`.trim());
  return String(oaId);
}

/** Fetch a follower's display name + avatar (GET /v3.0/oa/user/detail). Best-effort, null on failure. */
export async function fetchUserProfile(
  accessToken: string,
  userId: string,
): Promise<{ displayName: string; avatar?: string; sharedInfo?: ContactInfo } | null> {
  const data = encodeURIComponent(JSON.stringify({ user_id: userId }));
  const res = await request(`https://openapi.zalo.me/v3.0/oa/user/detail?data=${data}`, {
    method: "GET",
    headers: { access_token: accessToken },
  });
  const json = (await res.body.json()) as any;
  const d = json?.data;
  if (!d?.display_name) return null;
  const sharedInfo = d.shared_info ? (parseSharedInfo({ shared_info: d.shared_info }) ?? undefined) : undefined;
  const out: { displayName: string; avatar?: string; sharedInfo?: ContactInfo } = { displayName: String(d.display_name) };
  if (d.avatar) out.avatar = String(d.avatar);
  if (sharedInfo) out.sharedInfo = sharedInfo;
  return out;
}
