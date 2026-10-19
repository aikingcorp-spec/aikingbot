import { describe, it, expect, vi } from "vitest";
import { SettingsRepo } from "../../src/store/settingsRepo.js";
import { encryptCredentials, decryptCredentials } from "../../src/crypto/credentials.js";

const KEY = Buffer.alloc(32, 7);

function stubPool() {
  const calls: Array<{ sql: string; params: any[] }> = [];
  return { calls, query: vi.fn(async (sql: string, params: any[]) => { calls.push({ sql, params }); return { rows: [], rowCount: 0 }; }) };
}

describe("SettingsRepo", () => {
  it("stores a secret value encrypted", async () => {
    const pool = stubPool();
    await new SettingsRepo(pool as any, KEY).set("zalo_oa_app_secret", "shh", true);
    const stored = pool.calls[0].params[1];
    expect(stored).not.toBe("shh");
    expect(decryptCredentials<string>(stored, KEY)).toBe("shh");
    expect(pool.calls[0].params[2]).toBe(true);
  });

  it("stores a non-secret value as plaintext", async () => {
    const pool = stubPool();
    await new SettingsRepo(pool as any, KEY).set("chatwoot_account_id", "1", false);
    expect(pool.calls[0].params[1]).toBe("1");
    expect(pool.calls[0].params[2]).toBe(false);
  });

  it("getAll decrypts secrets and returns plaintext for the rest", async () => {
    const enc = encryptCredentials("tok", KEY);
    const pool = { query: vi.fn(async () => ({ rows: [
      { key: "chatwoot_account_id", value: "1", is_secret: false },
      { key: "chatwoot_api_access_token", value: enc, is_secret: true },
    ], rowCount: 2 })) };
    const all = await new SettingsRepo(pool as any, KEY).getAll();
    expect(all).toEqual({ chatwoot_account_id: "1", chatwoot_api_access_token: "tok" });
  });
});
