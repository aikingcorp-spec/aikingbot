import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/**
 * What the storage panels reach in main: the stored files of a server, and the agent names that
 * label them.
 */
export interface FilesPort {
  agent: Pick<AIKINGBOTDesktopApi["agent"], "listAgents">;
  storage: Pick<AIKINGBOTDesktopApi["storage"], "clear" | "deleteFile" | "getUsage" | "openFile">;
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function filesPort(): FilesPort {
  return window.aikingbot;
}
