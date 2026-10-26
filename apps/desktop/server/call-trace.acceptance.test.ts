// Independent probes ported from the Dev review of the G4 V2 prototype (R6, R7, P5, P6, L3, A1, A2) plus the 14 closed GAPs.
// Uses only the shared API surface so the same file also runs against the prototype for the before/after record.
import { describe, expect, it } from "vitest";

import { CallTrace } from "./call-trace.ts";

const V = (i: number, o = 1, cr = 0, cw = 0) => ({ inputTotal: i, cacheRead: cr, cacheWrite: cw, output: o });
const begin = (t: CallTrace, callId = "c1", extra: Record<string, unknown> = {}) =>
  t.event({ type: "begin", eventId: "b-" + callId, callId, logicalCallId: "l1", attempt: 1, generation: "g1", ...extra });
const mk = () => { const t = new CallTrace(); begin(t); return t; };
const u = (t: CallTrace, seq: number, values: unknown, extra: Record<string, unknown> = {}) =>
  t.event({ type: "usage", eventId: "u" + seq + String(extra.callId ?? "") + String(extra.eid ?? ""), callId: "c1", usageSeq: seq, generation: "g1", scope: "call", mode: "delta", basis: "inclusive", values, ...extra });
const end = (t: CallTrace, outcome = "success", callId = "c1") => t.event({ type: "end", eventId: "e-" + callId, callId, outcome });
const B = (scope: string, values: unknown, generation = "g1") => ({ scope, generation, values });
const total = (t: CallTrace, k: "inputTotal" | "output" = "inputTotal") => t.result().totals[k];

describe("blockers from the independent review", () => {
  it("R6 a rejected first report does not lock the counter contract", () => {
    const t = mk();
    u(t, 1, V(9), { generation: "gBAD" });
    u(t, 2, V(10)); u(t, 3, V(10));
    expect(t.result().calls[0]!.metrics.inputTotal).toBe(20);
    expect(total(t).complete).toBe(false);
  });
  it("R7 a first cumulative without baseline does not lock the contract", () => {
    const t = mk();
    u(t, 1, V(5000), { mode: "cumulative", scope: "process" });
    u(t, 2, V(1100), { mode: "cumulative", scope: "process", baseline: B("process", V(1000)) });
    expect(t.result().calls[0]!.metrics.inputTotal).toBe(100);
  });
  it("R7b a usable report still locks: a different later contract is unknown", () => {
    const t = mk();
    u(t, 1, V(10), { mode: "snapshot" });
    u(t, 2, V(5), { mode: "delta" });
    expect(total(t).knownLowerBound).toBe(10);
    expect(t.result().calls[0]!.diagnostics).toContain("usage-contract-changed");
  });
  it("P6 a getter that throws becomes invalidEvents, not an exception", () => {
    const t = mk();
    expect(() => t.event({ get callId(): string { throw new Error("boom"); } })).not.toThrow();
    expect(() => t.event({ type: "usage", eventId: "x", callId: "c1", usageSeq: 1, generation: "g1", scope: "call", mode: "delta", basis: "inclusive", get values(): unknown { throw new Error("boom"); } })).not.toThrow();
    expect(t.result().invalidEvents).toBe(2);
    expect(total(t).knownLowerBound).toBe(0);
  });
  it("P6b null and non-object events are invalid", () => {
    const t = mk();
    t.event(null); t.event(undefined); t.event("x"); t.event(7);
    expect(t.result().invalidEvents).toBe(4);
  });
  it("P5 a 1 MB id is rejected", () => {
    const t = new CallTrace();
    begin(t, "x".repeat(1_000_000));
    expect(t.result().invalidEvents).toBe(1);
    expect(t.result().attemptCalls).toBe(0);
  });
  it("L3 a late flood keeps at most 64 quarantined and is incomplete", () => {
    const t = mk(); end(t);
    for (let i = 1; i <= 5000; i++) u(t, i, V(1));
    const r = t.result();
    expect(r.lateQuarantine.length).toBeLessThanOrEqual(64);
    expect(r.totals.inputTotal.knownLowerBound).toBe(0);
    expect(r.totals.inputTotal.complete).toBe(false);
  });
  it("A1 an aggregate past MAX_SAFE_INTEGER is flagged incomplete", () => {
    const t = new CallTrace();
    for (const c of ["c1", "c2"]) {
      begin(t, c, { logicalCallId: c });
      u(t, 1, V(Number.MAX_SAFE_INTEGER, 0), { callId: c, mode: "snapshot" });
      end(t, "success", c);
    }
    const k = total(t);
    expect(Number.isSafeInteger(k.knownLowerBound)).toBe(true);
    expect(k.complete).toBe(false);
  });
  it("A2 attempt 1 may not carry a parent", () => {
    const t = mk(); end(t);
    begin(t, "c9", { logicalCallId: "lZ", parentCallId: "c1" });
    expect(t.result().attemptCalls).toBe(1);
    expect(t.result().invalidEvents).toBe(1);
  });
});

