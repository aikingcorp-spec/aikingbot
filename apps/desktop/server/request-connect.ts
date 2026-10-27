// 2.1: request_connect. The agent asks for a service the person added in Settings but has not connected; the chat card is the
// handoff. OAuth starts from the person's click, in their own session (/api/mcp/servers/:name/sign-in); an API key goes
// through the card's inline secret form straight to /api/mcp/servers/:name/api-key. The key never reaches the agent or chat.

export type McpConnectAuth = "oauth" | "api-key";
export interface McpConnectCard { server: string; auth: McpConnectAuth; header: string }

export const SERVER_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
export const API_KEY_MAX = 4_096;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
/** Same ceiling as every other way of setting a server's headers (mcp-registry MAX_HEADERS). */
export const API_KEY_MAX_HEADERS = 32;
/** Headers a key may be sent in: the common auth names, or an X-…-Key / X-…-Token / X-…-Secret header. */
const KEY_HEADERS = new Set(["authorization", "api-key", "apikey", "x-api-key", "x-api-token", "x-auth-token", "x-access-token", "x-goog-api-key", "private-token", "x-key", "x-token"]);
const KEY_HEADER_PATTERN = /^x-[a-z0-9]+(?:-[a-z0-9]+)*-(?:key|token|secret|auth)$/;
/** Never settable: routing and hop-by-hop headers a key form could use to steer or smuggle the request. */
const FORBIDDEN_HEADERS = new Set(["host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "trailers", "transfer-encoding", "upgrade", "content-length", "content-type", "cookie", "origin", "referer", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "expect", "via"]);

/** null when `header` may carry an API key; otherwise why not. */
export function apiKeyHeaderRefusal(header: string): string | null {
  if (!HEADER_NAME.test(header)) return "Invalid header name.";
  const lower = header.toLowerCase();
  if (FORBIDDEN_HEADERS.has(lower)) return `${header} cannot carry an API key.`;
  if (!KEY_HEADERS.has(lower) && !KEY_HEADER_PATTERN.test(lower)) return "Use Authorization, X-API-Key or another X-…-Key / X-…-Token header for an API key.";
  return null;
}

/** A stored or resolved remote server entry; other fields (oauth, enabled, type) pass through untouched. */
export interface RemoteLike { url: string; headers?: Record<string, string> }
const isRemote = (server: unknown): server is RemoteLike =>
  Boolean(server && typeof server === "object" && typeof (server as { url?: unknown }).url === "string");

/** null when the service is already usable; an error string the agent can act on when it cannot be connected here. */
export function planConnect(
  name: unknown,
  servers: Record<string, unknown>,
  authState: (name: string, url: string) => string,
  rawHeader?: unknown,
): { card: McpConnectCard } | { connected: true; server: string } | { error: string } {
  const server = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (!SERVER_NAME.test(server)) return { error: "server must be the name of a service the person added, such as notion." };
  const spec = servers[server];
  if (!spec) {
    const known = Object.keys(servers).sort().slice(0, 20);
    return { error: `No service named ${server} is added. ${known.length ? `Added services: ${known.join(", ")}.` : "None are added yet."} To find a new one, call marketplace_search.` };
  }
  if (!isRemote(spec)) return { error: `${server} runs on this computer and needs no connection; use its tools.` };
  const header = typeof rawHeader === "string" && !apiKeyHeaderRefusal(rawHeader.trim()) ? rawHeader.trim() : "Authorization";
  const state = authState(server, spec.url);
  if (state === "needs-sign-in") return { card: { server, auth: "oauth", header } };
  if (state === "signed-in") return { connected: true, server };
  const hasKey = Object.keys(spec.headers ?? {}).some((key) => key.toLowerCase() === header.toLowerCase());
  return hasKey && rawHeader === undefined ? { connected: true, server } : { card: { server, auth: "api-key", header } };
}

export function mcpCardConnected(card: McpConnectCard, spec: unknown, authState: (name: string, url: string) => string): boolean {
  if (!isRemote(spec)) return false;
  if (card.auth === "oauth") return authState(card.server, spec.url) === "signed-in";
  return Object.entries(spec.headers ?? {}).some(([key, value]) => key.toLowerCase() === card.header.toLowerCase() && value.length > 0);
}

/** The stored server with the key set; "Authorization" keys get a Bearer prefix unless they carry a scheme already. */
export function withApiKey<T>(spec: T, header: string, rawValue: unknown): { server: T & RemoteLike } | { error: string } {
  if (!isRemote(spec)) return { error: "This service does not take an API key." };
  const refusal = apiKeyHeaderRefusal(header);
  if (refusal) return { error: refusal };
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!value || value.length > API_KEY_MAX || /[\r\n]/.test(value)) return { error: "Paste one API key on one line." };
  const stored = header.toLowerCase() === "authorization" && !/^\w+\s+\S/.test(value) ? `Bearer ${value}` : value;
  const headers = Object.fromEntries(Object.entries(spec.headers ?? {}).filter(([key]) => key.toLowerCase() !== header.toLowerCase()));
  if (Object.keys(headers).length + 1 > API_KEY_MAX_HEADERS) return { error: `Use at most ${API_KEY_MAX_HEADERS} headers.` };
  return { server: { ...spec, headers: { ...headers, [header]: stored } } };
}

export function connectCardText(label: string, auth: McpConnectAuth): string {
  return auth === "oauth" ? `Connect ${label}: sign in from this card to continue.` : `Connect ${label}: enter its API key in this card to continue.`;
}
