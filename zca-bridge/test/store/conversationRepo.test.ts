import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { AccountRepo } from "../../src/store/accountRepo.js";
import { ConversationRepo } from "../../src/store/conversationRepo.js";
import type { Pool } from "pg";

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: Pool;

beforeAll(async () => {
  if (!url) return;
  await runMigrations(url);
  pool = createPool(url);
  await pool.query("TRUNCATE zalo_accounts, zalo_conversations RESTART IDENTITY CASCADE");
});
afterAll(async () => { if (pool) await pool.end(); });

d("ConversationRepo", () => {
  it("returns null then persists and reuses the conversation id", async () => {
    const acc = await new AccountRepo(pool).create({ label: "C", chatwootInboxIdentifier: "ci-1" });
    const repo = new ConversationRepo(pool);
    expect(await repo.getChatwootId(acc.id, "user:1")).toBeNull();
    await repo.saveChatwootId(acc.id, "user:1", 500);
    expect(await repo.getChatwootId(acc.id, "user:1")).toBe(500);
  });

  it("keeps the first id on conflicting save (idempotent)", async () => {
    const acc = await new AccountRepo(pool).create({ label: "C2", chatwootInboxIdentifier: "ci-2" });
    const repo = new ConversationRepo(pool);
    await repo.saveChatwootId(acc.id, "user:9", 600);
    await repo.saveChatwootId(acc.id, "user:9", 999); // conflict -> ignored
    expect(await repo.getChatwootId(acc.id, "user:9")).toBe(600);
  });

  it("atomically claims the info-request slot once and releases it", async () => {
    const acc = await new AccountRepo(pool).create({ label: "IR", chatwootInboxIdentifier: "ci-ir" });
    const repo = new ConversationRepo(pool);
    await repo.saveChatwootId(acc.id, "oa-user:ir1", 700);
    expect(await repo.getInfoRequestedAt(acc.id, "oa-user:ir1")).toBeNull();
    // first claim wins, second loses (already claimed)
    expect(await repo.claimInfoRequest(acc.id, "oa-user:ir1", new Date("2026-06-03T00:00:00Z"))).toBe(true);
    expect(await repo.claimInfoRequest(acc.id, "oa-user:ir1", new Date("2026-06-04T00:00:00Z"))).toBe(false);
    expect(await repo.getInfoRequestedAt(acc.id, "oa-user:ir1")).toBeInstanceOf(Date);
    // releasing lets a future claim win again
    await repo.releaseInfoRequest(acc.id, "oa-user:ir1");
    expect(await repo.getInfoRequestedAt(acc.id, "oa-user:ir1")).toBeNull();
    expect(await repo.claimInfoRequest(acc.id, "oa-user:ir1", new Date())).toBe(true);
  });

  it("claim returns false when the conversation row is absent", async () => {
    const acc = await new AccountRepo(pool).create({ label: "IR2", chatwootInboxIdentifier: "ci-ir2" });
    const repo = new ConversationRepo(pool);
    expect(await repo.claimInfoRequest(acc.id, "oa-user:missing", new Date())).toBe(false);
  });
});
