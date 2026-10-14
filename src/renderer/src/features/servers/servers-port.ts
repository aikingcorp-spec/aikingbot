import type { AIKINGBOTDesktopApi, ServerSummary } from "@aikingbot/contracts/ipc";

/**
 * What the servers domain reaches in main: the server list and selection, the account changes, the local host, the
 * settings dialog of one server, the name and logo of a joined server's host, and the remote desktop
 * setup of a server.
 */
export interface ServersPort {
  agent: Pick<
    AIKINGBOTDesktopApi["agent"],
    | "getStatus"
    | "listAgents"
    | "listConversationReads"
    | "listMcpServers"
    | "listModels"
    | "removeMcpServer"
    | "saveMcpServer"
    | "setMcpServerEnabled"
    | "testMcpServer"
    | "signInMcpServer"
    | "mcpSignInPage"
    | "mcpSignInRelay"
    | "openMcpSignInRelay"
    | "completeMcpSignInRelay"
    | "cancelMcpSignIn"
    | "signOutMcpServer"
    | "listMcpSignIns"
    | "mcpSignInApp"
    | "saveMcpSignInApp"
    | "removeMcpSignInApp"
  >;
  events: AIKINGBOTDesktopApi["events"];
  auth: Pick<AIKINGBOTDesktopApi["auth"], "onEvent">;
  browser: Pick<AIKINGBOTDesktopApi["browser"], "setVisible">;
  hostAdmin: Pick<AIKINGBOTDesktopApi["hostAdmin"], "getUpdateStatus" | "updateIdentity">;
  hostedServers: Pick<AIKINGBOTDesktopApi["hostedServers"], "list" | "restart" | "wake">;
  host: Pick<
    AIKINGBOTDesktopApi["host"],
    "configure" | "getStatus" | "onEvent" | "recheckScreenRecording" | "start" | "stop" | "updateIdentity"
  >;
  notifications: Pick<AIKINGBOTDesktopApi["notifications"], "onOpened">;
  remoteDesktop: Pick<
    AIKINGBOTDesktopApi["remoteDesktop"],
    "checkSetup" | "connect" | "disconnect" | "list" | "openSetup" | "test"
  >;
  servers: Pick<
    AIKINGBOTDesktopApi["servers"],
    | "getPresence"
    | "join"
    | "list"
    | "onEvent"
    | "onPresence"
    | "refreshIdentity"
    | "remove"
    | "reorder"
    | "retryConnection"
    | "select"
    | "setMuted"
    | "setNotificationLevel"
  >;
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function serversPort(): ServersPort {
  return window.aikingbot;
}

/**
 * The member and invite calls for one server. This computer answers them for the local server
 * through `host`; a remote server answers them through `servers`, addressed by its id.
 */
export type ServerAdminPort = Pick<
  AIKINGBOTDesktopApi["host"],
  "getPresence" | "listMembers" | "listInvites" | "createInvite" | "updateMember" | "removeMember" | "revokeInvite"
>;

export function serverAdminPort(server: Pick<ServerSummary, "id" | "kind">): ServerAdminPort {
  if (server.kind === "local") return window.aikingbot.host;
  const serverId = server.id;
  return {
    getPresence: () => window.aikingbot.servers.getPresenceFor(serverId),
    listMembers: () => window.aikingbot.servers.listMembers(serverId),
    listInvites: () => window.aikingbot.servers.listInvites(serverId),
    createInvite: (input) => window.aikingbot.servers.createInvite(input, serverId),
    updateMember: (input) => window.aikingbot.servers.updateMember(input, serverId),
    removeMember: (memberId) => window.aikingbot.servers.removeMember(memberId, serverId),
    revokeInvite: (inviteId) => window.aikingbot.servers.revokeInvite(inviteId, serverId),
  };
}

/** The server main marks active. A test teardown can remove the bridge while a join is pending. */
export async function activeServerId(): Promise<string> {
  if (!window.aikingbot) return "local";
  return (await window.aikingbot.servers.list()).find((item) => item.active)?.id ?? "local";
}
