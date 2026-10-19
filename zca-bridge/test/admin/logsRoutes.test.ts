import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerLogsRoutes } from "../../src/admin/logsRoutes.js";

function build(query: (q: any) => Promise<any[]>, guard?: any, dismiss?: (id: number) => Promise<boolean>) {
  const app = Fastify();
  const logs = { query: vi.fn(query), dismiss: vi.fn(dismiss ?? (async () => true)) };
  registerLogsRoutes(app, logs as any, guard ?? (async () => {}));
  return { app, logs };
}

describe("logs routes", () => {
  it("returns rows and passes parsed filters to the repo", async () => {
    const { app, logs } = build(async () => [{ id: 1, ts: "t", level: 50, event: "e", accountId: 3, msg: "m", context: {} }]);
    const res = await app.inject({ method: "GET", url: "/admin/api/logs?level=40&accountId=3&limit=50" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: 1, ts: "t", level: 50, event: "e", accountId: 3, msg: "m", context: {} }]);
    expect(logs.query).toHaveBeenCalledWith({ minLevel: 40, accountId: 3, limit: 50 });
  });

  it("defaults limit to 200 and omits absent filters", async () => {
    const { app, logs } = build(async () => []);
    await app.inject({ method: "GET", url: "/admin/api/logs" });
    expect(logs.query).toHaveBeenCalledWith({ limit: 200 });
  });

  it("enforces the auth guard", async () => {
    const guard = vi.fn(async (_req: any, reply: any) => { reply.code(401).send({ ok: false }); });
    const { app, logs } = build(async () => [], guard);
    const res = await app.inject({ method: "GET", url: "/admin/api/logs" });
    expect(res.statusCode).toBe(401);
    expect(logs.query).not.toHaveBeenCalled();
  });

  it("returns 500 without leaking details when the query throws", async () => {
    const { app } = build(async () => { throw new Error("pg exploded: secret dsn"); });
    const res = await app.inject({ method: "GET", url: "/admin/api/logs" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ ok: false, error: "query_failed" });
    expect(JSON.stringify(res.json())).not.toContain("secret dsn");
  });

  it("passes excludeDismissed=1 through to the query", async () => {
    const { app, logs } = build(async () => []);
    await app.inject({ method: "GET", url: "/admin/api/logs?excludeDismissed=1&limit=20" });
    expect(logs.query).toHaveBeenCalledWith({ excludeDismissed: true, limit: 20 });
  });

  it("does not set excludeDismissed when the param is absent", async () => {
    const { app, logs } = build(async () => []);
    await app.inject({ method: "GET", url: "/admin/api/logs?limit=20" });
    expect(logs.query).toHaveBeenCalledWith({ limit: 20 });
  });

  it("dismiss returns ok when a row is updated", async () => {
    const { app, logs } = build(async () => [], undefined, async () => true);
    const res = await app.inject({ method: "POST", url: "/admin/api/logs/7/dismiss" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(logs.dismiss).toHaveBeenCalledWith(7);
  });

  it("dismiss returns 404 when no row matches", async () => {
    const { app } = build(async () => [], undefined, async () => false);
    const res = await app.inject({ method: "POST", url: "/admin/api/logs/999/dismiss" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false });
  });

  it("dismiss rejects a non-numeric id with 400", async () => {
    const { app, logs } = build(async () => [], undefined, async () => true);
    const res = await app.inject({ method: "POST", url: "/admin/api/logs/abc/dismiss" });
    expect(res.statusCode).toBe(400);
    expect(logs.dismiss).not.toHaveBeenCalled();
  });

  it("dismiss enforces the auth guard", async () => {
    const guard = vi.fn(async (_req: any, reply: any) => { reply.code(401).send({ ok: false }); });
    const { app, logs } = build(async () => [], guard, async () => true);
    const res = await app.inject({ method: "POST", url: "/admin/api/logs/7/dismiss" });
    expect(res.statusCode).toBe(401);
    expect(logs.dismiss).not.toHaveBeenCalled();
  });
});
