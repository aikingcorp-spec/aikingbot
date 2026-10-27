import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LADDER, classifyToolError, ladderNote } from "./error-ladder.ts";
import { TIER_TOOL_CAPS, modelProfile, tierFor } from "./model-profile.ts";
import { PROMPT_BUDGET_TOKENS, budgetReport, measurePromptBudget } from "./prompt-budget.ts";
import { FailoverPool, QuotaExhaustedError, isQuotaError, voiceTurn } from "./quota-failover.ts";
import { HARNESS_SEARCH_TOOL, ToolRouter, type RoutedDefinition } from "./tool-router.ts";
import { createVerifyState, effectOf, observeTool, owesReadBack, verifyReport } from "./verify-after-act.ts";

const golden = JSON.parse(readFileSync(new URL("../drivers/agents-catalog-goldens/full.tools-list.json", import.meta.url), "utf8")) as { tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
const definitions: RoutedDefinition[] = golden.tools.map((tool) => ({ type: "function", function: { name: `agents_${tool.name}`.toLowerCase(), description: tool.description ?? "", parameters: tool.inputSchema ?? { type: "object" } } }));
const extra: RoutedDefinition[] = ["ask_user", "browser_browser_navigate", "browser_browser_snapshot", "computer_screenshot", "composio_search_tools", "memory_update"].map((name) => ({ type: "function", function: { name, description: `${name} tool`, parameters: { type: "object" } } }));
const all = [...extra, ...definitions];

const SYSTEM = "Bạn là trợ lý AIKINGBOT. Trả lời bằng tiếng Việt, ngắn gọn. ".repeat(40);
const TASKS_VI = [
  "Gửi email cho anh Nam về cuộc họp", "Tìm lại ghi chú hôm qua", "Đặt lịch nhắc uống nước mỗi sáng", "Kết nối Gmail",
  "Mở trình duyệt và đọc tin tức", "Chụp màn hình máy tính", "Đính kèm tệp báo cáo", "Nhớ rằng tôi thích cà phê đen",
  "Tạo phòng nhóm cho dự án", "Cài skill dịch thuật", "Đăng nhập Notion", "Tìm công cụ gửi tin Slack",
  "Lên lịch họp thứ Hai", "Tóm tắt tài liệu", "Kiểm tra máy ảo", "Gửi tin cho bot khác",
  "Tìm chuyến bay đi Đà Nẵng", "Xóa routine cũ", "Liệt kê các bot", "Hỏi lại người dùng về ngân sách",
];

describe("1.1 prompt budget on a 20-task Vietnamese set", () => {
  it("keeps system + listed tools ≤ 8k tokens for every task at every tier", async () => {
    const rows = [];
    for (const tier of ["small", "medium", "large"] as const) {
      for (const task of TASKS_VI) {
        const router = new ToolRouter(all, TIER_TOOL_CAPS[tier]);
        await router.search({ query: task, limit: 3 });
        rows.push({ task: `${tier}:${task}`, ...measurePromptBudget(SYSTEM, router.visible()) });
      }
    }
    const report = budgetReport(rows);
    const unrouted = measurePromptBudget(SYSTEM, all);
    // Evidence only when asked for (AIKING_EVIDENCE_DIR); a test never writes to a fixed machine path.
    const evidenceDir = process.env.AIKING_EVIDENCE_DIR;
    if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
    if (evidenceDir) writeFileSync(`${evidenceDir}/1.1-prompt-budget.json`, JSON.stringify({ budget: PROMPT_BUDGET_TOKENS, toolsTotal: all.length, unrouted, report, rows }, null, 2));
    expect(rows).toHaveLength(60);
    expect(report.overBudget).toEqual([]);
    expect(report.max).toBeLessThanOrEqual(PROMPT_BUDGET_TOKENS);
  });
});

describe("1.2 / 1.7 core tools and tier caps", () => {
  it("caps the listed core at 6/8/12 and always offers search_tools", () => {
    for (const [tier, cap] of Object.entries(TIER_TOOL_CAPS)) {
      const router = new ToolRouter(all, cap);
      expect(router.routed, tier).toBe(true);
      expect(router.visible().length).toBeLessThanOrEqual(cap);
      expect(router.visible()[0]!.function.name).toBe(HARNESS_SEARCH_TOOL);
    }
    expect(new ToolRouter(all, TIER_TOOL_CAPS.medium).visible().map((d) => d.function.name)).toContain("ask_user");
  });
  it("does not route when the catalog already fits", () => {
    const router = new ToolRouter(extra, 12);
    expect(router.routed).toBe(false);
    expect(router.visible()).toHaveLength(extra.length);
  });
  it("search enables hits, appended after the stable core", async () => {
    const router = new ToolRouter(all, 6);
    const before = router.visible().map((d) => d.function.name);
    const result = await router.search({ query: "gửi tin nhắn cho bot khác" });
    expect(result.ok).toBe(true);
    const after = router.visible().map((d) => d.function.name);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.length).toBeGreaterThan(before.length);
  });
  it("tiers from catalog, name and context window", () => {
    expect(tierFor("x", [{ id: "x", tier: "large" }])).toBe("large");
    expect(tierFor("tiny", [{ id: "tiny", contextWindow: 8000 }])).toBe("small");
    expect(modelProfile("llama-3.1-8b-instant").maxTools).toBe(6);
  });
});

