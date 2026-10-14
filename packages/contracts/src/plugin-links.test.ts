import { describe, expect, it } from "vitest";
import { createInviteUrl } from "./invite-links";
import { createAIKINGBOTPluginUrl, createPluginShareUrl, isPluginUrl, parsePluginUrl } from "./plugin-links";

const invitePayload = {
  apiUrl: "https://studio-mac-k7m4q2pz-host.aikingbot.aikingx.com/",
  serverId: "00000000-0000-4000-8000-000000000000",
  fingerprint: "a".repeat(43),
  token: "b".repeat(43),
};

describe("AIKINGBOT plugin links", () => {
  it("builds both forms from a slug", () => {
    expect(createPluginShareUrl("aave")).toBe("https://aikingbot.aikingx.com/plugins/aave");
    expect(createAIKINGBOTPluginUrl("aave")).toBe("aikingbot://plugins/aave");
  });

  it("reads back the slug it wrote, in either form", () => {
    expect(parsePluginUrl(createPluginShareUrl("linear-triage"))).toBe("linear-triage");
    expect(parsePluginUrl(createAIKINGBOTPluginUrl("linear-triage"))).toBe("linear-triage");
  });

  it("refuses to build a link for a slug it would not read back", () => {
    expect(() => createPluginShareUrl("Aave")).toThrow();
    expect(() => createAIKINGBOTPluginUrl("catalog.json")).toThrow();
  });

  it.each([
    ["a foreign origin", "https://evil.example/plugins/aave"],
    ["a host that only ends in the real one", "https://aikingbot.aikingx.com.example.com/plugins/aave"],
    ["the lookalike host the app once used", "https://aikingbot.app/plugins/aave"],
    ["http", "http://aikingbot.aikingx.com/plugins/aave"],
    ["another path", "https://aikingbot.aikingx.com/other/aave"],
    ["no slug", "https://aikingbot.aikingx.com/plugins/"],
    ["a second path segment", "https://aikingbot.aikingx.com/plugins/aave/install"],
    ["a trailing slash", "https://aikingbot.aikingx.com/plugins/aave/"],
    ["a query", "https://aikingbot.aikingx.com/plugins/aave?install=1"],
    ["a hash", "https://aikingbot.aikingx.com/plugins/aave#install"],
    ["a port", "https://aikingbot.aikingx.com:444/plugins/aave"],
    ["a user name", "https://user@aikingbot.aikingx.com/plugins/aave"],
    ["an upper-case slug", "https://aikingbot.aikingx.com/plugins/Aave"],
    ["a slug with a dot", "https://aikingbot.aikingx.com/plugins/catalog.json"],
    ["an over-long slug", `https://aikingbot.aikingx.com/plugins/${"a".repeat(64)}`],
    ["another custom-scheme host", "aikingbot://plugin/aave"],
    ["a custom-scheme link with a query", "aikingbot://plugins/aave?install=1"],
    ["a custom-scheme link with no slug", "aikingbot://plugins"],
    ["nonsense", "not a url"],
  ])("refuses %s", (_reason, value) => {
    expect(() => parsePluginUrl(value)).toThrow();
    expect(isPluginUrl(value)).toBe(false);
  });

  /* The router asks the invite parser first, but the plugin parser must not claim an invite even on
     its own. `join` is the invite's host and `/join` is its path. */
  it("refuses an invitation link", () => {
    expect(isPluginUrl(createInviteUrl(invitePayload))).toBe(false);
    expect(isPluginUrl("aikingbot://join")).toBe(false);
  });
});
