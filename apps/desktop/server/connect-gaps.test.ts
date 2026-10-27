import { describe, expect, it } from "vitest";
import { connectGapsPrompt, pendingSignInServices } from "./connect-gaps.ts";
import { withoutPendingSignIn } from "./mcp-oauth.ts";
import type { McpServerSpec } from "./contracts.ts";

const servers = {
  notion: { url: "https://mcp.notion.example/mcp", headers: {} },
  drive: { url: "https://drive.example/mcp", headers: {} },
  local: { command: "node", args: ["x.mjs"] },
} as unknown as Record<string, McpServerSpec>;
const manager = { authState: (name: string) => (name === "notion" ? "needs-sign-in" : "signed-in") };

describe("2.2 unsigned services stay visible", () => {
  it("lists exactly the services the tool surface drops", () => {
    const pending = pendingSignInServices(servers, manager);
    expect(pending).toEqual(["notion"]);
    const kept = Object.keys(withoutPendingSignIn(servers, manager as never));
    expect(kept.concat(pending).sort()).toEqual(Object.keys(servers).sort());
  });
  it("renders 'Kết nối dịch vụ X' lines, and nothing when all are connected", () => {
    expect(connectGapsPrompt(["notion"])).toContain("Kết nối dịch vụ notion");
    expect(connectGapsPrompt([])).toBe("");
  });
});
