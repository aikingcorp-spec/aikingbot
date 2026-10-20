// Copyright (c) 2026 AIKING.
// Maps each engine's own plan tool to one ConversationPlan. Reference: OpenBot src/backend/agent/plan-updates.ts.
//  - Codex app-server: `turn/plan/updated` { threadId, turnId, explanation?, plan: [{ step, status }] } (the full list)
//  - Claude Code: `TodoWrite` sends the full list; `TaskCreate`/`TaskUpdate` change one task, so the list is folded here
//  - ACP agents: the `plan` session update { entries: [{ content, status, priority }] } (the full list)
import { clampConversationPlan, type ConversationPlan, type ConversationPlanStatus } from "../shared/conversation-plan.ts";

export interface PlanUpdateStep {
  step: string;
  status: ConversationPlanStatus;
  activeText?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const isString = (value: unknown): value is string => typeof value === "string";

/** Codex writes `inProgress`; Claude and ACP write `in_progress`. Anything else is not started. */
export function planStepStatus(value: unknown): ConversationPlanStatus {
  if (value === "completed") return "completed";
  if (value === "inProgress" || value === "in_progress") return "inProgress";
  return "pending";
}

export function planFromSteps(steps: readonly PlanUpdateStep[], explanation: string | null = null): ConversationPlan | null {
  return clampConversationPlan({
    explanation,
    steps: steps.map((entry, index) => ({ id: String(index), text: entry.step, status: entry.status, activeText: entry.activeText })),
  });
}

export type PlanNotification = { kind: "plan"; plan: ConversationPlan } | { kind: "cleared" } | null;

/** The plan in a Codex `turn/plan/updated` notification. An empty list clears the turn's plan. */
export function planFromCodexNotification(params: unknown): PlanNotification {
  if (!isRecord(params) || !Array.isArray(params.plan)) return null;
  const steps = params.plan.flatMap((entry): PlanUpdateStep[] => {
    if (!isRecord(entry) || !isString(entry.step)) return [];
    return [{ step: entry.step, status: planStepStatus(entry.status), ...(isString(entry.activeText) ? { activeText: entry.activeText } : {}) }];
  });
  const plan = planFromSteps(steps, isString(params.explanation) ? params.explanation : null);
  return plan ? { kind: "plan", plan } : { kind: "cleared" };
}

/** The plan of an ACP `plan` session update; ACP has a priority per entry, which is not shown. */
export function planFromAcpUpdate(update: unknown): PlanNotification {
  if (!isRecord(update) || !Array.isArray(update.entries)) return null;
  const steps = update.entries.flatMap((entry): PlanUpdateStep[] =>
    isRecord(entry) && isString(entry.content) ? [{ step: entry.content, status: planStepStatus(entry.status) }] : []);
  const plan = planFromSteps(steps);
  return plan ? { kind: "plan", plan } : { kind: "cleared" };
}

/**
 * The plan Claude keeps with its own tools. The state lives with the Claude session, because a task made in one turn can be
 * updated in the next.
 */
export interface ClaudePlanState {
  steps: Map<string, PlanUpdateStep>;
  /** A `TaskCreate` call waits for its result, which names the task id, under its tool-use id. */
  creates: Set<string>;
  turnId?: string;
}

export function newClaudePlanState(): ClaudePlanState {
  return { steps: new Map(), creates: new Set() };
}

/** A new turn shows only the tasks that are still open; finished ones belong to earlier turns. */
export function startClaudePlanTurn(state: ClaudePlanState, turnId: string): void {
  if (state.turnId === turnId) return;
  state.turnId = turnId;
  for (const [id, step] of state.steps) if (step.status === "completed") state.steps.delete(id);
}

/**
 * Applies one Claude tool call. Returns the new full list when the call changed the plan, or null when the tool is not a
 * plan tool. Calls from a subagent must not reach this: its todos would replace the plan of the agent the person talks to.
 */
export function foldClaudePlanCall(state: ClaudePlanState, call: { id: string; name: string; input: unknown }): PlanUpdateStep[] | null {
  const input = isRecord(call.input) ? call.input : {};
  if (call.name === "TodoWrite") {
    if (!Array.isArray(input.todos)) return null;
    state.steps.clear();
    state.creates.clear();
    input.todos.forEach((todo, index) => {
      if (!isRecord(todo) || !isString(todo.content)) return;
      state.steps.set(`todo-${index}`, {
        step: todo.content,
        status: planStepStatus(todo.status),
        ...(isString(todo.activeForm) ? { activeText: todo.activeForm } : {}),
      });
    });
    return [...state.steps.values()];
  }
  if (call.name === "TaskCreate") {
    if (!isString(input.subject)) return null;
    state.steps.set(call.id, {
      step: input.subject,
      status: "pending",
      ...(isString(input.activeForm) ? { activeText: input.activeForm } : {}),
    });
    state.creates.add(call.id);
    return [...state.steps.values()];
  }
  if (call.name === "TaskUpdate") {
    if (!isString(input.taskId)) return null;
    // A task from before a runtime release is unknown here. With its subject, it can show again.
    const current = state.steps.get(input.taskId) ?? (isString(input.subject) ? { step: input.subject, status: "pending" as const } : null);
    if (!current) return null;
    if (input.status === "deleted") {
      state.steps.delete(input.taskId);
      return [...state.steps.values()];
    }
    const activeText = isString(input.activeForm) ? input.activeForm : current.activeText;
    state.steps.set(input.taskId, {
      step: isString(input.subject) ? input.subject : current.step,
      status: input.status === undefined ? current.status : planStepStatus(input.status),
      ...(activeText ? { activeText } : {}),
    });
    return [...state.steps.values()];
  }
  return null;
}

/**
 * Applies the result of a `TaskCreate` call: the task moves from its tool-use id to the task id that later `TaskUpdate` calls
 * name, keeping its place. The SDK sends the task in `tool_use_result`; the result text ("Task #3 created") is the fallback.
 */
export function foldClaudePlanResult(state: ClaudePlanState, toolUseId: string, result: unknown, text: string): void {
  if (!state.creates.delete(toolUseId)) return;
  const task = isRecord(result) && isRecord(result.task) ? result.task : null;
  const taskId = task && isString(task.id) ? task.id : /#(\d+)/u.exec(text)?.[1];
  if (!taskId || taskId === toolUseId || !state.steps.has(toolUseId)) return;
  state.steps = new Map([...state.steps.entries()].map(([id, step]): [string, PlanUpdateStep] => [id === toolUseId ? taskId : id, step]));
}

export function isClaudePlanTool(name: string): boolean {
  return name === "TodoWrite" || name === "TaskCreate" || name === "TaskUpdate";
}
