// 1.7: one profile per model, mapped from the model catalog: the tier decides how many tools a turn lists and how much help a weak model gets.
export type ModelTier = "small" | "medium" | "large";

export interface ModelProfile {
  tier: ModelTier;
  /** The most tool definitions a turn lists up front; everything else is behind search_tools. */
  maxTools: number;
  /** Small models announce a step and stop; they get the one-shot nudge. */
  nudgeAnnouncedAction: boolean;
  /** Small models skip step-by-step plans in the prompt. */
  shortPrompt: boolean;
}

export const TIER_TOOL_CAPS: Readonly<Record<ModelTier, number>> = { small: 6, medium: 8, large: 12 };

export interface CatalogEntry { id: string; contextWindow?: number; tier?: ModelTier }

const SMALL = [/(?:^|[^a-z0-9])(?:0\.5|1|1\.5|2|3|4|7|8|9|11|12|14)b(?:$|[^a-z0-9])/, /\bmini\b/, /\bnano\b/, /\bhaiku\b/, /flash-lite/, /\bsmall\b/, /\btiny\b/, /\bgemma\b/, /\bphi-?\d/, /\binstant\b/];
const LARGE = [/\bopus\b/, /\bsonnet\b/, /^gpt-5(?:\.\d+)?(?:$|-(?!mini|nano))/, /\bgpt-4\.1(?!-mini|-nano)/, /\bo3\b(?!-mini)/, /\bgrok-4/, /deepseek-(?:r1|v3)/, /\b(?:70|72|120|235|405|480|671)b\b/, /gemini-[0-9.]+-pro/, /\bkimi-k2/, /\bglm-4\.[5-9](?!-air)/, /\bqwen3-coder(?!-flash)/];

/** Catalog first (an explicit tier, then the context window), then the model id. Unknown is medium. */
export function tierFor(model: string, catalog?: readonly CatalogEntry[]): ModelTier {
  const entry = catalog?.find((option) => option.id === model);
  if (entry?.tier) return entry.tier;
  const id = model.toLowerCase().split("/").pop() ?? "";
  if (SMALL.some((pattern) => pattern.test(id))) return "small";
  if (LARGE.some((pattern) => pattern.test(id))) return "large";
  if (entry?.contextWindow !== undefined && entry.contextWindow > 0 && entry.contextWindow < 32_000) return "small";
  return "medium";
}

export function modelProfile(model: string, catalog?: readonly CatalogEntry[]): ModelProfile {
  const tier = tierFor(model, catalog);
  return { tier, maxTools: TIER_TOOL_CAPS[tier], nudgeAnnouncedAction: tier === "small", shortPrompt: tier === "small" };
}
