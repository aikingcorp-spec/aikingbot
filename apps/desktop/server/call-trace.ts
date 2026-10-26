// Pure call-trace reducer. No I/O, no clock, no driver, ledger or billing hooks; cost is always null.
// Adapters (trusted) feed begin/usage/end events; the result is an allowlisted projection with opaque ids.
import { randomUUID } from "node:crypto";

export const METRIC_NAMES = ["inputTotal", "cacheRead", "cacheWrite", "output"] as const;
export type MetricName = (typeof METRIC_NAMES)[number];
export type Metrics = Record<MetricName, number | null>;
export type TraceScope = "call" | "turn" | "session" | "process";
export type UsageMode = "delta" | "snapshot" | "cumulative";
export type InputBasis = "inclusive" | "exclusive" | "unknown";
export type CallOutcome = "success" | "error" | "cancelled";

export const MAX_ID_LENGTH = 128;
export const DEFAULT_LIMITS = { maxCalls: 256, maxEvents: 4096, maxUsagePerCall: 128, maxQuarantine: 64 } as const;
export type TraceLimits = { -readonly [K in keyof typeof DEFAULT_LIMITS]: number };

/** Bounded canonical names the adapter vouches for. Anything else is reported as "unknown", never echoed. */
export interface TraceCatalog { models?: readonly string[]; providers?: readonly string[] }
export interface TraceOptions { limits?: Partial<TraceLimits>; catalog?: TraceCatalog }

export const UNKNOWN_REF = "unknown";
const REF_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SCOPES: readonly string[] = ["call", "turn", "session", "process"];
const MODES: readonly string[] = ["delta", "snapshot", "cumulative"];
const BASES: readonly string[] = ["inclusive", "exclusive", "unknown"];
const OUTCOMES: readonly string[] = ["success", "error", "cancelled"];
// A report that fails one of these says nothing about the call's counter contract.
const STRUCTURAL = new Set(["generation-reset", "missing-baseline", "unsupported-scoped-delta", "counter-reset"]);

const emptyMetrics = (): Metrics => ({ inputTotal: null, cacheRead: null, cacheWrite: null, output: null });
const count = (x: unknown): number | null => (typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : null);
const id = (x: unknown): string | undefined => (typeof x === "string" && x.length > 0 && x.length <= MAX_ID_LENGTH ? x : undefined);

function readMetrics(x: unknown): Metrics {
  const out = emptyMetrics();
  if (x === null || typeof x !== "object") return out;
  const o = x as Record<string, unknown>;
  for (const k of METRIC_NAMES) out[k] = count(o[k]);
  return out;
}

export function normalizeUsage(raw: Metrics, basis: InputBasis, baseline?: Metrics): { metrics: Metrics; freshInput: number | null; issues: string[] } {
  const v = { ...raw };
  const issues: string[] = [];
  if (baseline) {
    if (METRIC_NAMES.some((k) => v[k] !== null && baseline[k] !== null && v[k]! < baseline[k]!)) {
      return { metrics: emptyMetrics(), freshInput: null, issues: ["counter-reset"] };
    }
    for (const k of METRIC_NAMES) v[k] = v[k] === null || baseline[k] === null ? null : v[k]! - baseline[k]!;
  }
  if (basis === "exclusive") {
    const sum = v.inputTotal !== null && v.cacheRead !== null && v.cacheWrite !== null ? v.inputTotal + v.cacheRead + v.cacheWrite : null;
    // Only this metric becomes unknown on overflow; the others stay independent.
    if (sum !== null && !Number.isSafeInteger(sum)) { v.inputTotal = null; issues.push("numeric-overflow"); } else v.inputTotal = sum;
  }
  if (basis === "unknown") { v.inputTotal = null; issues.push("unknown-input-basis"); }
  return { metrics: v, freshInput: freshOf(v, basis), issues };
}

function freshOf(m: Metrics, basis: InputBasis | undefined): number | null {
  if (basis !== "inclusive" && basis !== "exclusive") return null;
  const { inputTotal: t, cacheRead: r, cacheWrite: w } = m;
  if (t === null || r === null || w === null) return null;
  const held = r + w;
  return Number.isSafeInteger(held) && t >= held ? t - held : null;
}

/** Only bounded scalars: enums, safe integers, short ids/refs. No raw object from the adapter survives the snapshot. */
interface Snap {
  type: "begin" | "usage" | "end" | null; eventId?: string; callId?: string; logicalCallId?: string; parentCallId?: string | null | false; attempt: number | null; resume: boolean;
  generation?: string; outcome: CallOutcome | null; scope: TraceScope | null; mode: UsageMode | null; basis: InputBasis | null; usageSeq: number | null; values: Metrics;
  baseline?: { scope: TraceScope | null; generation?: string; values: Metrics } | null; modelRef: string | null; providerRef: string | null; sig: string;
}

