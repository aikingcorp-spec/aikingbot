import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import type { RuntimeEvent } from "../shared/runtime-events.ts";
import { MAX_ACTIVE_TRACES, MAX_FINISHED_TRACES, createCallTraceRecorder } from "./call-trace-recorder.ts";
import { EventBus } from "./harness/bus.ts";
import { requiredScope } from "./request-auth.ts";
import { createCallTraceRoutes } from "./routes/call-traces.ts";
import { dispatchRoutes } from "./routes/table.ts";

let n = 0;
const ev = (threadId: string, rest: object): RuntimeEvent =>
  ({ turnId: "default-turn", eventId: `e${++n}`, provider: "claude", threadId, createdAt: "2026-10-26T00:00:00.000Z", ...rest }) as unknown as RuntimeEvent;
const call = (r: ReturnType<typeof createCallTraceRecorder>, t: string, done: object) => { r.observe(ev(t, { type: "turn.started" })); r.observe(ev(t, { type: "turn.completed", ...done })); };

describe("call-trace recorder on the runtime bus", () => {
  it("records one authoritative usage per turn and ignores token-usage.updated", () => {
    const r = createCallTraceRecorder();
    r.observe(ev("t1", { type: "turn.started" }));
    r.observe(ev("t1", { type: "thread.token-usage.updated", input: 999, output: 999 }));
    r.observe(ev("t1", { type: "turn.completed", ok: true, usage: { input: 100, output: 20, cachedInput: 40 }, cost: 1.23 }));
    const [t] = r.list("t1");
    const c = t!.trace.calls[0]!;
    expect(c.outcome).toBe("success");
    expect(JSON.stringify(t)).not.toContain("999");
    expect(t!.trace.billing).toBeNull();
    expect(t!.trace.costUsd).toBeNull();
    expect(JSON.stringify(t)).not.toContain("1.23");
    expect(r.activeCount()).toBe(0);
  });
  it("binds interleaved turns by non-null identity and does not merge null IDs", () => {
    const r = createCallTraceRecorder();
    r.observe(ev("thread", { type: "turn.started", turnId: "A" }));
    r.observe(ev("thread", { type: "turn.started", turnId: "B" }));
    r.observe(ev("thread", { type: "turn.completed", turnId: "A", ok: true, usage: { input: 1, output: 1 } }));
    r.observe(ev("thread", { type: "turn.completed", turnId: "B", ok: false, stopReason: "interrupt" }));
    expect(r.list("thread").map((x) => x.turnId)).toEqual(["B", "A"]);
    const n = createCallTraceRecorder();
    n.observe(ev("nulls", { type: "turn.started", turnId: null })); n.observe(ev("nulls", { type: "turn.started", turnId: null }));
    n.observe(ev("nulls", { type: "turn.completed", turnId: null, ok: true })); n.observe(ev("nulls", { type: "turn.completed", turnId: null, ok: true }));
    expect(n.list("nulls")).toHaveLength(0);
    expect(n.diagnostics()).toHaveLength(4);
  });
  it.each([false, true])("actual EventBus isolates completion order, reversed=%s", async (reverse) => {
    const r = createCallTraceRecorder();
    const bus = new EventBus(async () => {}); // Real delivery, fake disk sink.
    const unsub = bus.subscribe(r.observe);
    const send = (type: string, turnId: string | null, extra = {}) => bus.publish(ev("bus", { type, turnId, ...extra }));
    send("turn.started", "A", { createdAt: "2026-10-26T00:00:01Z" });
    send("turn.started", "B", { createdAt: "2026-10-26T00:00:02Z" });
    send("turn.started", null);
    send("turn.completed", null, { ok: true, usage: { input: 999, output: 999 } });
    expect(r.activeCount()).toBe(2);
    for (const id of reverse ? ["B", "A"] : ["A", "B"]) {
      send("turn.completed", id, { ok: id === "A", stopReason: "cancelled", usage: { input: id === "A" ? 11 : 22, output: 1 } });
    }
    send("turn.completed", "A", { ok: true, usage: { input: 777, output: 777 } });
    send("turn.started", "A"); // Late start must not reopen a completed ID.
    send("thread.token-usage.updated", "A", { input: 888, output: 888 });
    send("turn.started", "C"); // Resume with a distinct real ID.
    send("turn.completed", "C", { ok: true });
    await bus.flush();
    unsub();
    expect(r.activeCount()).toBe(0);
    expect(r.list()).toHaveLength(3);
    const a = r.list().find((x) => x.turnId === "A")!;
    const b = r.list().find((x) => x.turnId === "B")!;
    expect(a.startedAt).toBe("2026-10-26T00:00:01Z");
    expect(b.startedAt).toBe("2026-10-26T00:00:02Z");
    expect(a.trace.calls[0]!.outcome).toBe("success");
    expect(b.trace.calls[0]!.outcome).toBe("cancelled");
    // Unknown usage basis stays unknown; identity is proved by timestamps/outcomes.
    expect(a.trace.calls[0]!.metrics.inputTotal).toBeNull();
    expect(b.trace.calls[0]!.metrics.inputTotal).toBeNull();
    expect(a.trace.costUsd).toBeNull();
    expect(r.list().find((x) => x.turnId === "C")!.trace.calls[0]!.metrics.output).toBeNull();
    expect(r.diagnostics()).toHaveLength(2);
  });
  it("bounds active identities and quarantines missing IDs without clearing live turns", () => {
    const r = createCallTraceRecorder();
    for (let i = 0; i < MAX_ACTIVE_TRACES + 10; i++) r.observe(ev("one", { type: "turn.started", turnId: `turn-${i}` }));
    for (let i = 0; i < MAX_FINISHED_TRACES + 10; i++) r.observe(ev("one", { type: "turn.completed", turnId: null, ok: true }));
    expect(r.activeCount()).toBe(MAX_ACTIVE_TRACES);
    expect(r.diagnostics()).toHaveLength(MAX_FINISHED_TRACES);
    expect(r.list()).toHaveLength(0);
    r.observe(ev("other", { type: "turn.completed", turnId: "turn-73", ok: true }));
    r.observe(ev("one", { type: "turn.completed", turnId: "turn-73", ok: false }));
    expect(r.list().map((x) => x.threadId)).toEqual(["one", "other"]);
  });
  it("dedupes duplicate completion for the same turn identity", () => {
    const r = createCallTraceRecorder();
    r.observe(ev("dup", { type: "turn.started", turnId: "turn-1" }));
    r.observe(ev("dup", { type: "turn.completed", turnId: "turn-1", ok: true, usage: { input: 1, output: 1 } }));
    r.observe(ev("dup", { type: "turn.completed", turnId: "turn-1", ok: true, usage: { input: 99, output: 99 } }));
    expect(r.list("dup")).toHaveLength(1);
  });
  it("keeps unknown usage unknown instead of zero", () => {
    const r = createCallTraceRecorder();
    call(r, "t2", { ok: false, stopReason: "user interrupt" });
    const t = r.list("t2")[0]!;
    expect(t.trace.calls[0]!.outcome).toBe("cancelled");
    expect(JSON.stringify(t.trace.totals)).not.toMatch(/"output":0/);
  });
  it("marks a failed turn as error and completes without turn.started", () => {
    const r = createCallTraceRecorder();
    r.observe(ev("t3", { type: "turn.completed", ok: false, usage: { input: 1, output: 2 } }));
    expect(r.list("t3")[0]!.trace.calls[0]!.outcome).toBe("error");
  });
  it("is bounded", () => {
    const r = createCallTraceRecorder();
    for (let i = 0; i < MAX_FINISHED_TRACES + 10; i++) call(r, `b${i}`, { ok: true, usage: { input: 1, output: 1 } });
    expect(r.list().length).toBe(MAX_FINISHED_TRACES);
    expect(r.list("b0").length).toBe(0);
  });
});

