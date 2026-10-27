import { describe, expect, it } from "vitest";
import { accountCapabilities, capabilitiesForJob, engineRosterPrompt, routeByCapability } from "./engine-capabilities.ts";

describe("engine capabilities (1.6 / 3.4)", () => {
  it("declares per driver and applies the account override and app surfaces", () => {
    expect(accountCapabilities("codex")).toContain("image_generate");
    expect(accountCapabilities("mistral")).toEqual(["text", "tools"]);
    expect(accountCapabilities("unknown-driver")).toEqual(["text"]);
    const caps = accountCapabilities("mistral", { add: ["voice", "bogus"], remove: ["tools"] }, { browser: true, computer: true });
    expect(caps).toEqual(["text", "web_browse", "computer_use", "voice"]);
  });
  it("routes to the most specialised teammate that has every needed capability", () => {
    const mates = [
      { id: "a", name: "Grok", capabilities: accountCapabilities("grok") },
      { id: "b", name: "Codex", capabilities: accountCapabilities("codex") },
      { id: "c", name: "Mistral", capabilities: accountCapabilities("mistral") },
    ];
    expect(routeByCapability(["video_generate"], mates).map((m) => m.id)).toEqual(["a"]);
    expect(routeByCapability(["image_generate"], mates).map((m) => m.id)).toEqual(["b", "a"]);
    expect(routeByCapability(["computer_use"], mates)).toEqual([]);
    expect(capabilitiesForJob("tao video quang cao")).toEqual(["video_generate"]);
    expect(engineRosterPrompt(mates)).toContain("- Grok (a): text, tools, web_search");
    expect(engineRosterPrompt([])).toBe("");
  });
});
