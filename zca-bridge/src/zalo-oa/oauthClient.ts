import { request } from "undici";

const TOKEN_URL = "https://oauth.zaloapp.com/v4/oa/access_token";

export interface OaTokenResult { accessToken: string; refreshToken: string; expiresInSec: number }

export class OaOAuthClient {
  constructor(private appId: string, private secretKey: string) {}

  exchangeCode(code: string): Promise<OaTokenResult> {
    return this.post({ app_id: this.appId, grant_type: "authorization_code", code });
  }

  refresh(refreshToken: string): Promise<OaTokenResult> {
    return this.post({ app_id: this.appId, grant_type: "refresh_token", refresh_token: refreshToken });
  }

  permissionUrl(redirectUri: string, state: string): string {
    const u = new URL("https://oauth.zaloapp.com/v4/oa/permission");
    u.searchParams.set("app_id", this.appId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    return u.toString();
  }

  private async post(fields: Record<string, string>): Promise<OaTokenResult> {
    const res = await request(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", secret_key: this.secretKey },
      body: new URLSearchParams(fields).toString(),
    });
    const json = (await res.body.json()) as any;
    if (!json?.access_token) {
      throw new Error(`OA token request failed: ${json?.error ?? res.statusCode} ${json?.message ?? ""}`.trim());
    }
    return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresInSec: Number(json.expires_in ?? 3600) };
  }
}
