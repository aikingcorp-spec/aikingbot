import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { McpOAuthManager } from "../mcp-oauth.ts";
import { createMcpServerRoutes } from "./mcp-servers.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });

async function serve(cfg: { mcpServers?: Record<string, unknown> }, persisted: Array<Record<string, unknown>>, refuse?: string) {
  let busy = false;
  const routes = [createMcpServerRoutes({
    cfg: cfg as never, sessions: { isLive: () => true }, mcpOAuth: {} as McpOAuthManager, cloudHome: null, fallbackPublicUrl: null,
    mcpConfigBusy: { get: () => busy, set: (value: boolean) => { busy = value; } } as never,
    mcpServerResponse: () => ({}), mcpServerBody: () => ({}), mcpPolicyRefusal: () => refuse,
    persistMcpServers: (next) => { persisted.push(next); cfg.mcpServers = next; }, savedCustomDomain: () => null,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["admin"] }, json, readBody });
    if (!handled) json(res, 404, { from: "fallthrough" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const post = (base: string, path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("2.1 inline API key route", () => {
  it("stores the key as a header, never echoes it, and keeps the rest of the server", async () => {
    const persisted: Array<Record<string, unknown>> = [];
    const base = await serve({ mcpServers: { linear: { type: "http", url: "https://mcp.linear.example/mcp", enabled: true } } }, persisted);
    const res = await post(base, "/api/mcp/servers/linear/api-key", { value: "lin_secret_1" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("lin_secret_1");
    expect(persisted[0]).toEqual({ linear: { type: "http", url: "https://mcp.linear.example/mcp", enabled: true, headers: { Authorization: "Bearer lin_secret_1" } } });
  });
  it("refuses unknown servers, bad keys, local servers and policy refusals", async () => {
    const persisted: Array<Record<string, unknown>> = [];
    const base = await serve({ mcpServers: { local: { command: "node", args: [] }, linear: { url: "https://x.example/mcp" } } }, persisted);
    expect((await post(base, "/api/mcp/servers/nope/api-key", { value: "k" })).status).toBe(404);
    expect((await post(base, "/api/mcp/servers/linear/api-key", { value: "a\nb" })).status).toBe(400);
    expect((await post(base, "/api/mcp/servers/local/api-key", { value: "k" })).status).toBe(400);
    const blocked = await serve({ mcpServers: { linear: { url: "https://x.example/mcp" } } }, persisted, "blocked by policy");
    expect((await post(blocked, "/api/mcp/servers/linear/api-key", { value: "k" })).status).toBe(403);
    expect(persisted).toEqual([]);
  });
});

describe("2.1 inline API key route: header limits (Rex risk a)", () => {
  it("refuses Host, hop-by-hop and non-key headers, and more than 32 headers", async () => {
    const persisted: Array<Record<string, unknown>> = [];
    const many = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`X-H${i}`, "v"]));
    const base = await serve({ mcpServers: { linear: { url: "https://x.example/mcp" }, full: { url: "https://y.example/mcp", headers: many } } }, persisted);
    for (const header of ["Host", "host", "Connection", "Transfer-Encoding", "Upgrade", "Proxy-Authorization", "Keep-Alive", "TE", "Content-Length", "Cookie", "X-Forwarded-Host", "X-Anything", "Bad Header"]) {
      expect((await post(base, "/api/mcp/servers/linear/api-key", { header, value: "k" })).status, header).toBe(400);
    }
    expect((await post(base, "/api/mcp/servers/full/api-key", { header: "X-Api-Key", value: "k" })).status).toBe(400);
    expect(persisted).toEqual([]);
    for (const header of ["Authorization", "X-API-Key", "X-Linear-Token", "Api-Key"]) {
      expect((await post(base, "/api/mcp/servers/linear/api-key", { header, value: "k1" })).status, header).toBe(200);
    }
  });
});
