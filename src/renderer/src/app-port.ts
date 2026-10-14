import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/**
 * What the app shell and the cross-domain root modules reach in main, plus the shell actions
 * (`openUrl`, `openExternal`) that several domains share.
 */
export interface AppPort {
  getAppInfo: AIKINGBOTDesktopApi["getAppInfo"];
  getAppLanguagePreference: AIKINGBOTDesktopApi["getAppLanguagePreference"];
  getAppLogoColorPreference: AIKINGBOTDesktopApi["getAppLogoColorPreference"];
  onAppLanguagePreference: AIKINGBOTDesktopApi["onAppLanguagePreference"];
  onAppLogoColorPreference: AIKINGBOTDesktopApi["onAppLogoColorPreference"];
  openExternal: AIKINGBOTDesktopApi["openExternal"];
  openUrl: AIKINGBOTDesktopApi["openUrl"];
  setAppLanguagePreference: AIKINGBOTDesktopApi["setAppLanguagePreference"];
  setAppLogoColorPreference: AIKINGBOTDesktopApi["setAppLogoColorPreference"];
  agent: Pick<
    AIKINGBOTDesktopApi["agent"],
    "readConversationPage" | "searchConversationMessages" | "searchConversationFiles" | "listRoutines" | "listAgents"
  >;
  agentTemplates: Pick<AIKINGBOTDesktopApi["agentTemplates"], "onOpenLink" | "takePendingLink">;
  acpRegistry: AIKINGBOTDesktopApi["acpRegistry"];
  hostedSites: AIKINGBOTDesktopApi["hostedSites"];
  billing: AIKINGBOTDesktopApi["billing"];
  hostedServers: AIKINGBOTDesktopApi["hostedServers"];
  routineFeed: AIKINGBOTDesktopApi["routineFeed"];
  events: AIKINGBOTDesktopApi["events"];
  plugins: Pick<AIKINGBOTDesktopApi["plugins"], "onOpenListing" | "takePendingListing">;
  servers: Pick<AIKINGBOTDesktopApi["servers"], "onInvite" | "takePendingInvite">;
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function appPort(): AppPort {
  return window.aikingbot;
}
