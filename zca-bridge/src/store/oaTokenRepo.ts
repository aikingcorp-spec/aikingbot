import type { Pool } from "pg";
import { encryptCredentials, decryptCredentials } from "../crypto/credentials.js";

export interface OaTokens { accessToken: string; refreshToken: string }
export interface StoredOaTokens extends OaTokens { accessExpiresAt: Date }

export function encodeTokenBlob(tokens: OaTokens, key: Buffer): string {
  return encryptCredentials(tokens, key);
}
export function decodeTokenBlob(blob: string, key: Buffer): OaTokens {
  return decryptCredentials<OaTokens>(blob, key);
}

export class OaTokenRepo {
  constructor(private pool: Pool, private key: Buffer) {}

  async save(accountId: number, tokens: OaTokens, accessExpiresAt: Date): Promise<void> {
    const access = encodeTokenBlob({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }, this.key);
    await this.pool.query(
      `INSERT INTO oa_tokens (zalo_account_id, access_token, refresh_token, access_expires_at)
       VALUES ($1, $2, $2, $3)
       ON CONFLICT (zalo_account_id)
       DO UPDATE SET access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
                     access_expires_at = EXCLUDED.access_expires_at, updated_at = now()`,
      [accountId, access, accessExpiresAt],
    );
  }

  async load(accountId: number): Promise<StoredOaTokens | null> {
    const res = await this.pool.query<{ access_token: string; access_expires_at: Date }>(
      "SELECT access_token, access_expires_at FROM oa_tokens WHERE zalo_account_id = $1",
      [accountId],
    );
    const row = res.rows[0];
    if (!row) return null;
    const { accessToken, refreshToken } = decodeTokenBlob(row.access_token, this.key);
    return { accessToken, refreshToken, accessExpiresAt: row.access_expires_at };
  }

  /** Accounts whose access token expires before `before` (refresh candidates). */
  async listExpiring(before: Date): Promise<number[]> {
    const res = await this.pool.query<{ zalo_account_id: string }>(
      "SELECT zalo_account_id FROM oa_tokens WHERE access_expires_at < $1", [before],
    );
    return res.rows.map((r) => Number(r.zalo_account_id));
  }
}
