import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/**
 * What team presence reaches in main: who is online, and whether this member is typing.
 */
export interface TeamPort {
  servers: Pick<AIKINGBOTDesktopApi["servers"], "onPresence" | "setTyping">;
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function teamPort(): TeamPort {
  return window.aikingbot;
}
