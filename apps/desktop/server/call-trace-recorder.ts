// Feeds the pure CallTrace reducer from the real runtime-event bus (the driver boundary).
// One figure per turn: turn.completed.usage. thread.token-usage.updated means something different per driver and is never summed (runtime-events.ts), so it is not read here.
// Billing/ledger are untouched: cost stays null, an absent usage stays unknown (null), nothing is estimated.
import { randomUUID } from "node:crypto";

import type { RuntimeEvent } from "../shared/runtime-events.ts";
import { CallTrace, type TraceResult } from "./call-trace.ts";

export const MAX_ACTIVE_TRACES = 64;
export const MAX_FINISHED_TRACES = 64;

export interface RecordedTrace { threadId: string; turnId: string | null; startedAt: string; finishedAt: string | null; trace: TraceResult }
interface Live { callId: string; turnId: string | null; startedAt: string; trace: CallTrace }

const CANCEL = /cancel|interrupt|abort|stopp?ed/i;

export function createCallTraceRecorder() {
  const live = new Map<string, Live>();
  const finished: RecordedTrace[] = [];
  const completed = new Set<string>();
  // Missing turn identity cannot be correlated. Metadata only; no usage or raw payload.
  const quarantined: { threadId: string; type: "turn.started" | "turn.completed"; at: string; reason: "missing-turn-id" }[] = [];

  function key(threadId: string, turnId: string): string {
    return JSON.stringify([threadId, turnId]);
  }

  function begin(threadId: string, turnId: string, at: string): Live {
    const identity = key(threadId, turnId);
    const existing = live.get(identity);
    if (existing) return existing;
    if (live.size >= MAX_ACTIVE_TRACES) live.delete(live.keys().next().value as string);
    const callId = randomUUID();
    const entry: Live = { callId, turnId, startedAt: at, trace: new CallTrace() };
    entry.trace.event({ type: "begin", eventId: `b-${callId}`, callId, logicalCallId: callId, attempt: 1, generation: "g1" });
    live.set(identity, entry);
    return entry;
  }

  function observe(event: RuntimeEvent): void {
    if (event.type !== "turn.started" && event.type !== "turn.completed") return;
    if (event.turnId == null || event.turnId === "") {
      quarantined.push({ threadId: event.threadId, type: event.type, at: event.createdAt, reason: "missing-turn-id" });
      if (quarantined.length > MAX_FINISHED_TRACES) quarantined.shift();
      return;
    }
    const identity = key(event.threadId, event.turnId);
    if (completed.has(identity)) return;
    if (event.type === "turn.started") {
      begin(event.threadId, event.turnId, event.createdAt);
      return;
    }
    completed.add(identity);
    if (completed.size > MAX_FINISHED_TRACES * 4) completed.delete(completed.values().next().value as string);
    const entry = begin(event.threadId, event.turnId, event.createdAt);
    live.delete(identity);
    if (event.usage) {
      entry.trace.event({
        type: "usage", eventId: `u-${entry.callId}`, callId: entry.callId, usageSeq: 1, generation: "g1",
        scope: "turn", mode: "snapshot", basis: "unknown",
        values: { inputTotal: event.usage.input, cacheRead: event.usage.cachedInput ?? null, cacheWrite: null, output: event.usage.output },
      });
    }
    const outcome = event.ok ? "success" : event.stopReason && CANCEL.test(event.stopReason) ? "cancelled" : "error";
    entry.trace.event({ type: "end", eventId: `e-${entry.callId}`, callId: entry.callId, outcome });
    finished.push({ threadId: event.threadId, turnId: entry.turnId, startedAt: entry.startedAt, finishedAt: event.createdAt, trace: entry.trace.result() });
    if (finished.length > MAX_FINISHED_TRACES) finished.shift();
  }

  return {
    observe,
    /** Newest first. Without a thread: every finished turn in memory (bounded, lost on restart by design). */
    list: (threadId?: string): RecordedTrace[] => finished.filter((t) => !threadId || t.threadId === threadId).reverse(),
    activeCount: () => live.size,
    diagnostics: () => quarantined.map((entry) => ({ ...entry })),
  };
}
export type CallTraceRecorder = ReturnType<typeof createCallTraceRecorder>;
