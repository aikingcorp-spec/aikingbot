import type { CallTraceRecorder } from "../call-trace-recorder.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Owner-only (not in CLIENT_ALLOW/SERVICE_ALLOW). Read-only projection; ids are opaque, cost/billing are always null. */
export function createCallTraceRoutes(deps: { recorder: CallTraceRecorder }): RouteHandler {
  return async ({ res, url, path, method, json }) => {
    if (!(method === "GET" && path === "/api/call-traces")) return PASS;
    res.setHeader("cache-control", "no-store");
    const threadId = url.searchParams.get("threadId") ?? undefined;
    if (threadId !== undefined && threadId.length > 128) return json(res, 400, { error: "threadId is too long" });
    return json(res, 200, { traces: deps.recorder.list(threadId) });
  };
}
