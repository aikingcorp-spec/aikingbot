import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { AccountRepo } from "../../src/store/accountRepo.js";
import { MappingRepo } from "../../src/store/mappingRepo.js";
import type { Pool } from "pg";

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

let pool: Pool;
beforeAll(async () => {
  if (!url) return;
  await runMigrations(url);
  pool = createPool(url);
  await pool.query("TRUNCATE zalo_accounts, zalo_sessions, message_map RESTART IDENTITY CASCADE");
});
afterAll(async () => { if (pool) await pool.end(); });

d("AccountRepo", () => {
  it("creates and reads an account", async () => {
    const repo = new AccountRepo(pool);
    const acc = await repo.create({ label: "Sales", chatwootInboxIdentifier: "ident-1" });
    expect(acc.id).toBeGreaterThan(0);
    expect(acc.status).toBe("pending_qr");
    const found = await repo.findByInboxIdentifier("ident-1");
    expect(found?.id).toBe(acc.id);
  });

  it("updates status", async () => {
    const repo = new AccountRepo(pool);
    const acc = await repo.create({ label: "Support", chatwootInboxIdentifier: "ident-2" });
    await repo.updateStatus(acc.id, "connected");
    const found = await repo.findById(acc.id);
    expect(found?.status).toBe("connected");
  });
});

d("MappingRepo", () => {
  it("records a mapping idempotently", async () => {
    const accRepo = new AccountRepo(pool);
    const acc = await accRepo.create({ label: "M", chatwootInboxIdentifier: "ident-3" });
    const repo = new MappingRepo(pool);
    const first = await repo.recordIfNew({
      zaloAccountId: acc.id, zaloMsgId: "m1", zaloThreadId: "t1", direction: "in", chatwootMessageId: 10,
    });
    const dup = await repo.recordIfNew({
      zaloAccountId: acc.id, zaloMsgId: "m1", zaloThreadId: "t1", direction: "in", chatwootMessageId: 99,
    });
    expect(first).toBe(true);
    expect(dup).toBe(false); // already seen -> not re-inserted
  });

  it("findByZaloMsgId returns the row for a known msg id, null otherwise", async () => {
    const accRepo = new AccountRepo(pool);
    const acc = await accRepo.create({ label: "FZ", chatwootInboxIdentifier: "ident-fz" });
    const repo = new MappingRepo(pool);
    await repo.recordIfNew({
      zaloAccountId: acc.id, zaloMsgId: "zm-1", zaloThreadId: "t9", direction: "out", chatwootMessageId: 555,
    });
    expect(await repo.findByZaloMsgId(acc.id, "zm-1")).toEqual({ chatwootMessageId: 555, direction: "out" });
    expect(await repo.findByZaloMsgId(acc.id, "missing")).toBeNull();
  });

  it("findByChatwootMessageId returns the linked zalo msg id, null otherwise", async () => {
    const accRepo = new AccountRepo(pool);
    const acc = await accRepo.create({ label: "FC", chatwootInboxIdentifier: "ident-fc" });
    const repo = new MappingRepo(pool);
    await repo.recordIfNew({
      zaloAccountId: acc.id, zaloMsgId: "zm-2", zaloThreadId: "t9", direction: "out", chatwootMessageId: 777,
    });
    expect(await repo.findByChatwootMessageId(777)).toEqual({ zaloMsgId: "zm-2" });
    expect(await repo.findByChatwootMessageId(999999)).toBeNull();
  });
});
