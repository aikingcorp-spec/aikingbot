import { Writable } from "node:stream";
import type { AlertDispatcher } from "./dispatcher.js";

/** A pino multistream target that turns specific log events into alert signals. */
export class AlertStream extends Writable {
  constructor(private dispatcher: AlertDispatcher) { super(); }

  _write(chunk: unknown, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    try {
      const rec = JSON.parse(String(chunk)) as Record<string, unknown>;
      if (rec.event === "account_status" && typeof rec.accountId === "number" && typeof rec.status === "string") {
        this.dispatcher.handle({ type: "status", accountId: rec.accountId, status: rec.status as "connected" | "reconnecting" | "expired" });
      } else if (rec.event === "job_dead_lettered") {
        this.dispatcher.handle({ type: "dead_letter", kind: String(rec.kind ?? "unknown"), dedupKey: String(rec.dedupKey ?? "") });
      }
    } catch {
      // Non-JSON or malformed line — never let alerting break the log pipeline.
    }
    cb();
  }
}
