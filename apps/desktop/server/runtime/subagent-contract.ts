// 1.5: a research/web helper always reports back in one fixed shape, so the lead bot gets a short result, not a transcript.
import { z } from "zod";
import { foldVietnamese } from "../vi-fold.ts";

export const subagentReportSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  evidence: z.array(z.string().trim().min(1).max(500)).max(20),
  artifacts: z.array(z.string().trim().min(1).max(300)).max(20),
  open_questions: z.array(z.string().trim().min(1).max(500)).max(10),
}).strict();
export type SubagentReport = z.infer<typeof subagentReportSchema>;

const RESEARCH = /\b(tra cuu|tim kiem|tim hieu|nghien cuu|luot web|research|look up|search|find out|browse|investigate)\b/;
/** Wave 1 scope: research and web lookups only. */
export function isResearchBrief(brief: string): boolean {
  return RESEARCH.test(foldVietnamese(brief.toLowerCase()));
}

export const REPORT_FENCE = "subagent-report";
export const CONTRACT_LINE = `This is a research job. End your reply with one fenced \`\`\`${REPORT_FENCE} block holding JSON {"summary": string, "evidence": [source URLs or quotes], "artifacts": [files you created], "open_questions": [what stays unknown]} and nothing long outside it.`;

export type ContractCheck = { ok: true; report: SubagentReport } | { ok: false; problem: string };

export function parseSubagentReport(text: string): ContractCheck {
  const match = new RegExp("```" + REPORT_FENCE + "\\s*([\\s\\S]*?)```").exec(text);
  if (!match) return { ok: false, problem: `no ${REPORT_FENCE} block` };
  let raw: unknown;
  try { raw = JSON.parse(match[1]!); } catch { return { ok: false, problem: "the block is not valid JSON" }; }
  const parsed = subagentReportSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: `missing or wrong fields: ${[...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "root")))].join(", ")}` };
  return { ok: true, report: parsed.data };
}

/** The line the lead bot sees in place of free text when the contract holds. */
export function contractReportLine(check: ContractCheck): string {
  if (!check.ok) return `The helper did not follow the report contract (${check.problem}); treat its text as unstructured and verify before use.`;
  const { report } = check;
  const list = (items: string[]) => items.length ? items.map((item) => JSON.stringify(item)).join("; ") : "none";
  return [`Contract report: ${JSON.stringify(report.summary)}`, `Evidence: ${list(report.evidence)}`, `Artifacts: ${list(report.artifacts)}`, `Open questions: ${list(report.open_questions)}`].join("\n");
}
