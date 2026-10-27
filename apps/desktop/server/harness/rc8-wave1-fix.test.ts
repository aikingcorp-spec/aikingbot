// Rex Wave 1 fixes: F1 caps hold for a whole turn with the real catalog and system prompt, F2 the ladder climbs on
// refusals, F4 an oversized first memory line is truncated rather than dropped.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDENTIAL_PROMPT, ROUTINE_PROMPT, PROFILE_PROMPT, TEAM_MEMORY_PROMPT, computerPrompt } from "../system-prompt.ts";
import { memoryCore } from "../workspace.ts";
import { CLIMBING_KINDS, classifyToolError } from "./error-ladder.ts";
import { TIER_TOOL_CAPS } from "./model-profile.ts";
import { PROMPT_BUDGET_TOKENS, estimateTokens, measurePromptBudget } from "./prompt-budget.ts";
import { ToolRouter, type RoutedDefinition } from "./tool-router.ts";

const golden = JSON.parse(readFileSync(new URL("../drivers/agents-catalog-goldens/full.tools-list.json", import.meta.url), "utf8"));
const defs: RoutedDefinition[] = golden.tools.map((t: { name: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
  type: "function", function: { name: `agents_${t.name}`.toLowerCase(), description: t.description ?? "", parameters: t.inputSchema ?? { type: "object" } },
}));
const memory = memoryCore("Sự thật quan trọng về người dùng. ".repeat(400));
const system = ["Bạn là trợ lý AIKINGBOT.", CREDENTIAL_PROMPT, ROUTINE_PROMPT, PROFILE_PROMPT, TEAM_MEMORY_PROMPT, computerPrompt("local" as never), memory.text].join("\n");
const queries = ["gửi tin nhắn cho bot khác", "đặt lịch routine", "kết nối gmail", "ghi nhớ", "tìm skill", "máy ảo", "tệp đính kèm", "phòng nhóm"];

describe("F1 tool caps over a whole turn", () => {
  it.each(Object.entries(TIER_TOOL_CAPS))("%s tier stays within its cap and 8k across 8 searches", async (tier, cap) => {
    // Same ceiling the runtime passes (openai-chat.ts): what the system prompt leaves of the 8k budget.
    const router = new ToolRouter(defs, cap, { maxToolTokens: Math.max(0, PROMPT_BUDGET_TOKENS - estimateTokens(system)) });
    const rows = [measurePromptBudget(system, router.visible())];
    for (const query of queries) { await router.search({ query }); rows.push(measurePromptBudget(system, router.visible())); }
    for (const row of rows) {
      expect(row.toolCount).toBeLessThanOrEqual(cap);
      expect(row.totalTokens).toBeLessThanOrEqual(PROMPT_BUDGET_TOKENS);
    }
    expect(router.evicted().length).toBeGreaterThan(0);
    const dir = process.env.AIKING_EVIDENCE_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `f1-budget-${tier}.json`), JSON.stringify({ tier, cap, catalog: defs.length, rows: rows.map((r) => [r.toolCount, r.totalTokens]), evicted: router.evicted() }, null, 1));
    }
  });
});

describe("F2 ladder climbs on refusals", () => {
  // Rex's eight cases (rex-ladder.test.ts) verbatim.
  it.each([
    "Gmail is not connected for this account", "401 Unauthorized: sign in required", "Permission denied: backend refused the request",
    "403 Forbidden", "Tool not found: slack_send", "The backend rejected this action", "Error: this connector does not support webhooks",
    "User denied the request",
  ])("%s", (text) => {
    const typed = classifyToolError("agents_send", text);
    expect(typed).toBeDefined();
    expect(CLIMBING_KINDS).toContain(typed!.kind);
    expect(typed!.recoverable).toBe(true);
    expect(typed!.next).toBeTruthy();
  });
});

describe("F4 memory first line", () => {
  it("truncates an oversized first line instead of returning nothing", () => {
    const core = memoryCore("x".repeat(2000));
    expect(core.text.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(core.text)).toBeLessThanOrEqual(1536);
    const viet = memoryCore("ệ".repeat(1000));
    expect(viet.text).not.toContain("\uFFFD");
    expect(viet.text.length).toBeGreaterThan(0);
  });
});
