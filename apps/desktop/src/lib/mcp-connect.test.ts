import { describe, expect, it, vi } from "vitest";
import { saveMcpApiKey, startMcpOAuth, type ApiCall } from "./mcp-connect";

const status = "/api/bots/b1/connector-cards/m1/status?threadId=t1";

describe("2.1 request_connect card (mocked network)", () => {
  it("OAuth: the click starts sign-in in the person's own session and opens the returned page", async () => {
    const call = vi.fn<ApiCall>(async (path) => path.endsWith("/sign-in") ? { auth: { phase: "authorizing", authorizationUrl: "https://idp.example/authorize?x=1" } } : { connected: false, pending: true });
    const url = await startMcpOAuth(call, { server: "notion", auth: "oauth", header: "Authorization" }, status);
    expect(url).toBe("https://idp.example/authorize?x=1");
    expect(call.mock.calls.map(([path, init]) => [path, init?.method])).toEqual([
      ["/api/mcp/servers/notion/sign-in", "POST"],
      [`${status}&started=1`, undefined],
    ]);
    expect(call.mock.calls.some(([path]) => path.includes("settings"))).toBe(false);
  });
  it("OAuth: no sign-in page is an error, not a silent success", async () => {
    const call = vi.fn<ApiCall>(async () => ({ auth: { phase: "failed" } }));
    await expect(startMcpOAuth(call, { server: "notion", auth: "oauth", header: "Authorization" }, status)).rejects.toThrow(/sign-in page/);
  });
  it("API key: the inline form posts the key once to the server's header and reads the card status", async () => {
    const call = vi.fn<ApiCall>(async (path) => path.endsWith("/api-key") ? { ok: true } : { connected: true });
    expect(await saveMcpApiKey(call, { server: "linear", auth: "api-key", header: "X-Api-Key" }, "  lin_123 ", status)).toBe(true);
    expect(call.mock.calls[0]).toEqual(["/api/mcp/servers/linear/api-key", { method: "POST", body: JSON.stringify({ header: "X-Api-Key", value: "lin_123" }) }]);
    expect(call.mock.calls[1]).toEqual([status]);
    await expect(saveMcpApiKey(call, { server: "linear", auth: "api-key", header: "X-Api-Key" }, " ", status)).rejects.toThrow();
  });
});
