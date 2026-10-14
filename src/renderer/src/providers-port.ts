import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/**
 * What provider state reaches in main: connecting, signing in and refreshing providers, and the
 * runtimes AIKINGBOT installs for them, on this computer or on a host the account administers.
 */
export interface ProvidersPort {
  cancelProviderCodeLogin: AIKINGBOTDesktopApi["cancelProviderCodeLogin"];
  connectProvider: AIKINGBOTDesktopApi["connectProvider"];
  cancelProviderSignIn: AIKINGBOTDesktopApi["cancelProviderSignIn"];
  refreshAgentProviders: AIKINGBOTDesktopApi["refreshAgentProviders"];
  setProviderOn: AIKINGBOTDesktopApi["setProviderOn"];
  restartProvider: AIKINGBOTDesktopApi["restartProvider"];
  cancelProviderRestart: AIKINGBOTDesktopApi["cancelProviderRestart"];
  startProviderCodeLogin: AIKINGBOTDesktopApi["startProviderCodeLogin"];
  providerRuntimes: AIKINGBOTDesktopApi["providerRuntimes"];
  /** The same, for the host of a joined server the account administers. */
  providerAdmin: AIKINGBOTDesktopApi["providerAdmin"];
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function providersPort(): ProvidersPort {
  return window.aikingbot;
}
