import { describe, expect, it } from "vitest";
import { mcpCardConnected, planConnect, withApiKey } from "./request-connect.ts";

const servers = {
  notion: { type: "http", url: "https://mcp.notion.example/mcp", headers: {} },
  linear: { type: "http", url: "https://mcp.linear.example/mcp", headers: {} },
  keyed: { type: "http", url: "https://keyed.example/mcp", headers: { Authorization: "Bearer x" } },
  local: { command: "node", args: [], env: {} },
};
const states: Record<string, string> = { notion: "needs-sign-in", linear: "none", keyed: "none" };
const authState = (name: string) => states[name] ?? "none";

describe("2.1 request_connect plan", () => {
  it("offers OAuth for a service that needs sign-in, and an inline API key otherwise", () => {
    expect(planConnect("Notion", servers, authState)).toEqual({ card: { server: "notion", auth: "oauth", header: "Authorization" } });
    expect(planConnect("linear", servers, authState)).toEqual({ card: { server: "linear", auth: "api-key", header: "Authorization" } });
    expect(planConnect("linear", servers, authState, "X-Api-Key")).toEqual({ card: { server: "linear", auth: "api-key", header: "X-Api-Key" } });
  });
  it("does not ask again when the service is usable, and never points at Settings", () => {
    expect(planConnect("keyed", servers, authState)).toEqual({ connected: true, server: "keyed" });
    const missing = planConnect("jira", servers, authState);
    expect("error" in missing && missing.error).toMatch(/marketplace_search/);
    expect("error" in missing && missing.error).not.toMatch(/Settings/);
    expect(planConnect("local", servers, authState)).toHaveProperty("error");
    expect(planConnect("../x", servers, authState)).toHaveProperty("error");
  });
  it("stores the key as a header without dropping other fields, and reports the card connected", () => {
    const stored = { type: "http", url: "https://mcp.linear.example/mcp", enabled: true, headers: { authorization: "old" } };
    const next = withApiKey(stored, "Authorization", "  lin_secret ");
    expect(next).toEqual({ server: { type: "http", url: stored.url, enabled: true, headers: { Authorization: "Bearer lin_secret" } } });
    expect(withApiKey(stored, "Authorization", "Token abc")).toMatchObject({ server: { headers: { Authorization: "Token abc" } } });
    expect(withApiKey(stored, "Authorization", "a\nb")).toHaveProperty("error");
    expect(withApiKey({ command: "x" }, "Authorization", "k")).toHaveProperty("error");
    const card = { server: "linear", auth: "api-key" as const, header: "Authorization" };
    expect(mcpCardConnected(card, stored, authState)).toBe(true);
    expect(mcpCardConnected(card, servers.linear, authState)).toBe(false);
    states.notion = "signed-in";
    expect(mcpCardConnected({ server: "notion", auth: "oauth", header: "Authorization" }, servers.notion, authState)).toBe(true);
  });
});
