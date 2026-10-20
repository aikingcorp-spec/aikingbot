import { describe, expect, it } from "vitest";
import { buildVoiceBrief } from "./voice-brief.ts";

const base = { botName: "Mira", now: Date.UTC(2026, 9, 20, 3, 0), timeZone: "Asia/Ho_Chi_Minh", recent: [] };

describe("buildVoiceBrief", () => {
  it("tells the voice who it is, who it works for and the date", () => {
    const text = buildVoiceBrief({ ...base, userName: "Tony", soul: "Calm and brief.", title: "Content lead" });
    expect(text).toContain("Tony");
    expect(text).toContain("Calm and brief.");
    expect(text).toContain("Content lead");
    expect(text).toContain("20 October 2026");
  });
  it("keeps only the latest eight lines of the conversation, trimmed", () => {
    const recent = Array.from({ length: 12 }, (_, n) => ({ who: n % 2 ? "agent" as const : "person" as const, text: `line ${n} ${"x".repeat(500)}` }));
    const text = buildVoiceBrief({ ...base, userName: "Tony", recent });
    expect(text).not.toContain("line 3 ");
    expect(text).toContain("line 11 ");
    expect(text.length).toBeLessThanOrEqual(4500);
  });
  it("works for an agent with nothing yet", () => {
    expect(buildVoiceBrief(base)).toContain("the person");
  });
});
