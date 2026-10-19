import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { AdminUserRepo } from "../store/adminUserRepo.js";
import {
  hashPassword, verifyPassword, signSession, verifySession,
  sessionCookieHeader, clearSessionCookieHeader,
} from "./auth.js";

// Fixed dummy credentials so a login attempt for an unknown username still performs
// one scrypt verification, removing a username-enumeration timing side-channel.
const DUMMY_SALT = "0".repeat(32);
const DUMMY_HASH = hashPassword("zca-bridge-dummy-password").hash;

export interface AuthDeps {
  users: Pick<AdminUserRepo, "hasAny" | "create" | "findByUsername">;
  sessionSecret: Buffer;
}

/** Fastify preHandler requiring a valid session cookie; 401 otherwise. */
export function makeRequireSession(sessionSecret: Buffer) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!verifySession(req.headers.cookie, sessionSecret)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  app.get("/admin/api/auth-status", async (req) => ({
    needsSetup: !(await deps.users.hasAny()),
    authed: !!verifySession(req.headers.cookie, deps.sessionSecret),
  }));

  app.post<{ Body: { username?: string; password?: string } }>("/admin/api/setup", async (req, reply) => {
    if (await deps.users.hasAny()) return reply.code(409).send({ ok: false, error: "admin already exists" });
    const username = (req.body?.username ?? "").trim();
    const password = req.body?.password ?? "";
    if (!username || password.length < 8) return reply.code(400).send({ ok: false, error: "weak" });
    const { hash, salt } = hashPassword(password);
    await deps.users.create(username, hash, salt);
    reply.header("Set-Cookie", sessionCookieHeader(signSession(username, deps.sessionSecret)));
    return reply.send({ ok: true });
  });

  app.post<{ Body: { username?: string; password?: string } }>("/admin/api/login", async (req, reply) => {
    const username = (req.body?.username ?? "").trim();
    const password = req.body?.password ?? "";
    const user = username ? await deps.users.findByUsername(username) : null;
    const ok = user
      ? verifyPassword(password, user.salt, user.passHash)
      : (verifyPassword(password, DUMMY_SALT, DUMMY_HASH), false);
    if (!ok) {
      return reply.code(401).send({ ok: false, error: "Sai tài khoản hoặc mật khẩu" });
    }
    reply.header("Set-Cookie", sessionCookieHeader(signSession(username, deps.sessionSecret)));
    return reply.send({ ok: true });
  });

  app.post("/admin/api/logout", async (_req, reply) => {
    reply.header("Set-Cookie", clearSessionCookieHeader());
    return reply.send({ ok: true });
  });
}
