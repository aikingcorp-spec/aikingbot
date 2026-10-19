import type { AppConfig } from "./env.js";

export interface SettingsSource { getAll(): Promise<Record<string, string>>; }
interface MinimalLog { warn(obj: unknown, msg?: string): void; }

/** Merge DB-stored settings over the env config: effective = DB ?? env ?? default. */
export async function resolveSettings(
  settings: SettingsSource, env: AppConfig, log?: MinimalLog,
): Promise<AppConfig> {
  let db: Record<string, string> = {};
  try {
    db = await settings.getAll();
  } catch (err) {
    log?.warn({ err }, "settings read failed at boot; using env only");
    return env;
  }

  const chatwootBaseUrl = (db["chatwoot_base_url"] ?? env.chatwootBaseUrl).replace(/\/$/, "");
  const chatwootApiAccessToken = db["chatwoot_api_access_token"] ?? env.chatwootApiAccessToken;
  const accId = db["chatwoot_account_id"];
  const chatwootAccountId = accId != null && accId !== "" ? Number(accId) : env.chatwootAccountId;

  const oaAppId = db["zalo_oa_app_id"] ?? env.oa?.appId;
  const oaAppSecret = db["zalo_oa_app_secret"] ?? env.oa?.appSecret;
  const oaRedirect = db["zalo_oa_oauth_redirect"] ?? env.oa?.redirectUri;
  const oaSecretKey = db["zalo_oa_secret_key"] ?? env.oa?.secretKey;
  const oa = oaAppId && oaAppSecret && oaRedirect
    ? { appId: oaAppId, appSecret: oaAppSecret, redirectUri: oaRedirect, secretKey: oaSecretKey }
    : undefined;

  return { ...env, chatwootBaseUrl, chatwootApiAccessToken, chatwootAccountId, oa };
}
