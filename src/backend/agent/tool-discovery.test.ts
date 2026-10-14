// @vitest-environment node
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@aikingbot/contracts/ipc";
import { sourceText } from "@aikingbot/i18n/source";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "../agent-client";
import type { AgentService } from "../agent-service";
import {
  aikingBotToolPayload,
  callAIKINGBOTTool,
  createTestService,
  FakeAgentClient,
  fakeClaudeCli,
  fakeGrokCli,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "../agent-service-test-harness";
import { runCauseEffect } from "../effect-boundary";
import { BUILTIN_TOOL_CATALOG } from "./tool-catalog";

// Failure modes: discovery dispatch fails on a provider; an invalid envelope reaches a tool;
// deferred arguments bypass the original decoder; a retried message creates duplicate deliveries.
let root: string;
let service: AgentService | null = null;
beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});
afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

async function start(provider: AgentProvider = "codex") {
  if (provider === "claude") process.env.AIKINGBOT_CLAUDE_PATH = await fakeClaudeCli();
  if (provider === "grok") process.env.AIKINGBOT_GROK_PATH = await fakeGrokCli();
  if (provider === "pi" || provider === "muse") {
    const executable = join(root, provider);
    await writeFile(executable, `#!/bin/sh\nprintf '${provider} 1.1.0\\n'\n`, { mode: 0o755 });
    if (provider === "pi") process.env.AIKINGBOT_PI_PATH = executable;
    else process.env.AIKINGBOT_MUSE_PATH = executable;
  }
  const { store, mailbox } = stores(root);
  const client = new FakeAgentClient(provider, "", false);
  service = createTestService({
    store,
    mailbox,
    preferredProvider: provider,
    clientFactory: (candidate) => (candidate === provider ? client : new FakeAgentClient(candidate, "", false)),
  });
  const events: AgentEvent[] = [];
  service.on("event", (event) => events.push(event));
  await runCauseEffect(service.initialize());
  await runCauseEffect(store.getOrCreate("chief"));
  const model = service.listModels().find((candidate) => candidate.provider === provider);
  if (!model) throw new Error(`The ${provider} fixture has no model.`);
  await runCauseEffect(service.updateAgent({ agentId: "chief", provider, model: model.id }));
  await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Find the available tools." }));
  await waitFor(() => events.some((event) => event.type === "turn-started"));
  const started = events.find((event) => event.type === "turn-started");
  const session = store.activeProviderSession("chief");
  if (!started || !session) throw new Error("The discovery turn did not start.");
  expect(session.provider).toBe(provider);
  return { client, store, threadId: session.externalSessionId, turnId: started.turnId, agentService: service };
}

describe.sequential("built-in tool discovery", () => {
  it.each(["codex", "claude", "grok", "pi", "muse"] as const)(
    "searches, describes and executes a deferred tool through %s",
    async (provider) => {
      const { client, threadId, turnId } = await start(provider);
      const search = await callAIKINGBOTTool(
        client,
        threadId,
        "tool_search",
        { queries: ["aikingbot.list_models"], limit: 1 },
        turnId,
      );
      expect(aikingBotToolPayload(search.result).tools).toEqual([
        expect.objectContaining({ name: "aikingbot.list_models" }),
      ]);
      const description = await callAIKINGBOTTool(
        client,
        threadId,
        "tool_describe",
        { names: ["aikingbot.list_models"] },
        turnId,
      );
      const original = BUILTIN_TOOL_CATALOG.find((entry) => entry.name === "aikingbot.list_models");
      expect(aikingBotToolPayload(description.result).tools).toEqual([
        { name: "aikingbot.list_models", description: original?.description, inputSchema: original?.inputSchema },
      ]);
      const called = await callAIKINGBOTTool(
        client,
        threadId,
        "tool_call",
        { name: "aikingbot.list_models", arguments: { provider } },
        turnId,
      );
      expect(aikingBotToolPayload(called.result).providers).toEqual([
        expect.objectContaining({ provider, models: expect.any(Array) }),
      ]);
    },
  );

  it("rejects unknown, recursive and malformed envelopes without sending a message", async () => {
    const { client, store, threadId, turnId, agentService } = await start();
    await runCauseEffect(store.getOrCreate("worker"));
    const envelopes = [
      { name: "aikingbot.missing_tool", arguments: {} },
      ...["tool_call", "tool_search", "tool_describe"].map((name) => ({ name: `aikingbot.${name}`, arguments: {} })),
      { name: "aikingbot.send_message", arguments: "private-invalid-arguments" },
      { name: "aikingbot.send_message", arguments: {}, extra: "private-invalid-field" },
    ];
    for (const envelope of envelopes) {
      const response = await callAIKINGBOTTool(client, threadId, "tool_call", envelope, turnId);
      expect(response.error).toBeUndefined();
      expect(response.result).toMatchObject({ success: false });
      expect(aikingBotToolPayload(response.result)).toEqual({ error: sourceText("error.agent.toolRequestInvalid") });
      expect(JSON.stringify(response)).not.toContain("private-invalid");
    }
    const invalidArguments = { recipientAgentIds: ["worker"], text: 17 };
    const direct = await callAIKINGBOTTool(client, threadId, "send_message", invalidArguments, turnId);
    const deferred = await callAIKINGBOTTool(
      client,
      threadId,
      "tool_call",
      { name: "aikingbot.send_message", arguments: invalidArguments },
      turnId,
    );
    expect(deferred.error).toEqual(direct.error);
    expect(deferred.error?.message).toContain("text is required");
    expect(agentService.listQueue("worker").deliveries).toEqual([]);
  });

  it("keeps one delivery when the same deferred message call is retried", async () => {
    const { client, store, threadId, turnId, agentService } = await start();
    await runCauseEffect(store.getOrCreate("worker"));
    const envelope = {
      name: "aikingbot.send_message",
      arguments: { recipientAgentIds: ["worker"], text: "Prepare the report.", expectsReply: false },
    };
    const first = await callAIKINGBOTTool(client, threadId, "tool_call", envelope, turnId, "same-message-call");
    const second = await callAIKINGBOTTool(client, threadId, "tool_call", envelope, turnId, "same-message-call");
    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();
    expect(aikingBotToolPayload(second.result).messageId).toBe(aikingBotToolPayload(first.result).messageId);
    expect(agentService.listQueue("worker").deliveries).toEqual([
      expect.objectContaining({ text: "Prepare the report.", sender: { kind: "agent", agentId: "chief" } }),
    ]);
  });
});
