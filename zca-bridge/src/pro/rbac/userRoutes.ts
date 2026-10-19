import type { FastifyInstance } from "fastify";
import type { AdminPreHandler } from "../../extension/registry.js";
import type { RbacRepo } from "./rbacRepo.js";
import { hashPassword, verifySession } from "../../admin/auth.js";

const VALID_ROLES = new Set(["owner", "admin", "operator"]);

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

export function registerUserRoutes(
  app: FastifyInstance,
  repo: Pick<RbacRepo, "listUsers" | "findById" | "createUser" | "setRole" | "setPassword" | "deleteUser" | "countOwners">,
  guard: AdminPreHandler,
  sessionSecret: Buffer,
): void {
  app.get("/admin/api/users", { preHandler: guard }, async () => ({ users: await repo.listUsers() }));

  app.post<{ Body: { username?: string; password?: string; role?: string } }>(
    "/admin/api/users", { preHandler: guard }, async (req, reply) => {
      const username = (req.body?.username ?? "").trim();
      const password = req.body?.password ?? "";
      const role = req.body?.role ?? "";
      if (!username || !VALID_ROLES.has(role)) return reply.code(400).send({ ok: false, error: "invalid" });
      if (password.length < 8) return reply.code(400).send({ ok: false, error: "weak_password" });
      const { hash, salt } = hashPassword(password);
      try {
        await repo.createUser(username, hash, salt, role);
      } catch {
        return reply.code(409).send({ ok: false, error: "username_taken" });
      }
      return reply.send({ ok: true });
    });

  app.patch<{ Params: { id: string }; Body: { role?: string; password?: string } }>(
    "/admin/api/users/:id", { preHandler: guard }, async (req, reply) => {
      const id = parseId(req.params.id);
      if (id === null) return reply.code(400).send({ ok: false });
      const target = await repo.findById(id);
      if (!target) return reply.code(404).send({ ok: false });
      const role = req.body?.role;
      if (role !== undefined) {
        if (!VALID_ROLES.has(role)) return reply.code(400).send({ ok: false, error: "invalid_role" });
        if (target.role === "owner" && role !== "owner" && (await repo.countOwners()) <= 1) {
          return reply.code(409).send({ ok: false, error: "last_owner" });
        }
        await repo.setRole(id, role);
      }
      const password = req.body?.password;
      if (password !== undefined) {
        if (password.length < 8) return reply.code(400).send({ ok: false, error: "weak_password" });
        const { hash, salt } = hashPassword(password);
        await repo.setPassword(id, hash, salt);
      }
      return reply.send({ ok: true });
    });

  app.delete<{ Params: { id: string } }>(
    "/admin/api/users/:id", { preHandler: guard }, async (req, reply) => {
      const id = parseId(req.params.id);
      if (id === null) return reply.code(400).send({ ok: false });
      const target = await repo.findById(id);
      if (!target) return reply.code(404).send({ ok: false });
      const me = verifySession(req.headers.cookie, sessionSecret);
      if (me && me.username === target.username) {
        return reply.code(409).send({ ok: false, error: "cannot_delete_self" });
      }
      if (target.role === "owner" && (await repo.countOwners()) <= 1) {
        return reply.code(409).send({ ok: false, error: "last_owner" });
      }
      await repo.deleteUser(id);
      return reply.send({ ok: true });
    });
}
