import { describe, expect, it } from "vitest";
import { composeEnvelope, composeReport } from "./envelope.ts";
import { CONTRACT_LINE, isResearchBrief, parseSubagentReport } from "./subagent-contract.ts";
import type { Assignment } from "./types.ts";

const base: Assignment = {
  id: "as_1", rootId: "as_root", parentId: "as_root", depth: 1,
  origin: { kind: "person", source: "chat", ref: "th_1", quote: "q" },
  requester: { kind: "bot_turn", botId: "chief", threadId: "th_1", chief: true },
  assignee: { botId: "scout", destination: { kind: "work_thread", threadId: "th_2" } },
  mode: "work", reply: "resume", brief: "Tra cứu giá vé máy bay Hà Nội – Đà Nẵng tuần sau.",
  status: "completed", level: "auto", levelSource: "chief", executions: 1, restarts: 0,
  createdAt: 0, lastActivityAt: 0, result: "", rework: false, version: 1,
};
const names = { requester: "Chief", assignee: "Scout", person: "Khoa" };
const good = 'Xong.\n```subagent-report\n{"summary":"Rẻ nhất 890k","evidence":["https://example.test/fare"],"artifacts":[],"open_questions":["Hành lý?"]}\n```';

describe("subagent report contract (1.5)", () => {
  it("detects research briefs in Vietnamese with or without diacritics, and not other work", () => {
    expect(isResearchBrief(base.brief)).toBe(true);
    expect(isResearchBrief("tim kiem khach san")).toBe(true);
    expect(isResearchBrief("Add a CSV export and push the branch.")).toBe(false);
  });
  it("asks the helper for the fixed shape on research jobs only", () => {
    expect(composeEnvelope(base, names)).toContain(CONTRACT_LINE);
    expect(composeEnvelope({ ...base, brief: "Fix the CSV export" }, names)).not.toContain(CONTRACT_LINE);
    expect(composeEnvelope({ ...base, mode: "consult" }, names)).not.toContain(CONTRACT_LINE);
  });
  it("validates the report and surfaces its four parts to the lead bot", () => {
    const check = parseSubagentReport(good);
    expect(check.ok && check.report.open_questions).toEqual(["Hành lý?"]);
    const report = composeReport({ ...base, result: good }, names);
    expect(report).toContain('Contract report: "Rẻ nhất 890k"');
    expect(report).toContain('Open questions: "Hành lý?"');
  });
  it("flags a helper that broke the contract instead of trusting it", () => {
    expect(parseSubagentReport("just prose")).toEqual({ ok: false, problem: "no subagent-report block" });
    expect(parseSubagentReport("```subagent-report\n{bad\n```")).toMatchObject({ ok: false, problem: "the block is not valid JSON" });
    expect(parseSubagentReport('```subagent-report\n{"summary":"x","evidence":[]}\n```')).toMatchObject({ ok: false, problem: "missing or wrong fields: artifacts, open_questions" });
    expect(composeReport({ ...base, result: "just prose" }, names)).toContain("did not follow the report contract");
  });
});
