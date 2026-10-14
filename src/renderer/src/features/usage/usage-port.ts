import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/**
 * What the usage panel reaches in main: the analytics of a server, its agents, and the events that
 * make the report stale.
 */
export interface UsagePort {
  agent: Pick<AIKINGBOTDesktopApi["agent"], "getHostAnalytics" | "listAgents" | "onScopedEvent">;
  servers: Pick<AIKINGBOTDesktopApi["servers"], "onEvent">;
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function usagePort(): UsagePort {
  return window.aikingbot;
}
