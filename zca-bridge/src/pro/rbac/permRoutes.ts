import type { FastifyInstance } from "fastify";
import type { AdminPreHandler } from "../../extension/registry.js";
import type { RbacRepo } from "./rbacRepo.js";
import { PERMISSION_KEYS, OWNER_ONLY } from "./permissions.js";

const EDITABLE = new Set<string>(PERMISSION_KEYS);

export function registerPermRoutes(
  app: FastifyInstance,
  repo: Pick<RbacRepo, "getMatrix" | "setMatrix">,
  guard: AdminPreHandler,
  reloadMatrix: () => Promise<void>,
): void {
  app.get("/admin/api/permissions", { preHandler: guard }, async () => ({
    roles: ["admin", "operator"],
    editableKeys: [...PERMISSION_KEYS],
    ownerOnlyKeys: [...OWNER_ONLY],
    matrix: await repo.getMatrix(),
  }));

  app.put<{ Body: { role?: string; keys?: unknown } }>(
    "/admin/api/permissions", { preHandler: guard }, async (req, reply) => {
      const role = req.body?.role ?? "";
      if (role !== "admin" && role !== "operator") {
        return reply.code(400).send({ ok: false, error: "role_not_editable" });
      }
      const keys = Array.isArray(req.body?.keys) ? (req.body!.keys as unknown[]) : null;
      if (!keys || !keys.every((k) => typeof k === "string")) {
        return reply.code(400).send({ ok: false, error: "invalid_keys" });
      }
      for (const k of keys as string[]) {
        if (OWNER_ONLY.has(k) || !EDITABLE.has(k)) {
          return reply.code(400).send({ ok: false, error: "key_not_assignable", key: k });
        }
      }
      await repo.setMatrix(role, [...new Set(keys as string[])]);
      await reloadMatrix();
      return reply.send({ ok: true });
    });
}
