// Copyright (c) 2026 AIKING.
import { describe, expect, it } from "vitest";
import { clampConversationPlan, conversationPlanText, planProgress, settlePlan } from "../shared/conversation-plan.ts";
import {
  foldClaudePlanCall, foldClaudePlanResult, newClaudePlanState, planFromAcpUpdate, planFromCodexNotification,
  planStepStatus, startClaudePlanTurn,
} from "./plan-updates.ts";

describe("conversation plan", () => {
  it("drops blank steps, repairs duplicate ids and bounds the list", () => {
    const plan = clampConversationPlan({ explanation: "  why  ", steps: [
      { id: "a", text: " One ", status: "completed" }, { id: "a", text: "Two", status: "bogus" }, { id: "", text: "   " },
      ...Array.from({ length: 150 }, (_, index) => ({ id: `n${index}`, text: `s${index}` })),
    ] });
    expect(plan?.explanation).toBe("why");
    expect(plan?.steps.length).toBe(100);
    expect(plan?.steps[0]).toEqual({ id: "a", text: "One", status: "completed" });
    expect(plan?.steps[1]).toMatchObject({ id: "step-1", status: "pending" });
    expect(clampConversationPlan({ steps: [{ text: " " }] })).toBeNull();
  });

  it("renders a readable checklist and counts progress", () => {
    const plan = clampConversationPlan({ steps: [{ text: "a", status: "completed" }, { text: "b", status: "inProgress" }, { text: "c" }] })!;
    expect(conversationPlanText(plan)).toBe("- [x] a\n- [ ] b\n- [ ] c");
    expect(planProgress(plan)).toMatchObject({ done: 1, total: 3, complete: false, active: { text: "b" } });
    expect(settlePlan(plan).steps.map((step) => step.status)).toEqual(["completed", "pending", "pending"]);
  });
});

describe("Codex and ACP plan updates", () => {
  it("reads turn/plan/updated, and an empty list clears the plan", () => {
    const update = planFromCodexNotification({ threadId: "t", turnId: "u", explanation: "Because", plan: [{ step: "Read", status: "completed" }, { step: "Edit", status: "inProgress" }, { step: "Test", status: "pending" }] });
    expect(update).toMatchObject({ kind: "plan", plan: { explanation: "Because" } });
    expect(update?.kind === "plan" && update.plan.steps.map((step) => step.status)).toEqual(["completed", "inProgress", "pending"]);
    expect(planFromCodexNotification({ plan: [] })).toEqual({ kind: "cleared" });
    expect(planFromCodexNotification({ nothing: true })).toBeNull();
    expect(planFromCodexNotification("x")).toBeNull();
  });

  it("reads the ACP plan update and ignores priority", () => {
    const update = planFromAcpUpdate({ sessionUpdate: "plan", entries: [{ content: "Look", priority: "high", status: "in_progress" }, { content: "Fix", priority: "low", status: "pending" }, { nope: 1 }] });
    expect(update?.kind === "plan" && update.plan.steps).toEqual([
      { id: "0", text: "Look", status: "inProgress" }, { id: "1", text: "Fix", status: "pending" },
    ]);
    expect(planStepStatus("whatever")).toBe("pending");
  });
});

describe("Claude plan tools", () => {
  it("TodoWrite replaces the whole list", () => {
    const state = newClaudePlanState();
    foldClaudePlanCall(state, { id: "1", name: "TodoWrite", input: { todos: [{ content: "A", status: "pending", activeForm: "Doing A" }, { content: "B", status: "pending" }] } });
    const steps = foldClaudePlanCall(state, { id: "2", name: "TodoWrite", input: { todos: [{ content: "A", status: "completed" }, { content: "B", status: "in_progress", activeForm: "Doing B" }] } });
    expect(steps).toEqual([{ step: "A", status: "completed" }, { step: "B", status: "inProgress", activeText: "Doing B" }]);
    expect(foldClaudePlanCall(state, { id: "3", name: "Read", input: {} })).toBeNull();
    expect(foldClaudePlanCall(state, { id: "4", name: "TodoWrite", input: {} })).toBeNull();
  });

  it("TaskCreate then TaskUpdate keeps order and re-keys by the result's task id", () => {
    const state = newClaudePlanState();
    foldClaudePlanCall(state, { id: "tu1", name: "TaskCreate", input: { subject: "First" } });
    foldClaudePlanCall(state, { id: "tu2", name: "TaskCreate", input: { subject: "Second", activeForm: "Doing second" } });
    foldClaudePlanResult(state, "tu1", { task: { id: "1" } }, "");
    foldClaudePlanResult(state, "tu2", undefined, "Task #2 created successfully");
    foldClaudePlanResult(state, "unrelated", undefined, "Task #9");
    expect([...state.steps.keys()]).toEqual(["1", "2"]);
    expect(foldClaudePlanCall(state, { id: "tu3", name: "TaskUpdate", input: { taskId: "2", status: "in_progress" } })).toEqual([
      { step: "First", status: "pending" }, { step: "Second", status: "inProgress", activeText: "Doing second" },
    ]);
    expect(foldClaudePlanCall(state, { id: "tu4", name: "TaskUpdate", input: { taskId: "1", status: "deleted" } })).toEqual([
      { step: "Second", status: "inProgress", activeText: "Doing second" },
    ]);
    expect(foldClaudePlanCall(state, { id: "tu5", name: "TaskUpdate", input: { taskId: "99", status: "completed" } })).toBeNull();
  });

  it("a new turn keeps only the open tasks", () => {
    const state = newClaudePlanState();
    startClaudePlanTurn(state, "turn-1");
    foldClaudePlanCall(state, { id: "1", name: "TodoWrite", input: { todos: [{ content: "Done", status: "completed" }, { content: "Open", status: "pending" }] } });
    startClaudePlanTurn(state, "turn-1");
    expect(state.steps.size).toBe(2);
    startClaudePlanTurn(state, "turn-2");
    expect([...state.steps.values()].map((step) => step.step)).toEqual(["Open"]);
  });
});
