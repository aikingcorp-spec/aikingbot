import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/**
 * What Computer Use reaches in main: the driver state, the macOS permission panes and helper, and
 * the highlight placement. The helper and highlight windows have no provider tree, so this is a
 * module.
 */
export interface ComputerUsePort {
  computerUse: AIKINGBOTDesktopApi["computerUse"];
  remoteDesktop: Pick<AIKINGBOTDesktopApi["remoteDesktop"], "checkSetup">;
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function computerUsePort(): ComputerUsePort {
  return window.aikingbot;
}
