import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { ConversationRepo } from "../../src/store/conversationRepo.js";
import { createPool } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { AccountRepo } from "../../src/store/accountRepo.js";
import type { Pool } from "pg";

describe("ConversationRepo consultation (stubbed pool)", () => {
  it("markInbound sets last_inbound_at=now() and resets cs_sent_count", async () => {
    const calls: any[] = [];
    const pool = { query: vi.fn(async (sql: string, params: any[]) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; }) };
    await new ConversationRepo(pool as any).markInbound(3, "oa-user:u1");
    expect(calls[0].sql).toContain("UPDATE zalo_conversations");
    expect(calls[0].sql).toContain("last_inbound_at = now()");
    expect(calls[0].sql).toContain("cs_sent_count = 0");
    expect(calls[0].params).toEqual([3, "oa-user:u1"]);
  });

  it("getWindow maps a row to { lastInboundAt, sentCount }", async () => {
    const ts = new Date("2026-06-03T00:00:00.000Z");
    const pool = { query: vi.fn(async () => ({ rows: [{ last_inbound_at: ts, cs_sent_count: 4 }], rowCount: 1 })) };
    expect(await new ConversationRepo(pool as any).getWindow(3, "oa-user:u1")).toEqual({ lastInboundAt: ts, sentCount: 4 });
  });

  it("getWindow defaults to { null, 0 } when there is no row", async () => {
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    expect(await new ConversationRepo(pool as any).getWindow(3, "x")).toEqual({ lastInboundAt: null, sentCount: 0 });
  });

  it("setCsCount updates the counter", async () => {
    const calls: any[] = [];
    const pool = { query: vi.fn(async (sql: string, params: any[]) => { calls.push({ sql, params }); return { rowCount: 1 }; }) };
    await new ConversationRepo(pool as any).setCsCount(3, "oa-user:u1", 5);
    expect(calls[0].sql).toContain("SET cs_sent_count = $3");
    expect(calls[0].params).toEqual([3, "oa-user:u1", 5]);
  });
});

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;
d("ConversationRepo consultation (real DB)", () => {
  let pool: Pool;
  beforeAll(async () => { await runMigrations(url!); pool = createPool(url!); await pool.query("TRUNCATE zalo_accounts RESTART IDENTITY CASCADE"); });
  afterAll(async () => { if (pool) await pool.end(); });

  it("marks inbound, reads the window, and updates the count", async () => {
    const acc = await new AccountRepo(pool).createOa({ label: "OA", chatwootInboxIdentifier: "ci-oa" });
    const repo = new ConversationRepo(pool);
    await repo.saveChatwootId(acc.id, "oa-user:u1", 10);
    await repo.setCsCount(acc.id, "oa-user:u1", 3);
    let w = await repo.getWindow(acc.id, "oa-user:u1");
    expect(w.sentCount).toBe(3);
    await repo.markInbound(acc.id, "oa-user:u1");
    w = await repo.getWindow(acc.id, "oa-user:u1");
    expect(w.sentCount).toBe(0);
    expect(w.lastInboundAt).toBeInstanceOf(Date);
  });
});
