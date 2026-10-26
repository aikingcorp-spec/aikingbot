import { describe, expect, it } from "vitest";

import { CallTrace, DEFAULT_LIMITS, MAX_ID_LENGTH, normalizeUsage } from "./call-trace.ts";

const V = (i: number, o = 1) => ({ inputTotal: i, cacheRead: 0, cacheWrite: 0, output: o });
const begin = (t: CallTrace, callId: string, extra: Record<string, unknown> = {}) =>
  t.event({ type: "begin", eventId: "b-" + callId, callId, logicalCallId: "L-" + callId, attempt: 1, generation: "g", ...extra });
const usage = (t: CallTrace, callId: string, seq: number, values: unknown, extra: Record<string, unknown> = {}) =>
  t.event({ type: "usage", eventId: `u-${callId}-${seq}`, callId, usageSeq: seq, generation: "g", scope: "call", mode: "delta", basis: "inclusive", values, ...extra });
const end = (t: CallTrace, callId: string, outcome = "success") => t.event({ type: "end", eventId: "e-" + callId, callId, outcome });

describe("caps are exact", () => {
  it("ids: 128 characters are accepted, 129 are invalid", () => {
    const t = new CallTrace();
    begin(t, "a".repeat(MAX_ID_LENGTH), { logicalCallId: "L", eventId: "e1" });
    begin(t, "a".repeat(MAX_ID_LENGTH + 1), { logicalCallId: "L2", eventId: "e2" });
    expect(t.result().attemptCalls).toBe(1);
    expect(t.result().invalidEvents).toBe(1);
    expect(MAX_ID_LENGTH).toBe(128);
  });
  it("calls: the 256th is kept, the 257th is dropped and counted", () => {
    const t = new CallTrace();
    for (let i = 0; i < DEFAULT_LIMITS.maxCalls + 1; i++) begin(t, "c" + i);
    const r = t.result();
    expect(r.attemptCalls).toBe(256);
    expect(r.dropped.calls).toBe(1);
    expect(r.totals.inputTotal.complete).toBe(false);
  });
  it("quarantine: 64 kept, the 65th dropped and counted", () => {
    const t = new CallTrace(); begin(t, "c"); end(t, "c");
    for (let i = 1; i <= 65; i++) usage(t, "c", i, V(1));
    const r = t.result();
    expect(r.lateQuarantine).toHaveLength(64);
    expect(r.dropped.quarantine).toBe(1);
    expect(r.lateUsageEvents).toBe(65);
  });
  it("usage per call: 128 kept, the 129th dropped and counted", () => {
    const t = new CallTrace(); begin(t, "c");
    for (let i = 1; i <= 129; i++) usage(t, "c", i, V(1, 0));
    const r = t.result();
    expect(r.calls[0]!.metrics.inputTotal).toBe(128);
    expect(r.dropped.usage).toBe(1);
    expect(r.calls[0]!.diagnostics).toContain("usage-cap");
  });
  it("seen events: the 4096th is kept, the 4097th is dropped, and old events are not re-booked", () => {
    const t = new CallTrace(); begin(t, "c"); usage(t, "c", 1, V(5, 0));
    for (let i = 0; i < DEFAULT_LIMITS.maxEvents - 2; i++) t.event({ type: "end", eventId: "o" + i, callId: "ghost" });
    expect(t.result().dropped.events).toBe(0);
    t.event({ type: "end", eventId: "overflow", callId: "ghost" });
    expect(t.result().dropped.events).toBe(1);
    usage(t, "c", 1, V(5, 0)); // retransmit of an event that is still remembered
    expect(t.result().calls[0]!.metrics.inputTotal).toBe(5);
    expect(t.result().totals.inputTotal.complete).toBe(false);
  });
  it("custom limits are honoured and must be positive integers", () => {
    const t = new CallTrace({ limits: { maxCalls: 2 } });
    for (const c of ["a", "b", "c"]) begin(t, c);
    expect(t.result().attemptCalls).toBe(2);
    expect(t.result().limits.maxCalls).toBe(2);
    expect(() => new CallTrace({ limits: { maxEvents: 0 } })).toThrow(RangeError);
  });
});

