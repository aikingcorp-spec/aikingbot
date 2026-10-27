// 1.3: the shipped skill map (intent → skill, with keywords) turns "skills are listed" into "this skill fits this message".
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { foldVietnamese } from "./vi-fold.ts";

const SkillMapSchema = z.object({
  version: z.literal(1),
  description: z.string().optional(),
  intents: z.array(z.object({
    intent: z.string().min(1).max(120),
    skills: z.array(z.string().min(1).max(120)).min(1).max(8),
    keywords: z.array(z.string().min(2).max(60)).min(1).max(24),
  })).max(200),
});
export type SkillMap = z.infer<typeof SkillMapSchema>;

export function parseSkillMap(value: unknown): SkillMap {
  return SkillMapSchema.parse(value);
}

export function loadSkillMap(root = process.env.AIKING_SKILLS_DIR || join(process.cwd(), "skills")): SkillMap | null {
  const file = join(root, "skill-map.json");
  if (!existsSync(file)) return null;
  try {
    return parseSkillMap(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    console.warn(`skill-map.json ignored: ${error instanceof Error ? error.message.slice(0, 200) : "invalid"}`);
    return null;
  }
}

const padded = (text: string) => ` ${foldVietnamese(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

export interface SkillMatch { intent: string; skill: string; score: number }

/** Intents whose keywords appear in the message (folded, whole words), best first, naming only skills the bot has. */
export function matchSkills(map: SkillMap, message: string, available: Iterable<string>, limit = 2): SkillMatch[] {
  const have = new Set([...available].map((name) => name.toLowerCase()));
  const text = padded(message);
  const out: SkillMatch[] = [];
  for (const entry of map.intents) {
    const score = entry.keywords.filter((keyword) => text.includes(padded(keyword))).length;
    if (!score) continue;
    const skill = entry.skills.find((name) => have.has(name.toLowerCase()));
    if (skill && !out.some((match) => match.skill === skill)) out.push({ intent: entry.intent, skill, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function skillHint(matches: readonly SkillMatch[]): string {
  if (!matches.length) return "";
  return `[skill map] This message looks like: ${matches.map((match) => `${match.intent} → load skill "${match.skill}" before you start`).join("; ")}.`;
}