const pick = <T extends string>(x: unknown, list: readonly string[]): T | null => (typeof x === "string" && list.includes(x) ? (x as T) : null);
const int = (x: unknown): number | null => (typeof x === "number" && Number.isSafeInteger(x) ? x : null);
/** null = absent; "" = a string over 64 chars (never in a catalog, so it resolves to "unknown"). */
const ref = (x: unknown): string | null => {
  if (x === undefined || x === null) return null;
  // A non-string ref is a malformed event: reject it whole (before any state change) instead of carrying the object.
  if (typeof x !== "string") throw new TypeError("ref must be a string");
  return x.length <= 64 ? x : "";
};

// Every top-level field is read exactly once, up front, and reduced to bounded scalars; the canonical signature is computed here, once.
// Boundary: a throwing top-level getter is caught by event() and counted invalid; a slow or non-terminating getter is the trusted adapter's problem.
function snapshot(e: Record<string, unknown>): Snap {
  const parent = e.parentCallId;
  const b = e.baseline;
  let baseline: Snap["baseline"] = null;
  if (b !== null && typeof b === "object") {
    const o = b as Record<string, unknown>;
    baseline = { scope: pick(o.scope, SCOPES), generation: id(o.generation), values: readMetrics(o.values) };
  }
  const snap: Snap = {
    type: pick(e.type, ["begin", "usage", "end"]), eventId: id(e.eventId), callId: id(e.callId), logicalCallId: id(e.logicalCallId),
    parentCallId: parent === undefined || parent === null ? null : (id(parent) ?? false), attempt: int(e.attempt), resume: e.resume === true,
    generation: id(e.generation), outcome: pick(e.outcome, OUTCOMES), scope: pick(e.scope, SCOPES), mode: pick(e.mode, MODES), basis: pick(e.basis, BASES), usageSeq: int(e.usageSeq),
    values: readMetrics(e.values), baseline, modelRef: ref(e.modelRef), providerRef: ref(e.providerRef), sig: "",
  };
  snap.sig = signature(snap);
  return snap;
}

function signature(s: Snap): string {
  return JSON.stringify([s.type, s.logicalCallId, s.parentCallId, s.attempt, s.resume, s.generation, s.outcome, s.scope, s.mode, s.basis, s.usageSeq, s.values,
    s.baseline?.scope, s.baseline?.generation, s.baseline?.values, s.modelRef, s.providerRef]);
}

interface Call {
  id: string; logical: string; attempt: number; parent: string | null; resume: boolean; generation: string; outcome: CallOutcome | null;
  metrics: Metrics; issues: Set<string>; seq: Map<number, string>; lastSeq: number; contract: string | null; basis?: InputBasis;
  model: string | null; provider: string | null; hasChild: boolean;
}

export interface CallProjection {
  callId: string; logicalCallId: string; attempt: number; parentCallId: string | null; resume: boolean; outcome: CallOutcome | null;
  metrics: Metrics; freshInput: number | null; model: string | null; provider: string | null; diagnostics: string[];
}
export interface MetricTotal { knownLowerBound: number; unknownCalls: number; overflow: boolean; complete: boolean }
export interface LateUsage { callId: string; usageSeq: number; scope: TraceScope; mode: UsageMode; metrics: Metrics; diagnostics: string[] }
export interface TraceResult {
  schemaVersion: 2; traceId: string; calls: CallProjection[]; totals: Record<MetricName, MetricTotal>;
  logicalCalls: number; attemptCalls: number; retries: number; duplicateEvents: number; staleUsage: number; orphanEvents: number; invalidEvents: number; conflicts: number;
  lateUsageEvents: number; lateQuarantine: LateUsage[];
  dropped: { events: number; calls: number; usage: number; quarantine: number };
  limits: TraceLimits; billing: null; costUsd: null;
}

export class CallTrace {
  readonly #calls = new Map<string, Call>();
  readonly #seen = new Map<string, string>();
  readonly #logical = new Map<string, { id: string; attempts: Set<number> }>();
  readonly #traceId = randomUUID();
  readonly #limits: TraceLimits;
  readonly #models: ReadonlySet<string>;
  readonly #providers: ReadonlySet<string>;
  readonly #quarantine: LateUsage[] = [];
  #duplicates = 0; #conflicts = 0; #orphans = 0; #stale = 0; #invalid = 0; #late = 0;
  #droppedEvents = 0; #droppedCalls = 0; #droppedUsage = 0; #droppedQuarantine = 0;