describe("retry binding", () => {
  it("retry needs a terminal parent of the same logical call and the next attempt", () => {
    const t = new CallTrace(); begin(t, "a", { logicalCallId: "L", eventId: "e1" });
    begin(t, "b", { logicalCallId: "L", attempt: 2, parentCallId: "a" }); // parent still running
    expect(t.result().invalidEvents).toBe(1);
    end(t, "a", "error");
    begin(t, "c", { logicalCallId: "OTHER", attempt: 2, parentCallId: "a" }); // other logical call
    begin(t, "d", { logicalCallId: "L", attempt: 3, parentCallId: "a" }); // skipped attempt
    expect(t.result().invalidEvents).toBe(3);
    begin(t, "e", { logicalCallId: "L", attempt: 2, parentCallId: "a" });
    begin(t, "f", { logicalCallId: "L", attempt: 2, parentCallId: "a" }); // second child of a, same attempt
    const r = t.result();
    expect(r.attemptCalls).toBe(2);
    expect(r.retries).toBe(1);
    expect(r.logicalCalls).toBe(1);
    expect(r.invalidEvents).toBe(4);
  });
  it("resume only on a later attempt", () => {
    const t = new CallTrace(); begin(t, "a", { resume: true });
    expect(t.result().attemptCalls).toBe(0);
    expect(t.result().invalidEvents).toBe(1);
  });
});

describe("model and provider refs", () => {
  it("only catalog names are shown, anything else is unknown, absent is null", () => {
    const t = new CallTrace({ catalog: { models: ["m-1"], providers: ["p.one"] } });
    begin(t, "a", { modelRef: "m-1", providerRef: "p.one" });
    begin(t, "b", { modelRef: "gpt-secret-name", providerRef: "x".repeat(500) });
    begin(t, "c");
    const [a, b, c] = t.result().calls;
    expect([a!.model, a!.provider]).toEqual(["m-1", "p.one"]);
    expect([b!.model, b!.provider]).toEqual(["unknown", "unknown"]);
    expect([c!.model, c!.provider]).toEqual([null, null]);
    expect(JSON.stringify(t.result())).not.toContain("gpt-secret-name");
  });
  it("no catalog means every ref is unknown; bad catalog names throw", () => {
    const t = new CallTrace(); begin(t, "a", { modelRef: "m-1" });
    expect(t.result().calls[0]!.model).toBe("unknown");
    expect(() => new CallTrace({ catalog: { models: ["Bad Name"] } })).toThrow(RangeError);
    expect(() => new CallTrace({ catalog: { models: ["unknown"] } })).toThrow(RangeError);
  });
});

describe("normalizeUsage", () => {
  it("exclusive input adds both caches; unknown basis yields no input and no fresh", () => {
    expect(normalizeUsage({ inputTotal: 10, cacheRead: 4, cacheWrite: 2, output: 1 }, "exclusive").metrics.inputTotal).toBe(16);
    expect(normalizeUsage({ inputTotal: 10, cacheRead: 4, cacheWrite: null, output: 1 }, "exclusive").metrics.inputTotal).toBeNull();
    const u = normalizeUsage({ inputTotal: 10, cacheRead: 4, cacheWrite: 0, output: 1 }, "unknown");
    expect(u.freshInput).toBeNull();
    expect(u.metrics.inputTotal).toBeNull();
  });
  it("a counter below its baseline resets the whole report", () => {
    const n = normalizeUsage({ inputTotal: 4, cacheRead: 9, cacheWrite: 0, output: 1 }, "inclusive", { inputTotal: 10, cacheRead: 1, cacheWrite: 0, output: 0 });
    expect(Object.values(n.metrics).every((x) => x === null)).toBe(true);
    expect(n.issues).toEqual(["counter-reset"]);
  });
});

describe("scope rules", () => {
  it("delta is call scope only", () => {
    const t = new CallTrace(); begin(t, "a");
    usage(t, "a", 1, V(70), { scope: "session", mode: "delta", baseline: { scope: "session", generation: "g", values: V(40) } });
    expect(t.result().calls[0]!.metrics.inputTotal).toBeNull();
    expect(t.result().calls[0]!.diagnostics).toContain("unsupported-scoped-delta");
  });
  it("every non-call scope needs a baseline of its own scope and generation", () => {
    for (const scope of ["turn", "session", "process"]) {
      const t = new CallTrace(); begin(t, "a");
      usage(t, "a", 1, V(70), { scope, mode: "snapshot", baseline: { scope: "call", generation: "g", values: V(40) } });
      usage(t, "a", 2, V(70), { scope, mode: "snapshot", baseline: { scope, generation: "other", values: V(40) } });
      usage(t, "a", 3, V(70), { scope, mode: "snapshot", baseline: { scope, generation: "g", values: V(40, 0) } });
      expect(t.result().calls[0]!.metrics.inputTotal).toBe(30);
      expect(t.result().calls[0]!.diagnostics).toContain("missing-baseline");
    }
  });
  it("a wrong baseline from the adapter cannot be detected: the adapter is trusted", () => {
    const t = new CallTrace(); begin(t, "a");
    usage(t, "a", 1, V(70), { scope: "session", mode: "snapshot", baseline: { scope: "session", generation: "g", values: V(0, 0) } });
    expect(t.result().calls[0]!.metrics.inputTotal).toBe(70);
  });
  it("a different generation than begin is unknown", () => {
    const t = new CallTrace(); begin(t, "a"); usage(t, "a", 1, V(10)); usage(t, "a", 2, V(99), { generation: "g2" });
    expect(t.result().calls[0]!.metrics.inputTotal).toBe(10);
    expect(t.result().calls[0]!.diagnostics).toContain("generation-reset");
  });
});

