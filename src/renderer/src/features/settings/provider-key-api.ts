import type { ProviderAdminDesktopApi } from "@aikingbot/contracts/ipc";
import type { ProviderKeyApi } from "@aikingbot/ui/features/settings/OpenCodeKeyDialog";

/**
 * The four calls the OpenCode key dialog makes, bound once.
 *
 * It is a narrow object rather than `window.aikingbot` itself so the dialog's props say exactly what
 * it reaches for, and so a test hands it four functions instead of the whole bridge. Settings and
 * onboarding both open the dialog, so it lives here rather than in either.
 */
export const providerKeyApi: ProviderKeyApi = {
  getProviderApiKeyState: (provider) => window.aikingbot.getProviderApiKeyState(provider),
  setProviderApiKey: (input) => window.aikingbot.setProviderApiKey(input),
  clearProviderApiKey: (provider) => window.aikingbot.clearProviderApiKey(provider),
  openExternal: (destination) => window.aikingbot.openExternal(destination),
};

/**
 * The same four calls for the host of a joined server the account administers. The key goes to that
 * host, and only its state comes back. Links still open on this computer: in the desktop app by
 * default, or through `openExternal` where there is no desktop bridge, as in the browser client.
 */
export function hostProviderKeyApi(
  admin: () => ProviderAdminDesktopApi,
  serverId: string,
  openExternal: ProviderKeyApi["openExternal"] = (destination) => window.aikingbot.openExternal(destination),
): ProviderKeyApi {
  return {
    getProviderApiKeyState: (provider) => admin().getApiKeyState(provider, serverId),
    setProviderApiKey: (input) => admin().setApiKey(input, serverId),
    clearProviderApiKey: (provider) => admin().clearApiKey(provider, serverId),
    openExternal,
  };
}
