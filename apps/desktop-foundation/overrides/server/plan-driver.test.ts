// Copyright (c) 2026 AIKING.
import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { ensureDirs } from "./config.ts";
import { ClaudeDriver } from "./drivers/claude.ts";
import { recordEvents } from "./testing/events.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const fake = join(dirname(fileURLToPath(import.meta.url)), "testing/fake-claude-cli.ts");

it.each(["TodoWrite", "TaskCreate"] as const)("folds streamed Claude %s tools into plan events and retains tool detail", async mode => {
  ensureDirs();
  chmodSync(fake, 0o755);
  const scratch = mkdtempSync(join(tmpdir(), "aiking-plan-driver-"));
  const dump = join(scratch, "spawn.json");
  const tools = mode === "TodoWrite" ? [
    { name: "TodoWrite", input: { todos: [{ content: "Read", status: "in_progress", activeForm: "Reading" }, { content: "Report", status: "pending" }] } },
    { name: "TodoWrite", input: { todos: [{ content: "Read", status: "completed" }, { content: "Report", status: "completed" }] } },
  ] : [
    { id: "create-one", name: "TaskCreate", input: { subject: "Read" }, output: [{ type: "text", text: "Task #1 created successfully" }] },
    { id: "create-two", name: "TaskCreate", input: { subject: "Report" }, output: [{ type: "text", text: "Task #2 created successfully" }] },
    { name: "TaskUpdate", input: { taskId: "1", status: "completed" } },
    { name: "TaskUpdate", input: { taskId: "2", status: "completed" } },
  ];
  const instance = await ClaudeDriver.create({
    instanceId: "claude-plan-fixture", displayName: "Offline plan fixture", enabled: true,
    config: { cli: fake, permissionMode: "acceptEdits" },
    environment: { HOME: scratch, USERPROFILE: scratch, FAKE_CLAUDE_MODE: "echo", FAKE_CLAUDE_TOOL_CALLS: JSON.stringify(tools), FAKE_CLAUDE_DUMP: dump },
  });
  const recorder = recordEvents(instance.adapter);
  try {
    await instance.adapter.sendTurn({ threadId: "fixture-plan-" + mode, text: "Offline plan fixture", model: "claude-sonnet-5" });
    expect(await recorder.until(event => event.type === "turn.completed")).toMatchObject({ ok: true });
    const updates = recorder.events.filter(event => event.type === "plan.updated");
    expect(updates.length).toBe(tools.length);
    expect(updates.at(-1)).toMatchObject({ plan: { steps: [
      { text: "Read", status: "completed" }, { text: "Report", status: "completed" },
    ] } });
    expect(recorder.events.filter(event => event.type === "item.started" && event.itemType === "tool")).toHaveLength(tools.length);
    expect(JSON.parse(readFileSync(dump, "utf8")).env.CLAUDE_CODE_ENABLE_TODO_TOOLS).toBe("1");
  } finally {
    recorder.stop();
    await instance.dispose();
    await removeTempDir(scratch);
  }
});
