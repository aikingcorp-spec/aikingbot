import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DbLogStream } from "../../src/logging/dbLogStream.js";
import type { LogRow } from "../../src/store/logsRepo.js";

const errLine = (i: number) => JSON.stringify({ level: 50, time: 1, msg: String(i) });
const tick = () => new Promise((r) => setImmediate(r));

describe("DbLogStream", () => {
  it("flush() inserts queued rows once", async () => {
    const insert = vi.fn(async (_: LogRow[]) => {});
    const s = new DbLogStream({ insert, batchSize: 100 });
    s.write(errLine(1));
    s.write(errLine(2));
    await s.flush();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0].map((r) => r.msg)).toEqual(["1", "2"]);
  });

  it("auto-flushes when the batch size is reached", async () => {
    const insert = vi.fn(async (_: LogRow[]) => {});
    const s = new DbLogStream({ insert, batchSize: 3 });
    s.write(errLine(1)); s.write(errLine(2)); s.write(errLine(3));
    await tick();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0].length).toBe(3);
  });

  it("flushes on the interval timer", async () => {
    vi.useFakeTimers();
    const insert = vi.fn(async (_: LogRow[]) => {});
    const s = new DbLogStream({ insert, batchSize: 100, intervalMs: 1000 });
    s.write(errLine(1));
    expect(insert).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(insert).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("drops the oldest rows past the queue cap", async () => {
    const insert = vi.fn(async (_: LogRow[]) => {});
    const s = new DbLogStream({ insert, batchSize: 1000, queueCap: 3 });
    for (let i = 1; i <= 5; i++) s.write(errLine(i));
    await s.flush();
    expect(insert.mock.calls[0][0].map((r) => r.msg)).toEqual(["3", "4", "5"]);
  });

  it("swallows insert errors and clears the batch", async () => {
    const insert = vi.fn(async () => { throw new Error("db down"); });
    const s = new DbLogStream({ insert, batchSize: 100 });
    s.write(errLine(1));
    await expect(s.flush()).resolves.toBeUndefined();
    insert.mockResolvedValueOnce(undefined as any);
    await s.flush(); // queue already cleared → nothing to insert
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("prunes every Nth successful flush", async () => {
    const insert = vi.fn(async (_: LogRow[]) => {});
    const prune = vi.fn(async (_: number) => {});
    const s = new DbLogStream({ insert, prune, batchSize: 100, pruneEveryFlushes: 2, retentionRows: 7 });
    s.write(errLine(1)); await s.flush();
    expect(prune).not.toHaveBeenCalled();
    s.write(errLine(2)); await s.flush();
    expect(prune).toHaveBeenCalledWith(7);
  });
});
