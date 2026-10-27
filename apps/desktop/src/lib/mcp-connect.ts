// 2.1: the request_connect card's two paths, both from the person's own session. Pure over `call` so tests mock the network.
export type ApiCall = (path: string, init?: { method?: string; body?: string }) => Promise<Record<string, unknown>>;
export interface McpConnectTarget { server: string; auth: "oauth" | "api-key"; header: string }

const serverPath = (server: string) => `/api/mcp/servers/${encodeURIComponent(server)}`;

/** OAuth: starts the sign-in bound to this session; returns the page to open, then marks the card as waiting. */
export async function startMcpOAuth(call: ApiCall, target: McpConnectTarget, statusPath: string): Promise<string> {
  const started = await call(`${serverPath(target.server)}/sign-in`, { method: "POST", body: "{}" });
  const auth = started.auth as { authorizationUrl?: unknown; phase?: unknown } | undefined;
  await call(`${statusPath}&started=1`);
  if (typeof auth?.authorizationUrl === "string" && auth.authorizationUrl) return auth.authorizationUrl;
  throw new Error("The service did not return a sign-in page.");
}

/** API key: saves it as the server's header; the value never comes back. Returns whether the card is now connected. */
export async function saveMcpApiKey(call: ApiCall, target: McpConnectTarget, value: string, statusPath: string): Promise<boolean> {
  const key = value.trim();
  if (!key) throw new Error("Paste the API key first.");
  await call(`${serverPath(target.server)}/api-key`, { method: "POST", body: JSON.stringify({ header: target.header, value: key }) });
  const status = await call(statusPath);
  return status.connected === true;
}
