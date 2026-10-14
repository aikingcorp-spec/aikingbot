import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/**
 * What the account context reaches in main: the AIKINGBOT account session, its devices, and the
 * usage the account dock shows.
 */
export interface AccountPort {
  agent: Pick<AIKINGBOTDesktopApi["agent"], "getUsage">;
  auth: Pick<
    AIKINGBOTDesktopApi["auth"],
    | "cancelMobileConnect"
    | "createMobileConnect"
    | "createMobileConnectLink"
    | "getMobileConnectLink"
    | "getState"
    | "listAccountSessions"
    | "listMobileConnectedDevices"
    | "logout"
    | "onEvent"
    | "requestEmailCode"
    | "retry"
    | "revokeAccountSession"
    | "revokeMobileConnectedDevice"
    | "revokeMobileConnectLink"
    | "updateAvatar"
    | "updateName"
    | "verifyEmailCode"
  >;
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function accountPort(): AccountPort {
  return window.aikingbot;
}
