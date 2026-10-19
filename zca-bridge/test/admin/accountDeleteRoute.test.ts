import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerAccountDeleteRoute } from "../../src/admin/routes.js";

function build(deleted: boolean, guard?: any) {
  const app = Fastify();
  const accounts = { delete: vi.fn(async () => deleted) };
  const sessions = { remove: vi.fn(async () => {}) };
  const refreshIndex = vi.fn(async () => {});
  registerAccountDeleteRoute(app, accounts as any, sessions as any, refreshIndex, guard ?? (async () => {}));
  return { app, accounts, sessions, refreshIndex };
}

describe("DELETE /admin/api/accounts/:id", () => {
  it("stops the session, deletes the row, refreshes the index", async () => {
    const { app, accounts, sessions, refreshIndex } = build(true);
    const res = await app.inject({ method: "DELETE", url: "/admin/api/accounts/7" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sessions.remove).toHaveBeenCalledWith(7);
    expect(accounts.delete).toHaveBeenCalledWith(7);
    expect(refreshIndex).toHaveBeenCalled();
  });

  it("returns 404 and skips refresh when the id does not exist", async () => {
    const { app, refreshIndex } = build(false);
    const res = await app.inject({ method: "DELETE", url: "/admin/api/accounts/404" });
    expect(res.statusCode).toBe(404);
    expect(refreshIndex).not.toHaveBeenCalled();
  });

  it("enforces the auth guard", async () => {
    const guard = vi.fn(async (_req: any, reply: any) => { reply.code(401).send({ ok: false }); });
    const { app, sessions } = build(true, guard);
    const res = await app.inject({ method: "DELETE", url: "/admin/api/accounts/7" });
    expect(res.statusCode).toBe(401);
    expect(sessions.remove).not.toHaveBeenCalled();
  });
});
