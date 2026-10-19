import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { InfoCardRepo, InfoCardRow } from "../store/infoCardRepo.js";

type Pre = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

const TITLE_MAX = 100;
const SUBTITLE_MAX = 500;

export function registerInfoCardRoutes(
  app: FastifyInstance,
  infoCard: Pick<InfoCardRepo, "get" | "upsert">,
  guard: Pre,
  requireWrite: Pre = guard,
): void {
  app.get<{ Params: { id: string } }>(
    "/admin/api/accounts/:id/info-card",
    { preHandler: guard },
    async (req) => infoCard.get(Number(req.params.id)),
  );

  app.put<{ Params: { id: string }; Body: Partial<InfoCardRow> }>(
    "/admin/api/accounts/:id/info-card",
    { preHandler: requireWrite },
    async (req, reply) => {
      const b = req.body ?? {};
      const title = String(b.title ?? "").trim();
      const subtitle = String(b.subtitle ?? "").trim();
      const imageUrl = String(b.imageUrl ?? "").trim();
      const enabled = !!b.enabled;
      if (title.length > TITLE_MAX) return reply.code(400).send({ ok: false, error: "title_too_long" });
      if (subtitle.length > SUBTITLE_MAX) return reply.code(400).send({ ok: false, error: "subtitle_too_long" });
      if (imageUrl && !/^https?:\/\//i.test(imageUrl)) return reply.code(400).send({ ok: false, error: "image_url_invalid" });
      if (enabled && !imageUrl) return reply.code(400).send({ ok: false, error: "image_required_when_enabled" });
      await infoCard.upsert(Number(req.params.id), { enabled, title, subtitle, imageUrl });
      return { ok: true };
    },
  );
}
