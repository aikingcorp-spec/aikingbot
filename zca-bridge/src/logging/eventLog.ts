/** Minimal structural subset of a pino logger; satisfied by Fastify's `app.log`. */
export interface EventLog {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export const NOOP_LOG: EventLog = { info() {}, warn() {}, error() {} };
