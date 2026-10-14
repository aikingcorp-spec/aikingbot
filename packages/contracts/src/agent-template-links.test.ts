import { describe, expect, it } from "vitest";
import {
  agentTemplateShareOrigin,
  createAgentTemplateShareUrl,
  createAIKINGBOTAgentTemplateUrl,
  isAgentTemplateShareOrigin,
  parseAgentTemplateUrl,
} from "./agent-template-links";
import { createPluginShareUrl } from "./plugin-links";

const id = "Ab3_-xYz0123456789abcd";

describe("AIKINGBOT agent template links", () => {
  it("reads back the id it wrote, in either form", () => {
    expect(createAgentTemplateShareUrl(id)).toBe(`https://aikingbot.aikingx.com/agents/${id}`);
    expect(createAIKINGBOTAgentTemplateUrl(id)).toBe(`aikingbot://agents/${id}`);
    expect(parseAgentTemplateUrl(createAgentTemplateShareUrl(id))).toBe(id);
    expect(parseAgentTemplateUrl(createAIKINGBOTAgentTemplateUrl(id))).toBe(id);
  });

  it("uses a local Worker in development and aikingbot.aikingx.com otherwise", () => {
    expect(agentTemplateShareOrigin("http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100");
    expect(agentTemplateShareOrigin("https://api.aikingbot.aikingx.com")).toBe("https://aikingbot.aikingx.com");
    expect(createAgentTemplateShareUrl(id, "http://localhost:3100")).toBe(`http://localhost:3100/agents/${id}`);
  });

  it.each([
    "https://evil.example",
    "http://aikingbot.aikingx.com",
    "http://127.0.0.1.evil.example:3100",
    "https://127.0.0.1:3100",
    "http://127.0.0.1:3100/path",
  ])("refuses the share origin %s", (origin) => {
    expect(isAgentTemplateShareOrigin(origin)).toBe(false);
    expect(() => createAgentTemplateShareUrl(id, origin)).toThrow();
  });

  it.each([
    ["a foreign origin", `https://evil.example/agents/${id}`],
    ["a host that only ends in the real one", `https://aikingbot.aikingx.com.example.com/agents/${id}`],
    ["http", `http://aikingbot.aikingx.com/agents/${id}`],
    ["a second path segment", `https://aikingbot.aikingx.com/agents/${id}/install`],
    ["a query", `https://aikingbot.aikingx.com/agents/${id}?install=1`],
    ["a hash", `aikingbot://agents/${id}#install`],
    ["a custom-scheme query", `aikingbot://agents/${id}?install=1`],
    ["a short id", "aikingbot://agents/abc"],
    ["a path in the id", "aikingbot://agents/..%2F..%2Fetc"],
    ["another custom-scheme host", `aikingbot://agent/${id}`],
    ["a plugin link", createPluginShareUrl("aave")],
    ["an invitation", "aikingbot://join"],
  ])("refuses %s", (_reason, value) => {
    expect(() => parseAgentTemplateUrl(value)).toThrow();
  });
});
