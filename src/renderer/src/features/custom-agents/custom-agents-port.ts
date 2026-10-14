import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/**
 * What the custom agents context reaches in main: the ACP agents the user added. This computer
 * only: the Team API has no route to them, because an agent is a command that runs here.
 */
export interface CustomAgentsPort {
  customAgents: AIKINGBOTDesktopApi["customAgents"];
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function customAgentsPort(): CustomAgentsPort {
  return window.aikingbot;
}
