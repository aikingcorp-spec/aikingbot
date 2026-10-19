import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { AccountRepo } from "../../src/store/accountRepo.js";
import { InfoCardRepo } from "../../src/store/infoCardRepo.js";
import type { Pool } from "pg";

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: Pool;

beforeAll(async () => {
  if (!url) return;
  await runMigrations(url);
  pool = createPool(url);
  await pool.query("TRUNCATE zalo_accounts, oa_info_card RESTART IDENTITY CASCADE");
});
afterAll(async () => { if (pool) await pool.end(); });

d("InfoCardRepo", () => {
  it("returns defaults (disabled, empty image) when no row exists", async () => {
    const acc = await new AccountRepo(pool).createOa({ label: "OA", chatwootInboxIdentifier: "ci-card-1" });
    const repo = new InfoCardRepo(pool);
    const row = await repo.get(acc.id);
    expect(row.enabled).toBe(false);
    expect(row.imageUrl).toBe("");
    expect(row.title.length).toBeGreaterThan(0);
  });

  it("upserts and reads back the card config", async () => {
    const acc = await new AccountRepo(pool).createOa({ label: "OA2", chatwootInboxIdentifier: "ci-card-2" });
    const repo = new InfoCardRepo(pool);
    await repo.upsert(acc.id, { enabled: true, title: "T", subtitle: "S", imageUrl: "https://x/y.png" });
    expect(await repo.get(acc.id)).toEqual({ enabled: true, title: "T", subtitle: "S", imageUrl: "https://x/y.png" });
    await repo.upsert(acc.id, { enabled: false, title: "T2", subtitle: "S2", imageUrl: "https://x/z.png" });
    expect((await repo.get(acc.id)).title).toBe("T2");
  });
});
