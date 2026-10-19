import type { FastifyInstance } from "fastify";
import type { AdminAuth, AdminAuthContext, AdminPreHandler } from "../../extension/registry.js";
import { verifySession } from "../../admin/auth.js";
import { RbacRepo } from "./rbacRepo.js";
import { isAllowed, type PermissionMatrix } from "./permissions.js";
import { registerUserRoutes } from "./userRoutes.js";
import { registerPermRoutes } from "./permRoutes.js";
import { registerProUi } from "./ui.js";

export function makeRbacAdminAuth(ctx: AdminAuthContext): AdminAuth {
  const repo = new RbacRepo(ctx.pool);
  const cache: { matrix: PermissionMatrix } = { matrix: {} };
  const reloadMatrix = async (): Promise<void> => { cache.matrix = await repo.getMatrix(); };

  const requirePermission = (key: string): AdminPreHandler => async (req, reply) => {
    const s = verifySession(req.headers.cookie, ctx.sessionSecret);
    if (!s) { await reply.code(401).send({ error: "unauthorized" }); return; }
    const role = await repo.getRole(s.username);
    if (!role) { await reply.code(401).send({ error: "unauthorized" }); return; }
    if (isAllowed(role, key, cache.matrix)) return; // pass through
    await reply.code(403).send({ error: "forbidden" });
  };

  return {
    async ensureSchema() {
      await repo.ensureSchema();
      await reloadMatrix();
    },
    requirePermission,
    async registerRoutes(app: FastifyInstance) {
      const owner = requirePermission("users.manage");
      const permsOwner = requirePermission("perms.manage");
      registerUserRoutes(app, repo, owner, ctx.sessionSecret);
      registerPermRoutes(app, repo, permsOwner, reloadMatrix);
      registerProUi(app);
    },
  };
}
