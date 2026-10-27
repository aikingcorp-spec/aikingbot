// 1.1: what the model is sent before the conversation — system prompt and tool definitions — measured per turn.
export const PROMPT_BUDGET_TOKENS = 8_000;

/** A provider-free estimate: about four UTF-8 bytes per token, which over-counts Vietnamese slightly (safe side). */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

export interface PromptBudget {
  systemTokens: number;
  toolTokens: number;
  toolCount: number;
  totalTokens: number;
  withinBudget: boolean;
}

export function measurePromptBudget(system: string, tools: readonly unknown[], budget = PROMPT_BUDGET_TOKENS): PromptBudget {
  const systemTokens = estimateTokens(system);
  const toolTokens = tools.length ? estimateTokens(JSON.stringify(tools)) : 0;
  const totalTokens = systemTokens + toolTokens;
  return { systemTokens, toolTokens, toolCount: tools.length, totalTokens, withinBudget: totalTokens <= budget };
}

export interface BudgetReportRow extends PromptBudget { task: string }

export function budgetReport(rows: readonly BudgetReportRow[], budget = PROMPT_BUDGET_TOKENS) {
  const totals = rows.map((row) => row.totalTokens).sort((a, b) => a - b);
  const pick = (q: number) => totals.length ? totals[Math.min(totals.length - 1, Math.floor(q * totals.length))] : 0;
  return {
    tasks: rows.length,
    budget,
    max: totals.at(-1) ?? 0,
    p50: pick(0.5),
    mean: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0,
    overBudget: rows.filter((row) => !row.withinBudget).map((row) => row.task),
  };
}
