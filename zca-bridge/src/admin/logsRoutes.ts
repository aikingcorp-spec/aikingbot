import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { LogsRepo, LogQuery } from "../store/logsRepo.js";

type Pre = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerLogsRoutes(
  app: FastifyInstance,
  logs: Pick<LogsRepo, "query" | "dismiss">,
  guard: Pre,
): void {
  app.get<{ Querystring: { level?: string; accountId?: string; limit?: string; excludeDismissed?: string } }>(
    "/admin/api/logs",
    { preHandler: guard },
    async (req, reply) => {
      const q: LogQuery = { limit: 200 };
      const level = Number(req.query.level);
      if (Number.isFinite(level) && level > 0) q.minLevel = level;
      const accountId = Number(req.query.accountId);
      if (Number.isFinite(accountId) && accountId > 0) q.accountId = accountId;
      const limit = Number(req.query.limit);
      if (Number.isFinite(limit) && limit > 0) q.limit = limit;
      if (req.query.excludeDismissed === "1" || req.query.excludeDismissed === "true") q.excludeDismissed = true;
      try {
        return await logs.query(q);
      } catch (err) {
        req.log.error({ err }, "logs query failed");
        return reply.code(500).send({ ok: false, error: "query_failed" });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/logs/:id/dismiss",
    { preHandler: guard },
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) return reply.code(400).send({ ok: false });
      try {
        const ok = await logs.dismiss(id);
        if (!ok) return reply.code(404).send({ ok: false });
        return reply.send({ ok: true });
      } catch (err) {
        req.log.error({ err }, "log dismiss failed");
        return reply.code(500).send({ ok: false, error: "dismiss_failed" });
      }
    },
  );
}
