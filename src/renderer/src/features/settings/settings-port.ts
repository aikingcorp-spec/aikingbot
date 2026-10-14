import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/**
 * What the settings context reaches in main: the app-wide preferences and the switches for
 * updates, notifications and the Dynamic Island.
 */
export interface SettingsPort {
  getAgentMemoryLimitPreference: AIKINGBOTDesktopApi["getAgentMemoryLimitPreference"];
  getAnalyticsPreference: AIKINGBOTDesktopApi["getAnalyticsPreference"];
  getApprovalAutomation: AIKINGBOTDesktopApi["getApprovalAutomation"];
  getBusyMessageModePreference: AIKINGBOTDesktopApi["getBusyMessageModePreference"];
  getRemoteSessionReusePreference: AIKINGBOTDesktopApi["getRemoteSessionReusePreference"];
  onApprovalAutomation: AIKINGBOTDesktopApi["onApprovalAutomation"];
  onOpenSettings: AIKINGBOTDesktopApi["onOpenSettings"];
  setAgentMemoryLimitPreference: AIKINGBOTDesktopApi["setAgentMemoryLimitPreference"];
  setAnalyticsPreference: AIKINGBOTDesktopApi["setAnalyticsPreference"];
  setApprovalAutomation: AIKINGBOTDesktopApi["setApprovalAutomation"];
  setBusyMessageModePreference: AIKINGBOTDesktopApi["setBusyMessageModePreference"];
  setRemoteSessionReusePreference: AIKINGBOTDesktopApi["setRemoteSessionReusePreference"];
  dynamicIsland: Pick<
    AIKINGBOTDesktopApi["dynamicIsland"],
    "getBuiltInDisplayGeometry" | "getPreference" | "setPreference"
  >;
  notifications: Pick<
    AIKINGBOTDesktopApi["notifications"],
    "getPreference" | "openSettings" | "setPreference" | "test"
  >;
  update: Pick<AIKINGBOTDesktopApi["update"], "getPreference" | "onPreference" | "setPreference">;
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function settingsPort(): SettingsPort {
  return window.aikingbot;
}