  constructor(options: TraceOptions = {}) {
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    for (const v of Object.values(limits)) if (!Number.isSafeInteger(v) || v < 1) throw new RangeError("trace limits must be positive integers");
    this.#limits = limits;
    this.#models = refSet(options.catalog?.models);
    this.#providers = refSet(options.catalog?.providers);
  }

  /** Never throws: anything unusable becomes a counter. */
  event(raw: unknown): void {
    try {
      if (raw === null || typeof raw !== "object") { this.#invalid++; return; }
      this.#handle(snapshot(raw as Record<string, unknown>));
    } catch {
      this.#invalid++;
    }
  }

  #handle(s: Snap): void {
    if (!s.callId || !s.eventId || s.parentCallId === false) { this.#invalid++; return; }
    const key = JSON.stringify([s.callId, s.eventId]);
    const sig = s.sig;
    const prior = this.#seen.get(key);
    if (prior !== undefined) {
      this.#duplicates++;
      if (prior !== sig) { this.#conflicts++; this.#calls.get(s.callId)?.issues.add("event-conflict"); }
      return;
    }
    // Full means full: a new event is dropped and the trace is incomplete. Old keys are never evicted, so nothing is booked twice.
    if (this.#seen.size >= this.#limits.maxEvents) { this.#droppedEvents++; return; }
    this.#seen.set(key, sig);
    if (s.type === "begin") return this.#begin(s);
    const c = this.#calls.get(s.callId);
    if (!c) { this.#orphans++; return; }
    if (s.type === "end") return this.#end(c, s);
    if (s.type !== "usage") { this.#invalid++; return; }
    this.#usage(c, s);
  }

  #begin(s: Snap): void {
    const existing = this.#calls.get(s.callId!);
    if (existing) { this.#conflicts++; existing.issues.add("begin-conflict"); return; }
    const attempt = s.attempt;
    if (!s.logicalCallId || !s.generation || attempt === null || attempt < 1) { this.#invalid++; return; }
    const parent = typeof s.parentCallId === "string" ? this.#calls.get(s.parentCallId) : undefined;
    if (attempt === 1) {
      if (s.parentCallId !== null || s.resume) { this.#invalid++; return; }
    } else if (!parent || parent.logical !== s.logicalCallId || parent.attempt + 1 !== attempt || parent.outcome === null || parent.hasChild) {
      this.#invalid++;
      return;
    }
    const logical = this.#logical.get(s.logicalCallId);
    if (logical?.attempts.has(attempt)) { this.#invalid++; return; }
    if (this.#calls.size >= this.#limits.maxCalls) { this.#droppedCalls++; return; }
    const entry = logical ?? { id: randomUUID(), attempts: new Set<number>() };
    entry.attempts.add(attempt);
    this.#logical.set(s.logicalCallId, entry);
    if (parent) parent.hasChild = true;
    this.#calls.set(s.callId!, {
      id: randomUUID(), logical: s.logicalCallId, attempt, parent: parent?.id ?? null, resume: s.resume, generation: s.generation, outcome: null,
      metrics: emptyMetrics(), issues: new Set(), seq: new Map(), lastSeq: 0, contract: null,
      model: resolveRef(s.modelRef, this.#models), provider: resolveRef(s.providerRef, this.#providers), hasChild: false,
    });
  }

  #end(c: Call, s: Snap): void {
    if (s.outcome === null) { this.#invalid++; return; }
    if (c.outcome !== null) {
      this.#duplicates++;
      if (c.outcome !== s.outcome) { this.#conflicts++; c.issues.add("end-conflict"); }
      return;
    }
    c.outcome = s.outcome;
  }

  #usage(c: Call, s: Snap): void {
    const seq = s.usageSeq;
    if (s.scope === null || s.mode === null || s.basis === null || seq === null || seq < 1 || !s.generation) {
      this.#invalid++; c.issues.add("invalid-usage"); return;
    }
    const { scope, mode, basis } = s;
    const sig = s.sig;
    if (c.seq.has(seq)) {
      this.#stale++;
      if (c.seq.get(seq) !== sig) { this.#conflicts++; c.issues.add("sequence-conflict"); }
      return;
    }
    if (c.seq.size >= this.#limits.maxUsagePerCall) { this.#droppedUsage++; c.issues.add("usage-cap"); return; }
    c.seq.set(seq, sig);
    if (seq < c.lastSeq) { this.#stale++; c.issues.add("out-of-order"); return; }
    if (seq > c.lastSeq + 1) c.issues.add("sequence-gap");
    c.lastSeq = seq;

    const baselineNeeded = scope !== "call" || mode === "cumulative";
    const b = s.baseline;
    let n: { metrics: Metrics; freshInput?: number | null; issues: string[] };
    if (s.generation !== c.generation) n = { metrics: emptyMetrics(), issues: ["generation-reset"] };
    else if (baselineNeeded && (!b || b.scope !== scope || b.generation !== s.generation)) n = { metrics: emptyMetrics(), issues: ["missing-baseline"] };
    else if (scope !== "call" && mode === "delta") n = { metrics: emptyMetrics(), issues: ["unsupported-scoped-delta"] };
    else n = normalizeUsage(s.values, basis, baselineNeeded ? b!.values : undefined);

    const structural = n.issues.some((i) => STRUCTURAL.has(i));
    const contract = JSON.stringify([scope, mode, basis, s.generation, baselineNeeded ? b?.values : null]);
    // The counter contract is fixed by the first usable report: not structurally rejected and carrying at least one known metric.
    // An all-null or malformed report (values or baseline) says nothing, so it cannot lock out a later valid one.
    const usable = !structural && METRIC_NAMES.some((k) => n.metrics[k] !== null);
    if (usable) {
      if (c.contract === null) { c.contract = contract; c.basis = basis; }
      else if (c.contract !== contract) n = { metrics: emptyMetrics(), issues: ["usage-contract-changed"] };
    }
    if (c.outcome !== null) {
      this.#late++;
      c.issues.add("late-unreconciled");
      if (this.#quarantine.length < this.#limits.maxQuarantine) this.#quarantine.push({ callId: c.id, usageSeq: seq, scope, mode, metrics: n.metrics, diagnostics: n.issues });
      else this.#droppedQuarantine++;
      return;
    }
    for (const issue of n.issues) c.issues.add(issue);
    for (const k of METRIC_NAMES) {
      const x = n.metrics[k], prev = c.metrics[k];
      if (x === null) { c.issues.add("unknown-" + k); continue; }
      if (!Number.isSafeInteger(x)) { c.issues.add("numeric-overflow"); continue; }
      if (mode === "delta") {
        const sum = prev === null ? x : prev + x;
        if (Number.isSafeInteger(sum)) c.metrics[k] = sum; else c.issues.add("numeric-overflow");
      } else if (prev !== null && x < prev) c.issues.add("counter-regressed");
      else c.metrics[k] = x;
    }
  }

  result(): TraceResult {
    const all = [...this.#calls.values()];
    const calls: CallProjection[] = all.map((c) => ({
      callId: c.id, logicalCallId: this.#logical.get(c.logical)!.id, attempt: c.attempt, parentCallId: c.parent, resume: c.resume, outcome: c.outcome,
      metrics: { ...c.metrics }, freshInput: freshOf(c.metrics, c.basis), model: c.model, provider: c.provider, diagnostics: [...c.issues],
    }));
    const dropped = { events: this.#droppedEvents, calls: this.#droppedCalls, usage: this.#droppedUsage, quarantine: this.#droppedQuarantine };
    const lossless = this.#orphans === 0 && this.#invalid === 0 && this.#conflicts === 0 && Object.values(dropped).every((n) => n === 0);
    const totals = {} as Record<MetricName, MetricTotal>;
    for (const k of METRIC_NAMES) {
      let sum = 0, overflow = false;
      for (const c of calls) {
        const x = c.metrics[k] ?? 0;
        if (sum > Number.MAX_SAFE_INTEGER - x) { overflow = true; sum = Number.MAX_SAFE_INTEGER; } else sum += x;
      }
      totals[k] = {
        knownLowerBound: sum, unknownCalls: calls.filter((c) => c.metrics[k] === null).length, overflow,
        complete: lossless && !overflow && calls.every((c) => c.metrics[k] !== null && c.diagnostics.length === 0 && c.outcome !== null),
      };
    }
    return {
      schemaVersion: 2, traceId: this.#traceId, calls, totals, logicalCalls: this.#logical.size, attemptCalls: calls.length,
      retries: calls.filter((c) => c.attempt > 1).length, duplicateEvents: this.#duplicates, staleUsage: this.#stale, orphanEvents: this.#orphans,
      invalidEvents: this.#invalid, conflicts: this.#conflicts, lateUsageEvents: this.#late, lateQuarantine: structuredClone(this.#quarantine),
      dropped, limits: { ...this.#limits }, billing: null, costUsd: null,
    };
  }
}

function refSet(list: readonly string[] | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  for (const name of list ?? []) {
    if (!REF_PATTERN.test(name) || name === UNKNOWN_REF) throw new RangeError("catalog names must be short lowercase refs");
    out.add(name);
  }
  return out;
}

function resolveRef(ref: string | null, catalog: ReadonlySet<string>): string | null {
  if (ref === null) return null;
  return catalog.has(ref) ? ref : UNKNOWN_REF;
}
