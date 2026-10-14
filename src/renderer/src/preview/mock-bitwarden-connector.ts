import type { AIKINGBOTDesktopApi, BitwardenConnectorStatus } from "@aikingbot/contracts/ipc";

export function createMockBitwardenConnector(): AIKINGBOTDesktopApi["bitwardenConnector"] {
  let connected = false;
  const listeners = new Set<(status: BitwardenConnectorStatus) => void>();
  const change = (value: boolean) => {
    connected = value;
    const status = { connected };
    for (const listener of listeners) listener(status);
    return status;
  };
  return {
    status: async () => ({ connected }),
    connect: async () => change(true),
    disconnect: async () => change(false),
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
