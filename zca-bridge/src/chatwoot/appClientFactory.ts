import { ChatwootAppClient } from "./appClient.js";
import type { AccountRepo } from "../store/accountRepo.js";

/** Resolve a ChatwootAppClient bound to the Chatwoot account id for a given Zalo account. */
export type AppClientFor = (zaloAccountId: number) => Promise<ChatwootAppClient>;

export function makeAppClientFor(
  baseUrl: string,
  accessToken: string | null,
  globalAccountId: number | null,
  accounts: Pick<AccountRepo, "findById">,
): AppClientFor {
  return async (zaloAccountId) => {
    const acc = await accounts.findById(zaloAccountId);
    const accountId = acc?.chatwootAccountId ?? globalAccountId;
    return new ChatwootAppClient(baseUrl, accessToken, accountId);
  };
}
