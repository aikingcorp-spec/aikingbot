// 1.10 mock check: recorded cachedInput on fixture calls (shaped like OpenAI-compatible usage with a stable prompt prefix).
// Live verification on a real provider is pending (no paid calls in wave 1).
import { describe, expect, it } from "vitest";
import { cacheRatio, type UsageCall } from "./usage-ledger.ts";

// A five-call tool loop: the first call warms the cache, later calls reuse the ~8k-token stable prefix.
const FIXTURE: UsageCall[] = [
  { input: 9_000, output: 220, cachedInput: 0, retries: 0 },
  { input: 9_350, output: 180, cachedInput: 8_192, retries: 0 },
  { input: 9_700, output: 160, cachedInput: 8_192, retries: 0 },
  { input: 10_100, output: 240, cachedInput: 9_216, retries: 0 },
  { input: 10_400, output: 300, cachedInput: 9_216, retries: 1 },
];

describe("1.10 cache ratio per call", () => {
  it("records a per-call ratio and reaches at least 50% on the fixture", () => {
    const result = cacheRatio(FIXTURE)!;
    expect(result.reported).toBe(5);
    expect(result.perCall[0]).toBe(0);
    expect(result.perCall.slice(1).every((ratio) => ratio! > 0.8)).toBe(true);
    expect(result.ratio).toBeGreaterThanOrEqual(0.5);
  });
  it("ignores calls without cache data and caps bad provider numbers", () => {
    expect(cacheRatio([{ input: 100, output: 1 }])).toBeNull();
    expect(cacheRatio([{ input: 100, output: 1, cachedInput: 500 }, { input: 100, output: 1 }])).toEqual({ ratio: 1, perCall: [1, null], reported: 1 });
  });
});