describe("V2 boundary, overflow and contract lock", () => {
  it("canonical signature stays small for 16 KiB refs and is computed once", () => {
    const t = new CallTrace();
    const stringify = JSON.stringify; let max = 0;
    try {
      JSON.stringify = ((...a: unknown[]) => { const r = (stringify as (...x: unknown[]) => string)(...a); max = Math.max(max, r?.length ?? 0); return r; }) as typeof JSON.stringify;
      begin(t, "c", { modelRef: "x".repeat(16384), providerRef: "y".repeat(16384) });
    } finally { JSON.stringify = stringify; }
    expect(max).toBeLessThan(1024);
    expect(t.result().calls[0]!.model).toBe("unknown");
  });
  it("a non-string ref is rejected before any state change and does not consume dedupe", () => {
    const t = new CallTrace();
    begin(t, "c", { modelRef: { toJSON: () => "x" } });
    expect(t.result().invalidEvents).toBe(1);
    begin(t, "c");
    expect(t.result().attemptCalls).toBe(1);
    expect(t.result().duplicateEvents).toBe(0);
  });
  it("exclusive overflow nulls only inputTotal with numeric-overflow; other metrics stay known", () => {
    const n = normalizeUsage({ inputTotal: Number.MAX_SAFE_INTEGER, cacheRead: 1, cacheWrite: 0, output: 7 }, "exclusive");
    expect(n.metrics).toEqual({ inputTotal: null, cacheRead: 1, cacheWrite: 0, output: 7 });
    expect(n.issues).toContain("numeric-overflow");
    expect(n.freshInput).toBeNull();
    const t = new CallTrace(); begin(t, "c");
    for (const mode of ["snapshot", "cumulative"]) usage(t, "c", mode === "snapshot" ? 1 : 2, { inputTotal: Number.MAX_SAFE_INTEGER, cacheRead: 1, cacheWrite: 0, output: 7 }, { basis: "exclusive", mode, ...(mode === "cumulative" ? { scope: "session", baseline: { scope: "session", generation: "g", values: V(0, 0) } } : {}) });
    const c = t.result().calls[0]!;
    expect(c.metrics.inputTotal).toBeNull();
    expect(c.diagnostics).toContain("numeric-overflow");
  });
  it("fresh input never uses an unsafe cache sum", () => {
    const n = normalizeUsage({ inputTotal: Number.MAX_SAFE_INTEGER, cacheRead: Number.MAX_SAFE_INTEGER, cacheWrite: Number.MAX_SAFE_INTEGER, output: 0 }, "inclusive");
    expect(n.freshInput).toBeNull();
  });
  it("all-null or malformed reports do not lock; a usable report still locks", () => {
    for (const first of [{ values: null }, { values: "x" }, { values: {} }]) {
      const t = new CallTrace(); begin(t, "c");
      usage(t, "c", 1, null, { mode: "snapshot", ...first });
      usage(t, "c", 2, V(15), { mode: "delta" });
      expect(t.result().calls[0]!.metrics.inputTotal).toBe(15);
    }
    const t = new CallTrace(); begin(t, "c");
    usage(t, "c", 1, V(10), { mode: "snapshot" });
    usage(t, "c", 2, V(5), { mode: "delta" });
    expect(t.result().calls[0]!.diagnostics).toContain("usage-contract-changed");
    expect(t.result().calls[0]!.metrics.inputTotal).toBe(10);
  });
  it("malformed baseline values do not lock, and null never becomes 0", () => {
    const t = new CallTrace(); begin(t, "c");
    for (const bv of [null, "x", {}]) usage(t, "c", bv === null ? 1 : bv === "x" ? 2 : 3, V(110), { scope: "session", mode: "cumulative", baseline: { scope: "session", generation: "g", values: bv } });
    usage(t, "c", 4, V(110), { scope: "session", mode: "cumulative", baseline: { scope: "session", generation: "g", values: V(100) } });
    const c = t.result().calls[0]!;
    expect(c.metrics.inputTotal).toBe(10);
    expect(t.result().totals.inputTotal.complete).toBe(false);
  });
});
