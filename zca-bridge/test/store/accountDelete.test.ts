import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { AccountRepo } from "../../src/store/accountRepo.js";
import { createPool } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import type { Pool } from "pg";

describe("AccountRepo.delete (stubbed pool)", () => {
  it("issues a DELETE by id and returns true when a row matched", async () => {
    const calls: any[] = [];
    const pool = { query: vi.fn(async (sql: string, params: any[]) => { calls.push({ sql, params }); return { rowCount: 1 }; }) };
    const ok = await new AccountRepo(pool as any).delete(5);
    expect(ok).toBe(true);
    expect(calls[0].sql).toContain("DELETE FROM zalo_accounts");
    expect(calls[0].sql).toContain("WHERE id = $1");
    expect(calls[0].params).toEqual([5]);
  });

  it("returns false when no row matched", async () => {
    const pool = { query: vi.fn(async () => ({ rowCount: 0 })) };
    expect(await new AccountRepo(pool as any).delete(404)).toBe(false);
  });
});

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;
d("AccountRepo.delete (real DB cascade)", () => {
  let pool: Pool;
  beforeAll(async () => { await runMigrations(url!); pool = createPool(url!); await pool.query("TRUNCATE zalo_accounts RESTART IDENTITY CASCADE"); });
  afterAll(async () => { if (pool) await pool.end(); });

  it("removes the account and cascades to conversations", async () => {
    const repo = new AccountRepo(pool);
    const acc = await repo.create({ label: "Del", chatwootInboxIdentifier: "ci-del" });
    await pool.query("INSERT INTO zalo_conversations (zalo_account_id, source_id, chatwoot_conversation_id) VALUES ($1, 'user:1', 99)", [acc.id]);
    expect(await repo.delete(acc.id)).toBe(true);
    const conv = await pool.query("SELECT 1 FROM zalo_conversations WHERE zalo_account_id = $1", [acc.id]);
    expect(conv.rowCount).toBe(0);
    expect(await repo.findById(acc.id)).toBeNull();
  });
});
