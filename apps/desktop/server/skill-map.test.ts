import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSkillMap, matchSkills, parseSkillMap, skillHint } from "./skill-map.ts";

const map = loadSkillMap(join(import.meta.dirname, "..", "skills"))!;

describe("1.3 skill-map.json", () => {
  it("ships a valid map", () => {
    expect(map.version).toBe(1);
    expect(map.intents.length).toBeGreaterThanOrEqual(10);
  });
  it("maps a Vietnamese message, with or without diacritics, to an installed skill", () => {
    expect(matchSkills(map, "Viết kịch bản TikTok cho son môi", ["viral-short-form-script"])[0]?.skill).toBe("viral-short-form-script");
    expect(matchSkills(map, "viet kich ban tiktok", ["viral-short-form-script"])[0]?.skill).toBe("viral-short-form-script");
    expect(matchSkills(map, "điều khiển điện thoại android", ["phone-harness"])[0]?.skill).toBe("phone-harness");
  });
  it("never names a skill the bot does not have, and matches whole words only", () => {
    expect(matchSkills(map, "Viết kịch bản TikTok", [])).toEqual([]);
    expect(matchSkills(map, "giaothông", ["shopping"])).toEqual([]);
  });
  it("renders a one-line hint", () => {
    expect(skillHint([{ intent: "voice-over", skill: "elevenlabs-vo", score: 1 }])).toContain('load skill "elevenlabs-vo"');
    expect(skillHint([])).toBe("");
  });
  it("rejects a malformed map", () => {
    expect(() => parseSkillMap({ version: 2, intents: [] })).toThrow();
  });
});
