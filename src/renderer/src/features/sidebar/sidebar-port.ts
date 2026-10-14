import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/**
 * What the sidebar reaches in main: the saved sidebar layout and its changes.
 */
export interface SidebarPort {
  agent: Pick<AIKINGBOTDesktopApi["agent"], "getSidebarLayout" | "mutateSidebarLayout">;
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function sidebarPort(): SidebarPort {
  return window.aikingbot;
}
