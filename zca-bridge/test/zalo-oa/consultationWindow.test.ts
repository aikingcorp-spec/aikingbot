import { describe, it, expect } from "vitest";
import { evaluate } from "../../src/zalo-oa/consultationWindow.js";

const now = new Date("2026-06-03T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("evaluate", () => {
  it("flags out-of-window when there was never an inbound", () => {
    const d = evaluate({ lastInboundAt: null, sentCount: 0 }, now);
    expect(d.withinWindow).toBe(false);
    expect(d.newCount).toBe(0);
    expect(d.warning).toMatch(/Ngoài cửa sổ 48h/);
  });

  it("flags out-of-window past 48h and leaves the count unchanged", () => {
    const d = evaluate({ lastInboundAt: minutesAgo(48 * 60 + 1), sentCount: 5 }, now);
    expect(d.withinWindow).toBe(false);
    expect(d.newCount).toBe(5);
  });

  it("increments and stays silent below the near-limit threshold", () => {
    const d = evaluate({ lastInboundAt: minutesAgo(10), sentCount: 1 }, now);
    expect(d).toEqual({ withinWindow: true, newCount: 2, warning: null });
  });

  it("warns when the count crosses 6/8", () => {
    const d = evaluate({ lastInboundAt: minutesAgo(10), sentCount: 5 }, now);
    expect(d.newCount).toBe(6);
    expect(d.warning).toMatch(/6\/8/);
  });

  it("warns when the count reaches 8/8", () => {
    const d = evaluate({ lastInboundAt: minutesAgo(10), sentCount: 7 }, now);
    expect(d.newCount).toBe(8);
    expect(d.warning).toMatch(/hết 8/);
  });

  it("is silent at 7 (between thresholds)", () => {
    expect(evaluate({ lastInboundAt: minutesAgo(10), sentCount: 6 }, now).warning).toBeNull();
  });
});
