import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { AccountRepo } from "../../src/store/accountRepo.js";
import type { Pool } from "pg";

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: Pool;

beforeAll(async () => {
  if (!url) return;
  await runMigrations(url);
  pool = createPool(url);
  await pool.query("TRUNCATE zalo_accounts RESTART IDENTITY CASCADE");
});
afterAll(async () => { if (pool) await pool.end(); });

d("AccountRepo backfill watermark", () => {
  it("returns null before any watermark is set", async () => {
    const acc = await new AccountRepo(pool).createOa({ label: "W", chatwootInboxIdentifier: "ci-w1" });
    expect(await new AccountRepo(pool).getWatermark(acc.id)).toBeNull();
  });

  it("advances to the greater value and never moves backward", async () => {
    const repo = new AccountRepo(pool);
    const acc = await repo.createOa({ label: "W2", chatwootInboxIdentifier: "ci-w2" });
    await repo.advanceWatermark(acc.id, 1000);
    expect(await repo.getWatermark(acc.id)).toBe(1000);
    await repo.advanceWatermark(acc.id, 5000);
    expect(await repo.getWatermark(acc.id)).toBe(5000);
    await repo.advanceWatermark(acc.id, 3000); // older — ignored
    expect(await repo.getWatermark(acc.id)).toBe(5000);
  });
});