describe("1.4 error ladder: 5 scripted denials each climb at least one rung", () => {
  const script: Array<[string, string]> = [
    ["session_search", "Record not found for this request"],
    ["composio_multi_execute", "Gmail is not connected: connect an account first"],
    ["marketplace_search", "No such skill or server was found"],
    ["web_search", "This site is not supported"],
    ["browser_browser_navigate", "Sign-in required to continue"],
  ];
  it.each(script)("%s → climbs", (tool, text) => {
    const typed = classifyToolError(tool, text);
    expect(typed.recoverable).toBe(true);
    const from = ["session_search", "composio_multi_execute", "marketplace_search", "web_search", "browser_browser_navigate"].indexOf(tool);
    expect(LADDER.indexOf(typed.next!)).toBeGreaterThanOrEqual(from + 1);
    expect(ladderNote(typed)).toContain("Next step");
  });
  // Was recoverable:false (turn just failed). Rex F2: a person's denial must still move the turn forward, so it now goes
  // straight to ask_user; it never reaches another connector/web/browser route, which is what this test guards.
  it("never climbs around a person's denial", () => {
    const typed = classifyToolError("composio_multi_execute", "Permission denied by the owner");
    expect(typed.kind).toBe("denied");
    expect(typed.next).toBe("ask_user");
  });
});

describe("1.8 verify after act", () => {
  it("owes a read-back after an act until a read follows", () => {
    const state = createVerifyState();
    expect(effectOf("gmail_send_email")).toBe("act");
    observeTool(state, "gmail_send_email", true);
    expect(owesReadBack(state)).toBe(true);
    observeTool(state, "gmail_list_messages", true);
    expect(owesReadBack(state)).toBe(false);
    expect(verifyReport(state)).toMatchObject({ acted: 1, verified: true });
  });
});

describe("1.12 quota-only failover", () => {
  it("fails over on quota only and stays on the new account", async () => {
    const notices: string[] = [];
    const pool = new FailoverPool("tts", [{ id: "a" }, { id: "b" }], (n) => notices.push(n.message));
    const seen: string[] = [];
    await pool.run(async (account) => { seen.push(account.id); if (account.id === "a") throw Object.assign(new Error("quota exceeded"), { status: 402 }); return 1; });
    await pool.run(async (account) => { seen.push(account.id); return 1; });
    expect(seen).toEqual(["a", "b", "b"]);
    expect(notices).toHaveLength(1);
    await expect(pool.run(async () => { throw new Error("rate limit, try again in a moment"); })).rejects.toThrow("rate limit");
    expect(pool.current()!.id).toBe("b");
    await expect(new FailoverPool("llm", [{ id: "x" }]).run(async () => { throw new Error("insufficient_quota"); })).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(isQuotaError(new Error("429 rate limit"))).toBe(false);
  });
  it("realtime falls back to STT→LLM→TTS and stays there", async () => {
    const state = { realtimeExhausted: false };
    let realtimeCalls = 0;
    const realtime = async () => { realtimeCalls += 1; throw new Error("out of credits"); };
    const pipeline = { stt: async (i: string) => `heard ${i}`, llm: async (t: string) => `reply ${t}`, tts: async (t: string) => `audio ${t}` };
    expect((await voiceTurn("hi", state, realtime, pipeline)).via).toBe("pipeline");
    expect((await voiceTurn("again", state, realtime, pipeline)).via).toBe("pipeline");
    expect(realtimeCalls).toBe(1);
  });
});
