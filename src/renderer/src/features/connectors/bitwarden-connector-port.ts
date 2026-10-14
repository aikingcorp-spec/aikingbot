import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";
export function bitwardenConnectorPort(): AIKINGBOTDesktopApi["bitwardenConnector"] {
  return window.aikingbot.bitwardenConnector;
}