describe("GET /api/call-traces", () => {
  const servers: Server[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((d) => s.close(d)))); });
  it("is owner-scoped, no-store, and exposes no raw payload or cost", async () => {
    expect(requiredScope("GET", "/api/call-traces")).toBe("admin");
    const r = createCallTraceRecorder();
    r.observe(ev("t9", { type: "turn.started", raw: { source: "x", payload: { secret: "SHOULD-NOT-LEAK" } } }));
    r.observe(ev("t9", { type: "turn.completed", ok: true, usage: { input: 5, output: 6 }, raw: { source: "x", payload: "SHOULD-NOT-LEAK" } }));
    const routes = [createCallTraceRoutes({ recorder: r })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!(await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["admin"] }, json, readBody }))) json(res, 404, {});
    });
    servers.push(server);
    await new Promise<void>((d) => server.listen(0, "127.0.0.1", d));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ok = await fetch(`${base}/api/call-traces?threadId=t9`);
    const body = await ok.text();
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(body).not.toContain("SHOULD-NOT-LEAK");
    expect(JSON.parse(body).traces).toHaveLength(1);
    expect((await fetch(`${base}/api/call-traces?threadId=${"x".repeat(200)}`)).status).toBe(400);
    expect((await fetch(`${base}/api/call-traces`, { method: "POST" })).status).toBe(404);
  });
});
