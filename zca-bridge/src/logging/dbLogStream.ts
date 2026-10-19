import { Writable } from "node:stream";
import type { LogRow } from "../store/logsRepo.js";

// Substrings (case-insensitive) that mark a context key as secret.
const SENSITIVE = ["access_token", "mac", "secret", "token", "password", "authorization"];
// pino structural fields + fields we promote to columns; not duplicated into context.
const SKIP = new Set(["level", "time", "msg", "pid", "hostname", "v", "event", "accountId", "account_id"]);
const MAX_REDACT_DEPTH = 4;

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE.some((s) => k.includes(s));
}

/**
 * Redact a value for storage in the persisted, admin-visible context.
 * - keys matching a SENSITIVE substring → "[redacted]"
 * - a `stack` key (serialized error stack trace) → "[omitted]" (kept out of the DB;
 *   the full stack is still on stdout for deep debugging)
 * - recurses into nested objects/arrays up to MAX_REDACT_DEPTH
 */
export function redactValue(key: string, value: unknown, depth = 0): unknown {
  if (isSensitiveKey(key)) return "[redacted]";
  if (key.toLowerCase() === "stack") return "[omitted]";
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_REDACT_DEPTH) return "[depth-limited]";
  if (Array.isArray(value)) return value.map((v) => redactValue(key, v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactValue(k, v, depth + 1);
  }
  return out;
}

export function buildContext(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    out[k] = redactValue(k, v);
  }
  return out;
}

function toAccountId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

/** Parse one pino JSON line into a LogRow, or null when it must not be persisted. */
export function parseRecord(line: string): LogRow | null {
  let rec: Record<string, unknown>;
  try { rec = JSON.parse(line); } catch { return null; }
  const level = typeof rec.level === "number" ? rec.level : 0;
  const event = typeof rec.event === "string" ? rec.event : null;
  if (level < 40 && !event) return null; // persist warn+ OR anything carrying an event
  const ts = typeof rec.time === "number" ? new Date(rec.time) : new Date();
  const msg = typeof rec.msg === "string" ? rec.msg : "";
  return { ts, level, event, accountId: toAccountId(rec.accountId ?? rec.account_id), msg, context: buildContext(rec) };
}

export interface DbLogStreamOpts {
  insert: (rows: LogRow[]) => Promise<void>;
  prune?: (keep: number) => Promise<void>;
  batchSize?: number;          // flush once this many rows are queued (default 50)
  intervalMs?: number;         // flush a partial batch after this idle time (default 1000)
  queueCap?: number;           // max buffered rows; oldest dropped past this (default 5000)
  retentionRows?: number;      // rows to keep when pruning (default 10000)
  pruneEveryFlushes?: number;  // prune cadence in flushes (default 100)
}

/** A pino multistream target that persists qualifying log records to Postgres. */
export class DbLogStream extends Writable {
  private queue: LogRow[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushCount = 0;
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly queueCap: number;
  private readonly retentionRows: number;
  private readonly pruneEveryFlushes: number;

  constructor(private opts: DbLogStreamOpts) {
    super();
    this.batchSize = opts.batchSize ?? 50;
    this.intervalMs = opts.intervalMs ?? 1000;
    this.queueCap = opts.queueCap ?? 5000;
    this.retentionRows = opts.retentionRows ?? 10000;
    this.pruneEveryFlushes = opts.pruneEveryFlushes ?? 100;
  }

  _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    const row = parseRecord(chunk.toString());
    if (row) this.enqueue(row);
    cb(); // never propagate logging failures back into the app
  }

  private enqueue(row: LogRow): void {
    this.queue.push(row);
    if (this.queue.length > this.queueCap) this.queue.shift(); // drop oldest
    if (this.queue.length >= this.batchSize) { void this.flush(); return; }
    if (!this.timer) {
      this.timer = setTimeout(() => { void this.flush(); }, this.intervalMs);
      this.timer.unref?.();
    }
  }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    try {
      await this.opts.insert(batch);
    } catch (err) {
      console.error("dbLogStream insert failed:", err);
      return;
    }
    this.flushCount++;
    if (this.opts.prune && this.flushCount % this.pruneEveryFlushes === 0) {
      try { await this.opts.prune(this.retentionRows); } catch (err) { console.error("dbLogStream prune failed:", err); }
    }
  }
}
