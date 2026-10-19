import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { LogsRepo } from "../../src/store/logsRepo.js";
import { createPool } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import type { Pool } from "pg";

function stubPool() {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const pool = {
    calls,
    query: vi.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    }),
  };
  return pool;
}

describe("LogsRepo (stubbed pool)", () => {
  it("insertMany builds a multi-row INSERT with params in column order", async () => {
    const pool = stubPool();
    const ts = new Date("2026-06-03T00:00:00.000Z");
    await new LogsRepo(pool as any).insertMany([
      { ts, level: 50, event: "outbound_failed", accountId: 3, msg: "boom", context: { a: 1 } },
      { ts, level: 30, event: "inbound_relayed", accountId: null, msg: "ok", context: {} },
    ]);
    const call = pool.calls[0];
    expect(call.sql).toContain("INSERT INTO event_logs");
    expect(call.sql).toContain("($1, $2, $3, $4, $5, $6)");
    expect(call.sql).toContain("($7, $8, $9, $10, $11, $12)");
    expect(call.params.slice(0, 6)).toEqual([ts, 50, "outbound_failed", 3, "boom", JSON.stringify({ a: 1 })]);
    expect(call.params.slice(6)).toEqual([ts, 30, "inbound_relayed", null, "ok", JSON.stringify({})]);
  });

  it("insertMany with no rows issues no query", async () => {
    const pool = stubPool();
    await new LogsRepo(pool as any).insertMany([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("query filters by level and account, clamps limit to 1000, orders by id DESC", async () => {
    const pool = stubPool();
    await new LogsRepo(pool as any).query({ minLevel: 40, accountId: 3, limit: 99999 });
    const call = pool.calls[0];
    expect(call.sql).toContain("level >= $1");
    expect(call.sql).toContain("account_id = $2");
    expect(call.sql).toContain("ORDER BY id DESC");
    expect(call.sql).toContain("LIMIT $3");
    expect(call.params).toEqual([40, 3, 1000]);
  });

  it("query with no filters uses default limit 200 and no WHERE", async () => {
    const pool = stubPool();
    await new LogsRepo(pool as any).query({ limit: 200 });
    const call = pool.calls[0];
    expect(call.sql).not.toContain("WHERE");
    expect(call.params).toEqual([200]);
  });

  it("query maps rows, converting Date ts to ISO string", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ id: "7", ts: new Date("2026-06-03T01:02:03.000Z"), level: 50, event: "x", account_id: 3, msg: "m", context: { k: "v" } }],
        rowCount: 1,
      })),
    };
    const out = await new LogsRepo(pool as any).query({ limit: 10 });
    expect(out).toEqual([{ id: 7, ts: "2026-06-03T01:02:03.000Z", level: 50, event: "x", accountId: 3, msg: "m", context: { k: "v" }, dismissedAt: null }]);
  });

  it("prune deletes rows below max(id) - keep", async () => {
    const pool = stubPool();
    await new LogsRepo(pool as any).prune(10000);
    expect(pool.calls[0].sql).toContain("DELETE FROM event_logs");
    expect(pool.calls[0].sql).toContain("MAX(id)");
    expect(pool.calls[0].params).toEqual([10000]);
  });

  it("query selects dismissed_at and maps it to dismissedAt", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ id: "9", ts: new Date("2026-06-09T00:00:00.000Z"), level: 40, event: "e", account_id: null, msg: "m", context: {}, dismissed_at: new Date("2026-06-09T01:00:00.000Z") }],
        rowCount: 1,
      })),
    };
    const out = await new LogsRepo(pool as any).query({ limit: 10 });
    expect(pool.query.mock.calls[0][0]).toContain("dismissed_at");
    expect(out[0].dismissedAt).toBe("2026-06-09T01:00:00.000Z");
  });

  it("query maps a null dismissed_at to null", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ id: "9", ts: new Date("2026-06-09T00:00:00.000Z"), level: 40, event: null, account_id: null, msg: "m", context: {}, dismissed_at: null }],
        rowCount: 1,
      })),
    };
    const out = await new LogsRepo(pool as any).query({ limit: 10 });
    expect(out[0].dismissedAt).toBeNull();
  });

  it("query with excludeDismissed adds a dismissed_at IS NULL filter", async () => {
    const pool = stubPool();
    await new LogsRepo(pool as any).query({ excludeDismissed: true, limit: 20 });
    const call = pool.calls[0];
    expect(call.sql).toContain("dismissed_at IS NULL");
    expect(call.params).toEqual([20]);
  });

  it("dismiss issues an idempotent UPDATE and returns whether a row matched", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
    };
    const ok = await new LogsRepo(pool as any).dismiss(7);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("UPDATE event_logs");
    expect(sql).toContain("dismissed_at = COALESCE(dismissed_at, now())");
    expect(sql).toContain("WHERE id = $1");
    expect(params).toEqual([7]);
    expect(ok).toBe(true);
  });

  it("dismiss returns false when no row matches", async () => {
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    const ok = await new LogsRepo(pool as any).dismiss(999);
    expect(ok).toBe(false);
  });
});

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;
d("LogsRepo (real DB)", () => {
  let pool: Pool;
  beforeAll(async () => {
    await runMigrations(url!);
    pool = createPool(url!);
    await pool.query("TRUNCATE event_logs RESTART IDENTITY");
  });
  afterAll(async () => { if (pool) await pool.end(); });

  it("inserts, queries newest-first with filters, and prunes", async () => {
    const repo = new LogsRepo(pool);
    const ts = new Date();
    await repo.insertMany([
      { ts, level: 30, event: "inbound_relayed", accountId: 1, msg: "a", context: {} },
      { ts, level: 50, event: null, accountId: 3, msg: "b", context: { err: "x" } },
    ]);
    const errOnly = await repo.query({ minLevel: 40, limit: 10 });
    expect(errOnly.map((r) => r.msg)).toEqual(["b"]);
    const acct1 = await repo.query({ accountId: 1, limit: 10 });
    expect(acct1.map((r) => r.msg)).toEqual(["a"]);
    await repo.prune(0); // keep only the latest id
    const remaining = await repo.query({ limit: 10 });
    expect(remaining.length).toBe(1);
  });

  it("dismiss sets dismissed_at, is idempotent, and excludeDismissed hides the row", async () => {
    await pool.query("TRUNCATE event_logs RESTART IDENTITY");
    const repo = new LogsRepo(pool);
    const ts = new Date();
    await repo.insertMany([
      { ts, level: 50, event: null, accountId: 1, msg: "boom", context: {} },
      { ts, level: 50, event: null, accountId: 2, msg: "kept", context: {} },
    ]);
    const all = await repo.query({ limit: 10 });
    const target = all.find((r) => r.msg === "boom")!;
    expect(target.dismissedAt).toBeNull();

    expect(await repo.dismiss(target.id)).toBe(true);
    const afterFirst = (await repo.query({ limit: 10 })).find((r) => r.id === target.id)!;
    expect(afterFirst.dismissedAt).not.toBeNull();

    // idempotent: dismissing again keeps the original timestamp
    expect(await repo.dismiss(target.id)).toBe(true);
    const afterSecond = (await repo.query({ limit: 10 })).find((r) => r.id === target.id)!;
    expect(afterSecond.dismissedAt).toBe(afterFirst.dismissedAt);

    // unknown id → false
    expect(await repo.dismiss(999999)).toBe(false);

    // excludeDismissed hides only the dismissed row
    const active = await repo.query({ excludeDismissed: true, limit: 10 });
    expect(active.map((r) => r.msg)).toEqual(["kept"]);
  });
});
