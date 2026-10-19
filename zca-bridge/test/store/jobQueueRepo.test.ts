import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createPool } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { JobQueueRepo } from "../../src/store/jobQueueRepo.js";
import type { Pool } from "pg";

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: Pool;

beforeAll(async () => {
  if (!url) return;
  await runMigrations(url);
  pool = createPool(url);
});
beforeEach(async () => { if (pool) await pool.query("TRUNCATE job_queue RESTART IDENTITY"); });
afterAll(async () => { if (pool) await pool.end(); });

d("JobQueueRepo", () => {
  it("enqueues idempotently by (kind, dedup_key)", async () => {
    const q = new JobQueueRepo(pool);
    expect(await q.enqueue("inbound", "acct1:m1", { a: 1 })).toBe(true);
    expect(await q.enqueue("inbound", "acct1:m1", { a: 1 })).toBe(false); // duplicate ignored
  });

  it("claims a pending job exactly once and marks done", async () => {
    const q = new JobQueueRepo(pool);
    await q.enqueue("outbound", "msg-7", { hello: "world" });
    const job = await q.claimNext();
    expect(job?.payload).toEqual({ hello: "world" });
    expect(job?.attempts).toBe(1);
    expect(await q.claimNext()).toBeNull(); // already processing -> not re-claimed immediately
    await q.markDone(job!.id);
  });

  it("retries with backoff, then dead-letters at max_attempts", async () => {
    const q = new JobQueueRepo(pool);
    await q.enqueue("outbound", "msg-fail", { x: 1 });
    await pool.query("UPDATE job_queue SET max_attempts = 1 WHERE dedup_key = 'msg-fail'");
    const job = await q.claimNext();             // attempts -> 1
    const res = await q.markRetry(job!.id, "boom", 0); // attempts(1) >= max(1) => failed
    expect(res.status).toBe("failed");
    const failed = await q.listFailed();
    expect(failed.map((f) => f.dedupKey)).toContain("msg-fail");
  });

  it("reclaims a stale processing job", async () => {
    const q = new JobQueueRepo(pool);
    await q.enqueue("inbound", "stale-1", { y: 2 });
    const job = await q.claimNext();
    await pool.query("UPDATE job_queue SET updated_at = now() - interval '10 minutes' WHERE id = $1", [job!.id]);
    const reclaimed = await q.claimNext(); // stale processing reclaimed
    expect(reclaimed?.id).toBe(job!.id);
    expect(reclaimed?.attempts).toBe(2);
  });
});
