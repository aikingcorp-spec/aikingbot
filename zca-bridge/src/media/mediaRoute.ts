import type { FastifyInstance } from "fastify";
import type { BinaryLike } from "node:crypto";
import type { MediaArchive } from "./archive.js";
import { verifyMediaToken } from "./token.js";

export function registerMediaRoute(app: FastifyInstance, archive: MediaArchive, tokenSecret: BinaryLike): void {
  app.get<{ Params: { token: string } }>("/media/:token", async (req, reply) => {
    const result = verifyMediaToken(req.params.token, tokenSecret);
    if (!result.ok) {
      return reply.code(result.reason === "expired" ? 410 : 403).send({ error: result.reason });
    }
    const found = await archive.getStream(result.key);
    if (!found) return reply.code(404).send({ error: "not found" });
    const filename = (result.key.split("/").pop() ?? "file").replace(/[\x00-\x1f\x7f"]/g, "");
    reply.header("content-type", found.contentType);
    reply.header("content-length", String(found.size));
    reply.header("content-disposition", `attachment; filename="${filename}"`);
    return reply.send(found.stream);
  });
}
