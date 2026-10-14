import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/** What the 1Password page reaches in main: the one 1Password connection of this computer. */
export type OnePasswordConnectorPort = AIKINGBOTDesktopApi["onePasswordConnector"];

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function onePasswordConnectorPort(): OnePasswordConnectorPort {
  return window.aikingbot.onePasswordConnector;
}
