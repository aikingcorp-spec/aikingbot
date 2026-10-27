import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendUsage, flushUsageLedger, readUsage, topSources, usageSourceOf, type UsageRow } from "./usage-ledger.ts";

const base = { botId: "b", botName: "B", instanceId: "i", driverKind: "openai-compat", model: "m", costUsd: null } as const;
const row = (over: Partial<UsageRow>): UsageRow => ({ ...base, at: "2026-10-26T00:00:00.000Z", threadId: "t", input: 10, output: 5, trigger: { kind: "owner" }, ...over });

describe("5.1 / 5.2 / 5.3 usage sources and per-call rows", () => {
  it("books source, per-call usage and retries, and reads them back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-src-"));
    await appendUsage(dir, { ...base, at: "2026-10-26T01:00:00.000Z", threadId: "t1", input: 300, output: 40, cachedInput: 200, trigger: { kind: "owner" }, source: "voice", retries: 1,
      calls: [{ input: 100, output: 10, cachedInput: 0 }, { input: 200, output: 30, cachedInput: 200 }] });
    await flushUsageLedger(dir);
    const [read] = readUsage(dir, { from: new Date("2026-10-25"), to: new Date("2026-10-27") });
    expect(read).toMatchObject({ source: "voice", retries: 1, calls: [{ input: 100, output: 10, cachedInput: 0 }, { input: 200, output: 30, cachedInput: 200 }] });
  });
  it("drops an unknown source and caps calls", async () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-src-"));
    await appendUsage(dir, { ...base, threadId: "t", input: 1, output: 1, trigger: { kind: "owner" }, source: "bogus" as never, calls: Array.from({ length: 100 }, () => ({ input: 1, output: 1 })) });
    await flushUsageLedger(dir);
    const [read] = readUsage(dir, { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) });
    expect(read!.source).toBeUndefined();
    expect(read!.calls).toHaveLength(64);
  });
  it("derives a source for pre-rc8 rows", () => {
    expect(usageSourceOf(row({ trigger: { kind: "routine", routineId: "r" } }))).toBe("routine");
    expect(usageSourceOf(row({ threadId: "memory-x", trigger: { kind: "bot" } }))).toBe("summary");
    expect(usageSourceOf(row({ trigger: { kind: "bot" } }))).toBe("bot");
    expect(usageSourceOf(row({}))).toBe("chat");
  });
  it("ranks the top 5 sources over the last 7 days", () => {
    const now = new Date("2026-10-27T00:00:00.000Z");
    const rows = [
      row({ source: "chat", input: 100 }), row({ source: "voice", input: 500 }), row({ source: "routine", input: 50 }),
      row({ threadId: "skill-review-1", trigger: { kind: "bot" }, input: 20 }), row({ source: "bot", input: 1 }),
      row({ source: "chat", input: 9999, at: "2026-10-10T00:00:00.000Z" }),
    ];
    const top = topSources(rows, now);
    expect(top.map((t) => t.source)).toEqual(["voice", "chat", "routine", "summary", "bot"]);
    expect(top[1]!.tokens).toBe(105);
  });
});
