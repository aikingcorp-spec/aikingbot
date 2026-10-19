import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ProxyRepo, ProxyInput } from "../store/proxyRepo.js";
import type { AccountRepo } from "../store/accountRepo.js";
import type { ProxyProtocol } from "../zalo/proxyOptions.js";

type Pre = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

const PROTOCOLS: ProxyProtocol[] = ["http", "https", "socks5"];

function parseId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function parseInput(body: any): ProxyInput | { error: string } {
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) return { error: "label_required" };
  if (!PROTOCOLS.includes(body?.protocol)) return { error: "invalid_protocol" };
  const host = typeof body?.host === "string" ? body.host.trim() : "";
  if (!host) return { error: "host_required" };
  const port = Number(body?.port);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) return { error: "invalid_port" };
  const username = typeof body?.username === "string" && body.username !== "" ? body.username : null;
  const password = typeof body?.password === "string" && body.password !== "" ? body.password : null;
  return { label, protocol: body.protocol, host, port, username, password };
}

export function registerProxyRoutes(
  app: FastifyInstance,
  proxies: Pick<ProxyRepo, "create" | "list" | "update" | "delete">,
  accounts: Pick<AccountRepo, "listByProxy" | "setProxy">,
  guard: Pre,
  requireWrite: Pre = guard,
): void {
  app.get("/admin/api/proxies", { preHandler: guard }, async () => ({ proxies: await proxies.list() }));

  app.post("/admin/api/proxies", { preHandler: requireWrite }, async (req, reply) => {
    const parsed = parseInput(req.body);
    if ("error" in parsed) return reply.code(400).send({ ok: false, error: parsed.error });
    const proxy = await proxies.create(parsed);
    return reply.send({ ok: true, proxy });
  });

  app.patch<{ Params: { id: string } }>("/admin/api/proxies/:id", { preHandler: requireWrite }, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ ok: false });
    const parsed = parseInput(req.body);
    if ("error" in parsed) return reply.code(400).send({ ok: false, error: parsed.error });
    // PATCH replaces all editable fields; omit password (empty string) to keep the stored one.
    const body = req.body as { password?: unknown };
    const patch: Partial<ProxyInput> & { password?: string | null } = {
      label: parsed.label, protocol: parsed.protocol, host: parsed.host, port: parsed.port, username: parsed.username,
    };
    if (typeof body?.password === "string" && body.password !== "") patch.password = body.password;
    const proxy = await proxies.update(id, patch);
    if (!proxy) return reply.code(404).send({ ok: false });
    return reply.send({ ok: true, proxy });
  });

  app.delete<{ Params: { id: string }; Querystring: { confirm?: string } }>(
    "/admin/api/proxies/:id",
    { preHandler: requireWrite },
    async (req, reply) => {
      const id = parseId(req.params.id);
      if (id === null) return reply.code(400).send({ ok: false });
      const using = await accounts.listByProxy(id);
      if (using.length > 0 && req.query.confirm !== "1") {
        return reply.code(409).send({
          ok: false,
          error: "proxy_in_use",
          accounts: using.map((a) => ({ id: a.id, label: a.label })),
        });
      }
      for (const a of using) await accounts.setProxy(a.id, null);
      const deleted = await proxies.delete(id);
      if (!deleted) return reply.code(404).send({ ok: false });
      return reply.send({ ok: true, detached: using.map((a) => a.id) });
    },
  );
}
