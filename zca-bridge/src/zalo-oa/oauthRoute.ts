import type { FastifyInstance } from "fastify";
import { OaOAuthClient } from "./oauthClient.js";
import { OaTokenRepo } from "../store/oaTokenRepo.js";
import { AccountRepo } from "../store/accountRepo.js";
import { verifySession } from "../admin/auth.js";

export interface OaOAuthDeps {
  oauth: OaOAuthClient;
  tokens: OaTokenRepo;
  accounts: Pick<AccountRepo, "setOaId" | "updateStatus">;
  redirectUri: string;
  sessionSecret: Buffer;
  fetchOaId: (accessToken: string) => Promise<string>;
  onConnected: (accountId: number) => void;
}

export function registerOaOAuthRoutes(app: FastifyInstance, deps: OaOAuthDeps): void {
  app.get("/admin/oa/connect", async (req, reply) => {
    if (!verifySession(req.headers.cookie, deps.sessionSecret)) return reply.redirect("/admin/");
    const q = req.query as { accountId?: string };
    if (!q.accountId) return reply.code(400).send({ ok: false });
    return reply.redirect(deps.oauth.permissionUrl(deps.redirectUri, String(q.accountId)));
  });

  app.get("/oa/oauth/callback", async (req, reply) => {
    const q = req.query as { code?: string; state?: string };
    const accountId = Number(q.state);
    if (!q.code || !accountId) return reply.code(400).send({ ok: false });
    const t = await deps.oauth.exchangeCode(q.code);
    const expiresAt = new Date(Date.now() + t.expiresInSec * 1000);
    await deps.tokens.save(accountId, { accessToken: t.accessToken, refreshToken: t.refreshToken }, expiresAt);
    const oaId = await deps.fetchOaId(t.accessToken);
    await deps.accounts.setOaId(accountId, oaId);
    await deps.accounts.updateStatus(accountId, "connected");
    deps.onConnected(accountId);
    return reply.redirect("/admin/");
  });
}
