// Copyright (c) 2026 AIKING.
// The plan an agent works through in one turn, as the server stores it and the Tasks checklist shows it. Each engine has its
// own plan tool (Claude TodoWrite and the task tools, Codex update_plan, the ACP `plan` update); the server maps all of them
// to this one shape, and every update holds the full list. The shape follows OpenBot's ConversationPlan contract.

export const CONVERSATION_PLAN_STATUSES = ["pending", "inProgress", "completed"] as const;
export type ConversationPlanStatus = (typeof CONVERSATION_PLAN_STATUSES)[number];

export interface ConversationPlanStep {
  id: string;
  text: string;
  /** The present-tense form an engine shows while the step runs, such as "Running the tests". */
  activeText?: string;
  status: ConversationPlanStatus;
}

export interface ConversationPlan {
  explanation: string | null;
  steps: ConversationPlanStep[];
}

export const CONVERSATION_PLAN_STEP_LIMIT = 100;
export const CONVERSATION_PLAN_TEXT_LIMIT = 500;

function clampText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, CONVERSATION_PLAN_TEXT_LIMIT) : "";
}

export function isPlanStatus(value: unknown): value is ConversationPlanStatus {
  return typeof value === "string" && (CONVERSATION_PLAN_STATUSES as readonly string[]).includes(value);
}

/** The plan inside the stored bounds, with blank steps and duplicate ids repaired. Null when no step is left. */
export function clampConversationPlan(plan: { explanation?: unknown; steps: ReadonlyArray<{ id?: unknown; text?: unknown; activeText?: unknown; status?: unknown }> }): ConversationPlan | null {
  const steps: ConversationPlanStep[] = [];
  const ids = new Set<string>();
  for (const step of plan.steps) {
    if (steps.length >= CONVERSATION_PLAN_STEP_LIMIT) break;
    const text = clampText(step.text);
    if (!text) continue;
    let id = clampText(step.id).slice(0, 64);
    if (!id || ids.has(id)) id = `step-${steps.length}`;
    ids.add(id);
    const activeText = clampText(step.activeText);
    steps.push({ id, text, ...(activeText ? { activeText } : {}), status: isPlanStatus(step.status) ? step.status : "pending" });
  }
  if (!steps.length) return null;
  const explanation = clampText(plan.explanation);
  return { explanation: explanation || null, steps };
}

/** The plan as a markdown checklist: the message text, so a client that does not know plans still shows a readable list. */
export function conversationPlanText(plan: ConversationPlan): string {
  const lines = plan.steps.map((step) => `- [${step.status === "completed" ? "x" : " "}] ${step.text}`);
  return plan.explanation ? `${plan.explanation}\n\n${lines.join("\n")}` : lines.join("\n");
}

export function planProgress(plan: ConversationPlan): { done: number; total: number; active: ConversationPlanStep | null; complete: boolean } {
  const done = plan.steps.filter((step) => step.status === "completed").length;
  const active = plan.steps.find((step) => step.status === "inProgress") ?? null;
  return { done, total: plan.steps.length, active, complete: plan.steps.length > 0 && done === plan.steps.length };
}

/** A turn that ended can no longer be working on a step: what was running stops showing as running. */
export function settlePlan(plan: ConversationPlan): ConversationPlan {
  if (!plan.steps.some((step) => step.status === "inProgress")) return plan;
  return { ...plan, steps: plan.steps.map((step) => (step.status === "inProgress" ? { ...step, status: "pending" as const } : step)) };
}
