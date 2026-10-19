import type { Pool } from "pg";
import { encryptCredentials, decryptCredentials } from "../crypto/credentials.js";

export interface SettingEntry { key: string; value: string; isSecret: boolean; }

export class SettingsRepo {
  constructor(private pool: Pool, private key: Buffer) {}

  async set(key: string, value: string, isSecret: boolean): Promise<void> {
    const stored = isSecret ? encryptCredentials(value, this.key) : value;
    await this.pool.query(
      `INSERT INTO settings (key, value, is_secret) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_secret = EXCLUDED.is_secret, updated_at = now()`,
      [key, stored, isSecret],
    );
  }

  async setMany(entries: SettingEntry[]): Promise<void> {
    for (const e of entries) await this.set(e.key, e.value, e.isSecret);
  }

  async getAll(): Promise<Record<string, string>> {
    const r = await this.pool.query<{ key: string; value: string; is_secret: boolean }>(
      "SELECT key, value, is_secret FROM settings",
    );
    const out: Record<string, string> = {};
    for (const row of r.rows) {
      out[row.key] = row.is_secret ? decryptCredentials<string>(row.value, this.key) : row.value;
    }
    return out;
  }
}
