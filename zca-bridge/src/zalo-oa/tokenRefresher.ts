import { OaTokenRepo } from "../store/oaTokenRepo.js";
import { OaOAuthClient } from "./oauthClient.js";
import { AccountRepo } from "../store/accountRepo.js";

export interface RefresherDeps {
  tokens: OaTokenRepo;
  oauth: OaOAuthClient;
  accounts: Pick<AccountRepo, "updateStatus">;
  log: { error: (obj: unknown, msg?: string) => void };
}

// Refresh tokens that expire before `cutoff`. Each refresh persists the new (single-use) pair.
export async function refreshDueTokens(deps: RefresherDeps, cutoff: Date): Promise<void> {
  const due = await deps.tokens.listExpiring(cutoff);
  for (const accountId of due) {
    try {
      const stored = await deps.tokens.load(accountId);
      if (!stored) continue;
      const t = await deps.oauth.refresh(stored.refreshToken);
      await deps.tokens.save(accountId, { accessToken: t.accessToken, refreshToken: t.refreshToken }, new Date(Date.now() + t.expiresInSec * 1000));
    } catch (err) {
      deps.log.error({ err, accountId }, "OA token refresh failed");
      await deps.accounts.updateStatus(accountId, "expired").catch(() => {});
    }
  }
}

export function startOaTokenRefresher(deps: RefresherDeps, intervalMs = 5 * 60_000): () => void {
  const tick = () => { refreshDueTokens(deps, new Date(Date.now() + 10 * 60_000)).catch((err) => deps.log.error({ err }, "refresher tick failed")); };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