describe("the 14 closed GAPs stay closed", () => {
  it("1b delta retransmit with a new eventId is not added", () => {
    const t = mk(); u(t, 1, V(10)); u(t, 1, V(10), { eid: "r" });
    expect(total(t).knownLowerBound).toBe(10);
    expect(t.result().staleUsage).toBe(1);
    expect(t.result().conflicts).toBe(0);
  });
  it("2a cumulative without baseline is null with missing-baseline", () => {
    const t = mk(); u(t, 1, V(5000), { mode: "cumulative", scope: "process" });
    const c = t.result().calls[0]!;
    expect(c.metrics.inputTotal).toBeNull();
    expect(c.diagnostics).toContain("missing-baseline");
  });
  it("2c cumulative going backwards keeps the lower bound", () => {
    const t = mk();
    for (const [seq, n] of [[1, 1100], [2, 1050]] as const) u(t, seq, V(n), { mode: "cumulative", scope: "process", baseline: B("process", V(1000)) });
    expect(total(t).knownLowerBound).toBe(100);
    expect(total(t).complete).toBe(false);
  });
  it("3a an empty snapshot does not erase known usage", () => {
    const t = mk(); u(t, 1, V(40), { mode: "snapshot" }); u(t, 2, {}, { mode: "snapshot" });
    expect(total(t).knownLowerBound).toBe(40);
    expect(total(t).complete).toBe(false);
  });
  it("5a usage before begin is an orphan, the stream goes on", () => {
    const t = new CallTrace(); u(t, 1, V(1)); begin(t); u(t, 2, V(2));
    expect(t.result().orphanEvents).toBe(1);
    expect(total(t).knownLowerBound).toBe(2);
  });
  it("5b an older seq arriving last does not overwrite", () => {
    const t = mk(); u(t, 2, V(80), { mode: "snapshot" }); u(t, 1, V(40), { mode: "snapshot" });
    expect(total(t).knownLowerBound).toBe(80);
    expect(total(t).complete).toBe(false);
  });
  it("5c end before begin is an orphan", () => {
    const t = new CallTrace(); end(t); begin(t);
    expect(t.result().orphanEvents).toBe(1);
    expect(t.result().attemptCalls).toBe(1);
  });
  it("6c late usage is quarantined, not booked, and the body never appears", () => {
    const t = mk(); end(t); u(t, 1, V(500), { toolBody: "SYNTHETIC_BODY" });
    expect(t.result().lateQuarantine[0]!.metrics.inputTotal).toBe(500);
    expect(total(t).knownLowerBound).toBe(0);
    expect(JSON.stringify(t.result())).not.toContain("SYNTHETIC_BODY");
  });
  it("7a a resumed session snapshot is counted from its baseline", () => {
    const t = mk(); u(t, 1, V(40, 4)); end(t, "cancelled");
    begin(t, "c2", { attempt: 2, parentCallId: "c1", resume: true });
    u(t, 1, V(70, 7), { callId: "c2", scope: "session", mode: "snapshot", baseline: B("session", V(40, 4)) });
    expect(total(t).knownLowerBound).toBe(70);
  });
  it("7b a resume without a baseline is unknown, never a double count", () => {
    const t = mk(); u(t, 1, V(40, 4)); end(t, "cancelled");
    begin(t, "c2", { attempt: 2, parentCallId: "c1", resume: true });
    u(t, 1, V(70, 7), { callId: "c2", scope: "session", mode: "snapshot" });
    expect(total(t).knownLowerBound).toBe(40);
    expect(total(t).complete).toBe(false);
  });
  it("8a the same seq with another payload is a conflict, first kept", () => {
    const t = mk(); u(t, 1, V(10)); u(t, 1, V(999), { eid: "r" });
    expect(total(t).knownLowerBound).toBe(10);
    expect(t.result().conflicts).toBe(1);
  });
  it("9b external ids never appear in the output", () => {
    const t = new CallTrace(); begin(t, "SYNTHETIC_TOKEN_ID", { logicalCallId: "SYNTHETIC_LOGICAL", generation: "SYNTHETIC_GENERATION" });
    const r = t.result();
    expect(JSON.stringify(r)).not.toContain("SYNTHETIC_");
    expect(r.calls[0]!.callId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("nullable, late, orphan and privacy", () => {
  it("reported zero is zero and a fully reported call is complete; unreported is null", () => {
    const t = mk(); u(t, 1, V(0, 0)); end(t);
    expect(t.result().calls[0]!.metrics.inputTotal).toBe(0);
    expect(total(t).complete).toBe(true);
    const n = mk(); u(n, 1, { inputTotal: 10, output: 1 }); end(n);
    expect(n.result().calls[0]!.metrics.cacheRead).toBeNull();
    expect(total(n, "inputTotal").complete).toBe(false);
  });
  it("invalid number shapes are null, never booked", () => {
    const t = mk(); let i = 0;
    for (const bad of [-1, 1.5, "5", Number.NaN, 2 ** 53, 10n]) u(t, ++i, { inputTotal: bad, cacheRead: 0, cacheWrite: 0, output: 0 });
    expect(total(t).knownLowerBound).toBe(0);
  });
  it("a canary in every ingested field is never serialized", () => {
    const C = "CANARY_xyz";
    const t = new CallTrace();
    t.event({ type: "begin", eventId: C + "e", callId: C + "c", logicalCallId: C + "l", attempt: 1, generation: C + "g", modelRef: C, providerRef: C, prompt: C, headers: { a: C }, email: C + "@x.y" });
    t.event({ type: "usage", eventId: C + "u", callId: C + "c", usageSeq: 1, generation: C + "g", scope: "call", mode: "delta", basis: "inclusive", values: { inputTotal: 1, cacheRead: 0, cacheWrite: 0, output: 0, [C]: 5, rawError: C }, toolResult: C });
    t.event({ type: "end", eventId: C + "z", callId: C + "c", outcome: "error", rawError: C });
    t.event({ type: "end", eventId: C + "z2", callId: C + "c", outcome: C });
    t.event({ type: C, eventId: "q", callId: C + "c" });
    expect(JSON.stringify(t.result())).not.toContain("CANARY");
  });
  it("bytes never become tokens or cost: billing and costUsd stay null", () => {
    const t = mk(); u(t, 1, V(10)); const r = t.result();
    expect(r.billing).toBeNull();
    expect(r.costUsd).toBeNull();
  });
});
