// Copyright (c) 2026 AIKING.
// Tasks checklist (V3): the plan an agent works through is read from the engine's own plan events (Claude TodoWrite and task
// tools, Codex turn/plan/updated, the ACP `plan` update), kept as one message per turn and shown as a checklist card.
// Tool activity stays in the run details. Reference: OpenBot ConversationPlan, plan-updates.ts and TaskList.tsx.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TASKS_CHECKLIST_PATCHED_FILES = [
  "shared/runtime-events.ts", "shared/wire.ts", "src/state/store.tsx", "src/lib/taskTimeline.ts", "server/thread-events.ts",
  "server/index.ts", "server/drivers/claude.ts", "server/drivers/codex.ts", "server/drivers/acp/core.ts", "server/activity.ts", "src/components/GroupView.tsx", "src/lib/receipts.ts",
];

const KINDS = '"text" | "options" | "activity" | "screen" | "connector" | "secret" | "signin" | "routine.run" | "goal.run" | "digest" | "compaction" | "call" | "widget"';
const KINDS_WITH_PLAN = KINDS.replace('"widget"', '"widget" | "plan"');

export function patchTasksChecklist(source) {
  const edit = (path, ...pairs) => {
    const file = join(source, path); let text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    for (const [before, after] of pairs) {
      if (!text.includes(before) || text.split(before).length !== 2) throw new Error(`Tasks checklist patch anchor changed or is not unique: ${path}: ${before.slice(0, 80)}`);
      text = text.replace(before, after);
    }
    writeFileSync(file, text);
  };
  const addImport = (path, line) => {
    const file = join(source, path); const text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    const at = text.search(/^import /mu);
    if (at < 0) throw new Error(`No import to anchor on: ${path}`);
    writeFileSync(file, `${text.slice(0, at)}${line}\n${text.slice(at)}`);
  };

  edit("shared/runtime-events.ts",
    ['import type { AskQuestion } from "./ask-question.ts";', 'import type { AskQuestion } from "./ask-question.ts";\nimport type { ConversationPlan } from "./conversation-plan.ts";'],
    ['    | { type: "runtime.notice"; message: string }\n  );', `    | { type: "runtime.notice"; message: string }
    /** The plan the agent works through, from the engine's own plan tool: always the full list. Null clears the turn's plan. */
    | { type: "plan.updated"; plan: ConversationPlan | null }
  );`]);

  edit("shared/wire.ts",
    [`  kind: ${KINDS};\n  text?: string;\n  digest?: TurnDigest;`, `  kind: ${KINDS_WITH_PLAN};\n  text?: string;\n  digest?: TurnDigest;`],
    ['  /** call rows (kind "call"): the finished Live call this row records. */\n  call?: LiveCallRecord;', '  /** call rows (kind "call"): the finished Live call this row records. */\n  call?: LiveCallRecord;\n  /** plan rows (kind "plan"): the checklist the agent works through this turn; `text` is its markdown fallback. */\n  plan?: import("./conversation-plan.ts").ConversationPlan;']);

  edit("src/state/store.tsx",
    [`  kind: ${KINDS};\n  text?: string;\n  digest?: TurnDigest;`, `  kind: ${KINDS_WITH_PLAN};\n  text?: string;\n  digest?: TurnDigest;\n  plan?: import("../../shared/conversation-plan").ConversationPlan;`]);

  edit("src/lib/taskTimeline.ts", [`  kind: ${KINDS};`, `  kind: ${KINDS_WITH_PLAN};`]);

  edit("server/thread-events.ts",
    ['    case "runtime.notice":\n      return typeof value.message === "string";', '    case "runtime.notice":\n      return typeof value.message === "string";\n    case "plan.updated":\n      return value.plan === null || (isRecord(value.plan) && Array.isArray(value.plan.steps));']);

  // The activity receipt names the plan tool in plain words.
  edit("server/activity.ts",
    ['  TodoWrite: "Updated its task list",', '  TodoWrite: "Updated its task list",\n  TaskCreate: "Added a task",\n  TaskUpdate: "Updated its task list",']);

  addImport("server/index.ts", 'import { conversationPlanText, settlePlan } from "../shared/conversation-plan.ts";');
  edit("server/index.ts",
    ['// Keyed by threadId: provider item and request ids are unique only within a thread.\nconst toolMessageByItem = new Map<string, string>();', '// Keyed by threadId: provider item and request ids are unique only within a thread.\nconst toolMessageByItem = new Map<string, string>();\n// One Tasks checklist message per turn, keyed by threadId:turnId; each plan update replaces its whole list.\nconst planMessageByTurn = new Map<string, string>();'],
    ['    case "item.started":\n      if (event.itemType === "tool") {\n        const name = event.title ?? "tool";', `    case "plan.updated": {
      const turnKey = \`\${event.threadId}:\${event.turnId ?? liveTurnId ?? ""}\`;
      const knownId = planMessageByTurn.get(turnKey);
      const plan = event.plan;
      if (!plan) {
        // The agent deleted its last task: the checklist goes away.
        if (knownId) store.patchMessage(event.threadId, knownId, { plan: { explanation: null, steps: [] }, text: "" });
        break;
      }
      const patch = { plan, text: conversationPlanText(plan) };
      if (knownId && store.patchMessage(event.threadId, knownId, patch)) break;
      const message = pushMessage({ role: "bot", kind: "plan", ...patch, turnId: liveTurnId });
      planMessageByTurn.set(turnKey, message.id);
      break;
    }
    case "item.started":
      if (event.itemType === "tool") {
        const name = event.title ?? "tool";`],
    ['    case "turn.completed": {\n      settleWaitingOnPersonChips(event.threadId);', `    case "turn.completed": {
      {
        // What was running when the turn ended is no longer running; nothing is ticked on the agent's behalf.
        const turnKey = \`\${event.threadId}:\${event.turnId ?? liveTurnId ?? ""}\`;
        const planId = planMessageByTurn.get(turnKey);
        planMessageByTurn.delete(turnKey);
        const planned = planId ? store.messagesFor(event.threadId).find((candidate) => candidate.id === planId)?.plan : undefined;
        if (planId && planned) store.patchMessage(event.threadId, planId, { plan: settlePlan(planned) });
      }
      settleWaitingOnPersonChips(event.threadId);`]);

  addImport("server/drivers/claude.ts", 'import { foldClaudePlanCall, foldClaudePlanResult, isClaudePlanTool, newClaudePlanState, planFromSteps, startClaudePlanTurn, type ClaudePlanState } from "../plan-updates.ts";');
  edit("server/drivers/claude.ts",
    // Without a terminal the CLI gives newer models no TodoWrite or task tools, so there would be no plan to show (OpenBot sets the same variable).
    ['  delete env.CLAUDE_CODE_ENTRYPOINT;\n  stripWorkspaceCredentialEnv(env);', '  delete env.CLAUDE_CODE_ENTRYPOINT;\n  env.CLAUDE_CODE_ENABLE_TODO_TOOLS = "1";\n  stripWorkspaceCredentialEnv(env);'],
    ['    const sessions = new Map<string, Session>();\n', '    const sessions = new Map<string, Session>();\n    // The plan Claude keeps with its own tools lives as long as the session: a task made in one turn is updated in the next.\n    const planStates = new Map<string, ClaudePlanState>();\n'],
    ['      warmContracts.delete(threadId);\n      warmHolds.delete(threadId);\n      if (s.idleTimer) clearTimeout(s.idleTimer);', '      warmContracts.delete(threadId);\n      warmHolds.delete(threadId);\n      planStates.delete(threadId);\n      if (s.idleTimer) clearTimeout(s.idleTimer);'],
    ['                  input: toolDetailPreview(b.input),\n                });\n              }\n            }\n            if (msg.usage) {', `                  input: toolDetailPreview(b.input),
                });
                // A subagent's todos must not replace the plan of the agent the person talks to.
                if (!o.parent_tool_use_id && isClaudePlanTool(String(b.name))) {
                  const planState = planStates.get(threadId) ?? newClaudePlanState();
                  planStates.set(threadId, planState);
                  startClaudePlanTurn(planState, currentTurnId());
                  const steps = foldClaudePlanCall(planState, { id: String(b.id), name: String(b.name), input: b.input });
                  if (steps) emit({ ...base(threadId, currentTurnId()), type: "plan.updated", plan: planFromSteps(steps) });
                }
              }
            }
            if (msg.usage) {`],
    ['                emit({ ...base(threadId, currentTurnId()), type: "item.completed", itemType: "tool", itemId: b.tool_use_id, ok: !b.is_error, output: toolDetailPreview(b.content) });\n', '                emit({ ...base(threadId, currentTurnId()), type: "item.completed", itemType: "tool", itemId: b.tool_use_id, ok: !b.is_error, output: toolDetailPreview(b.content) });\n                { const planState = planStates.get(threadId); if (planState && !o.parent_tool_use_id) foldClaudePlanResult(planState, String(b.tool_use_id), o.tool_use_result, toolDetailPreview(b.content) ?? ""); }\n']);

  addImport("server/drivers/codex.ts", 'import { planFromCodexNotification } from "../plan-updates.ts";');
  edit("server/drivers/codex.ts",
    // Codex registers update_plan only when [tools.update_plan] is enabled; without it there is no plan event to show.
    ['...codexToolSurfaceArgs(),\n          // Native shell snapshots', '...codexToolSurfaceArgs(), "-c", "tools.update_plan.enabled=true",\n          // Native shell snapshots'],
    ['          // item/completed follows with the whole message, so a delta is only a fallback.\n          case "item/agentMessage/delta": {', `          // The agent's own plan (update_plan): always the full list; an empty list clears it.
          case "turn/plan/updated": {
            const update = planFromCodexNotification(p);
            if (update) emit({ ...base(threadId, turnId), type: "plan.updated", plan: update.kind === "plan" ? update.plan : null });
            break;
          }
          // item/completed follows with the whole message, so a delta is only a fallback.
          case "item/agentMessage/delta": {`]);

  addImport("server/drivers/acp/core.ts", 'import { planFromAcpUpdate } from "../../plan-updates.ts";');
  edit("server/drivers/acp/core.ts",
    ['            case "agent_thought_chunk": {', `            case "plan": {
              // ACP sends the whole plan each time; an empty one clears it.
              const update = planFromAcpUpdate(u);
              if (update) emit({ ...base(threadId, current.turnId), type: "plan.updated", plan: update.kind === "plan" ? update.plan : null });
              break;
            }
            case "agent_thought_chunk": {`]);

  // Group chats show the same checklist for the member that is working.
  addImport("src/components/GroupView.tsx", 'import { TaskChecklist } from "./TaskChecklist";');
  edit("src/components/GroupView.tsx",
    ['          ) : m.kind === "activity" && m.tool ? (\n            roomActivityVisible(m, showToolCalls) ? (', `          ) : m.kind === "plan" ? (
            m.plan?.steps.length ? <div className="flex justify-start"><TaskChecklist plan={m.plan} /></div> : null
          ) : m.kind === "activity" && m.tool ? (
            roomActivityVisible(m, showToolCalls) ? (`]);
  // The checklist is a status card, not the last thing said: previews, the mascot and "regenerate" skip it like other receipts.
  edit("src/lib/receipts.ts",
    ['message.kind === "digest" || message.kind === "compaction" || message.kind === "call";', 'message.kind === "digest" || message.kind === "compaction" || message.kind === "call" || message.kind === "plan";']);
}
