import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerAuthRoutes, makeRequireSession } from "../../src/admin/authRoutes.js";
import { deriveSessionSecret, signSession, hashPassword } from "../../src/admin/auth.js";

const secret = deriveSessionSecret(Buffer.alloc(32, 2));

function build(usersOver: Record<string, unknown> = {}) {
  const app = Fastify();
  const users = {
    _has: false,
    hasAny: vi.fn(async function (this: any) { return users._has; }),
    create: vi.fn(async () => { users._has = true; }),
    findByUsername: vi.fn(async () => null),
    ...usersOver,
  };
  registerAuthRoutes(app, { users: users as any, sessionSecret: secret });
  app.get("/admin/api/secret", { preHandler: makeRequireSession(secret) }, async () => ({ ok: true }));
  return { app, users };
}

describe("auth routes", () => {
  it("auth-status reports needsSetup when no admin exists", async () => {
    const { app } = build();
    const res = await app.inject({ method: "GET", url: "/admin/api/auth-status" });
    expect(res.json()).toMatchObject({ needsSetup: true, authed: false });
  });

  it("setup creates the first admin and sets a cookie", async () => {
    const { app, users } = build();
    const res = await app.inject({ method: "POST", url: "/admin/api/setup", payload: { username: "admin", password: "longenough" } });
    expect(res.statusCode).toBe(200);
    expect(users.create).toHaveBeenCalled();
    expect(String(res.headers["set-cookie"])).toContain("sid=");
  });

  it("setup rejects a weak password", async () => {
    const { app } = build();
    const res = await app.inject({ method: "POST", url: "/admin/api/setup", payload: { username: "admin", password: "x" } });
    expect(res.statusCode).toBe(400);
  });

  it("setup is blocked when an admin already exists", async () => {
    const { app } = build({ hasAny: vi.fn(async () => true) });
    const res = await app.inject({ method: "POST", url: "/admin/api/setup", payload: { username: "admin", password: "longenough" } });
    expect(res.statusCode).toBe(409);
  });

  it("login succeeds with correct credentials", async () => {
    const { hash, salt } = hashPassword("longenough");
    const { app } = build({ findByUsername: vi.fn(async () => ({ id: 1, username: "admin", passHash: hash, salt })) });
    const res = await app.inject({ method: "POST", url: "/admin/api/login", payload: { username: "admin", password: "longenough" } });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["set-cookie"])).toContain("sid=");
  });

  it("login fails with a wrong password", async () => {
    const { hash, salt } = hashPassword("longenough");
    const { app } = build({ findByUsername: vi.fn(async () => ({ id: 1, username: "admin", passHash: hash, salt })) });
    const res = await app.inject({ method: "POST", url: "/admin/api/login", payload: { username: "admin", password: "nope" } });
    expect(res.statusCode).toBe(401);
  });

  it("logout clears the cookie", async () => {
    const { app } = build();
    const res = await app.inject({ method: "POST", url: "/admin/api/logout" });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["set-cookie"])).toContain("Max-Age=0");
  });

  it("guard blocks without a valid session and allows with one", async () => {
    const { app } = build();
    const blocked = await app.inject({ method: "GET", url: "/admin/api/secret" });
    expect(blocked.statusCode).toBe(401);
    const sid = signSession("admin", secret);
    const ok = await app.inject({ method: "GET", url: "/admin/api/secret", headers: { cookie: `sid=${sid}` } });
    expect(ok.statusCode).toBe(200);
  });
});
