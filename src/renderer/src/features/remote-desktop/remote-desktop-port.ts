import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/**
 * What the remote desktop context reaches in main: the sessions this computer holds to other
 * servers.
 */
export interface RemoteDesktopPort {
  remoteDesktop: Pick<
    AIKINGBOTDesktopApi["remoteDesktop"],
    "connect" | "disconnect" | "list" | "onEvent" | "selectDisplay"
  >;
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function remoteDesktopPort(): RemoteDesktopPort {
  return window.aikingbot;
}
