// Copyright (c) 2026 AIKING.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clampConversationPlan } from "../../shared/conversation-plan";
import { TaskChecklist } from "./TaskChecklist";

const plan = (...steps: Array<[string, "pending" | "inProgress" | "completed", string?]>) =>
  clampConversationPlan({ steps: steps.map(([text, status, activeText], index) => ({ id: String(index), text, status, activeText })) })!;
const html = (value: ReturnType<typeof plan>, defaultOpen = true) => renderToStaticMarkup(createElement(TaskChecklist, { plan: value, defaultOpen }));

describe("TaskChecklist", () => {
  it("shows the title, the done/total counter and every task with its state", () => {
    const markup = html(plan(["Read the files", "completed"], ["Write the fix", "inProgress", "Writing the fix"], ["Run the tests", "pending"]));
    expect(markup).toContain(">Tasks<");
    expect(markup).toContain(">1/3<");
    expect(markup).toContain("1 of 3 tasks done");
    expect(markup.match(/data-task-state="completed"/g)).toHaveLength(1);
    expect(markup.match(/data-task-state="inProgress"/g)).toHaveLength(1);
    expect(markup.match(/data-task-state="pending"/g)).toHaveLength(1);
    expect(markup).toContain("Writing the fix");
    expect(markup).toMatch(/line-through[^>]*>Read the files</);
  });

  it("a finished plan reads 3/3 with every task struck through", () => {
    const markup = html(plan(["A", "completed"], ["B", "completed"], ["C", "completed"]));
    expect(markup).toContain(">3/3<");
    expect(markup).toContain('data-complete=""');
    expect(markup.match(/line-through/g)?.length).toBe(3);
  });

  it("a closed list names the running task instead of the title and hides the items", () => {
    const markup = html(plan(["A", "completed"], ["B", "inProgress", "Doing B"]), false);
    expect(markup).toContain(">Doing B<");
    expect(markup).not.toContain("data-task-state");
    expect(markup).toContain('aria-expanded="false"');
  });

  it("an empty plan renders nothing", () => {
    expect(renderToStaticMarkup(createElement(TaskChecklist, { plan: { explanation: null, steps: [] } }))).toBe("");
  });
});
