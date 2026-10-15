// Copyright (c) 2026 AIKING.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createCore, AnthropicModel, DEFAULT_MODEL, type ModelClient, type CoreEvent, type Core } from "../../aiking/core/index.mjs";
import type { ProviderDriver, RuntimeEvent, RuntimeEventListener, SendTurnInput, RequestOutcome, McpServerSpec } from "../contracts.ts";
import { DATA_DIR } from "../config.ts";
import { allowsTool, canUseMcpServer } from "../../shared/tool-scope.ts";
import { resolveBotSkills, enabledSkillFile } from "../skills.ts";
import { redactSecretsInText } from "../../shared/redact.ts";

type Config = { mode: "offline" | "anthropic"; model: string; allowDangerous?: string[] };
const KIND = "aiking-core";
const models = { default: DEFAULT_MODEL, options: [{ id: DEFAULT_MODEL, label: "AIKING Core · Claude" }] };
const sessionKey = (instance: string, bot: string, thread: string) => createHash("sha256").update(JSON.stringify([instance, bot, thread])).digest("hex");

export class CoreOfflineModel implements ModelClient {
  provider = "offline-verification";
  async create(request: Parameters<ModelClient["create"]>[0], options: Parameters<ModelClient["create"]>[1] = {}) {
    options.signal?.throwIfAborted();
    const latest = request.messages.findLastIndex((message) => message.role === "user" && typeof message.content === "string");
    const turns = request.messages.slice(latest + 1).filter((message) => message.role === "assistant").length;
    let content: Awaited<ReturnType<ModelClient["create"]>>["content"];
    if (turns === 0) content = [{ type: "text", text: "AIKING Core · offline verification: planning tools." }, { type: "tool_call", id: randomUUID(), name: "plan_capabilities", input: { task: String(request.messages[latest]?.content ?? ""), have: ["text"] } }];
    else if (turns === 1 && request.tools.some((tool) => tool.name.endsWith("__remember"))) content = [{ type: "tool_call", id: randomUUID(), name: request.tools.find((tool) => tool.name.endsWith("__remember"))!.name, input: { text: "Core approved this offline fixture write." } }];
    else content = [{ type: "text", text: "AIKING Core completed the offline model → guarded tools → UI pipeline. This is a scripted model, not a live AI provider." }];
    for (const block of content) if (block.type === "text") for (const word of block.text.match(/\S+\s*/g) ?? []) {
      options.signal?.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 15)); options.onTextDelta?.(word);
    }
    return { content, stopReason: content.some((block) => block.type === "tool_call") ? "tool_use" as const : "end_turn" as const, model: "aiking-offline", usage: [], fallbacks: [] as [] };
  }
}

export const AikingCoreDriver: ProviderDriver<Config> = {
  driverKind: KIND,
  metadata: { displayName: "AIKING Core", supportsMultipleInstances: true, access: "api" },
  models,
  decodeConfig(raw) {
    const config = (raw ?? {}) as Record<string, unknown>;
    if (config.mode !== undefined && !["offline", "anthropic"].includes(String(config.mode))) throw new Error("Core mode must be offline or anthropic.");
    if (config.allowDangerous !== undefined && (!Array.isArray(config.allowDangerous) || config.allowDangerous.some(tool => typeof tool !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(tool)))) throw new Error("allowDangerous must list exact reviewed tool names.");
    return { mode: config.mode === "offline" ? "offline" : "anthropic", model: typeof config.model === "string" && config.model.trim() ? config.model : DEFAULT_MODEL, allowDangerous: config.allowDangerous as string[] | undefined };
  },
  defaultConfig: () => ({ mode: "anthropic", model: DEFAULT_MODEL }),
  async create(input) {
    const listeners = new Set<RuntimeEventListener>();
    type Running = { id: string; bot: string; controller: AbortController; done: Promise<void> };
    const runs = new Map<string, Running>();
    const asks = new Map<string, { thread: string; resolve: (value: boolean) => void }>();
    const paths = new Map<string, string>();
    const root = join(DATA_DIR, "aiking-core", createHash("sha256").update(input.instanceId).digest("hex"));
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const transcriptFor = (id: string) => {
      const mappingPath = join(root, `${id}.mapping.json`); let generation = "";
      if (existsSync(mappingPath)) { const mapping = JSON.parse(readFileSync(mappingPath, "utf8")); if (typeof mapping.generation !== "string" || !/^[a-f0-9-]{36}$/.test(mapping.generation)) throw new Error("Invalid Core transcript mapping."); generation = mapping.generation; }
      return join(root, `${id}${generation ? `-${generation}` : ""}.jsonl`);
    };
    for (const name of readdirSync(root)) {
      if (!/^[a-f0-9]{64}\.state\.json$/.test(name)) continue;
      const file = join(root, name); const state = JSON.parse(readFileSync(file, "utf8"));
      if (typeof state.threadId === "string") { const path = transcriptFor(name.replace(".state.json", "")); if (existsSync(path)) paths.set(state.threadId, path); }
      if (!["running", "approval-pending"].includes(state.status)) continue;
      writeFileSync(`${file}.tmp`, JSON.stringify({ ...state, status: "interrupted", recoveredAt: new Date().toISOString(), requestId: undefined }), { mode: 0o600 }); renameSync(`${file}.tmp`, file);
    }
    const catalog = input.config.mode === "offline" ? { default: "aiking-offline", options: [{ id: "aiking-offline", label: "AIKING Core · Offline test (scripted)" }] } : { default: input.config.model, options: [{ id: input.config.model, label: `AIKING Core · ${input.config.model}` }] };
    const key = input.environment.ANTHROPIC_API_KEY;
    const base = (threadId: string, turnId?: string) => ({ eventId: randomUUID(), provider: KIND, providerInstanceId: input.instanceId, threadId, turnId, createdAt: new Date().toISOString() });
    const emit = (event: RuntimeEvent) => listeners.forEach((listener) => listener(event));
    const persist = (id: string, value: unknown) => { const path = join(root, `${id}.state.json`); const temp = `${path}.tmp`; writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); renameSync(temp, path); };
    const adapter: import("../contracts.ts").ProviderAdapter = {
      provider: KIND,
      capabilities: { sessionModelSwitch: "in-session", agentsMcp: true, computerMcp: true, composioMcp: true, phoneMcp: true, browserMcp: true, dataMcp: true, customMcp: true, localComputerMcp: true, strictResume: true },
      async sendTurn(turn: SendTurnInput) {
        if (runs.has(turn.threadId)) throw new Error("Core already has a turn on this conversation.");
        if (turn.guestConfined || turn.images?.length) throw new Error("Core does not support guest turns or image input yet. Choose another engine.");
        if (input.config.mode !== "offline" && !key) throw new Error("AIKING Core requires ANTHROPIC_API_KEY in its server instance environment.");
        const id = sessionKey(input.instanceId, turn.botId ?? "", turn.threadId);
        if (!turn.sessionReset && turn.resumeCursor !== undefined && turn.resumeCursor !== id) throw new Error("Core resume cursor belongs to a different conversation.");
        const mappingPath = join(root, `${id}.mapping.json`);
        if (turn.sessionReset) { writeFileSync(`${mappingPath}.tmp`, JSON.stringify({ schema: 1, generation: randomUUID() }), { mode: 0o600 }); renameSync(`${mappingPath}.tmp`, mappingPath); }
        const transcriptPath = transcriptFor(id);
        const missing = !existsSync(transcriptPath);
        const rebuilt = !turn.sessionReset && turn.resumeCursor !== undefined && missing;
        if (rebuilt && !turn.recoveryText?.trim()) throw new Error("Core transcript is missing. Recover from the host conversation before resuming.");
        if (missing && !rebuilt && turn.transcript?.length) writeFileSync(transcriptPath, turn.transcript.map(message => JSON.stringify({ role: message.role, content: message.text }) + "\n").join(""), { mode: 0o600 });
        paths.set(turn.threadId, transcriptPath);
        const turnId = randomUUID(); const controller = new AbortController();
        emit({ ...base(turn.threadId, turnId), type: "session.started", sessionId: id, model: turn.model ?? catalog.default, ...(rebuilt ? { rebuilt: true } : {}) });
        emit({ ...base(turn.threadId, turnId), type: "turn.started" });
        const start = async () => {
          let core: Core | undefined;
          let streamingId: string | undefined;
          let text = "";
          const skillsDir = join(root, `${id}-${turnId}.skills`);
          const identity = base(turn.threadId, turnId);
          let completion: Extract<RuntimeEvent, { type: "turn.completed" }> | undefined;
          const event = (value: CoreEvent) => {
            if (controller.signal.aborted) return;
            if (value.type === "text_start") { streamingId = value.messageId; text = ""; }
            else if (value.type === "text_delta") { text += value.delta ?? ""; emit({ ...identity, eventId: randomUUID(), type: "content.delta", itemId: streamingId, streamKind: "assistant_text", delta: value.delta ?? "" }); }
            else if (value.type === "text_end") emit({ ...identity, eventId: randomUUID(), type: "item.completed", itemId: streamingId, itemType: "assistant_text", text });
            else if (value.type === "tool_call") emit({ ...identity, eventId: randomUUID(), type: "item.started", itemId: value.id, itemType: "tool", title: value.name });
            else if (value.type === "tool_result") emit({ ...identity, eventId: randomUUID(), type: "item.completed", itemId: value.id, itemType: "tool", ok: !value.isError, output: value.content });
            else if (value.type === "usage" && value.usage.length) {
              const usage = value.usage.at(-1)!;
              emit({ ...identity, eventId: randomUUID(), type: "thread.token-usage.updated", input: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens, output: usage.outputTokens });
            } else if (value.type === "model_fallback") emit({ ...identity, eventId: randomUUID(), type: "runtime.notice", message: `Model fallback: ${value.fallback.from} → ${value.fallback.to} (${value.fallback.reason}).` });
          };
          try {
            persist(id, { schema: 1, botId: turn.botId, threadId: turn.threadId, turnId, status: "running", model: turn.model ?? catalog.default });
            const servers: Record<string, McpServerSpec> = {};
            const integrations = turn.integrations;
            for (const [name, server] of Object.entries({ ...integrations?.custom, agents: integrations?.agents, browser: integrations?.browser, computer: integrations?.localComputer, composio: integrations?.composio, data: integrations?.data, phone: integrations?.phone })) {
              if (server && canUseMcpServer(turn.toolScope, name)) servers[name] = server;
            }
            mkdirSync(skillsDir, { recursive: true, mode: 0o700 });
            for (const skill of turn.botId ? resolveBotSkills(turn.botId, turn.assignedSkills).filter(skill => skill.enabled) : []) {
              const file = enabledSkillFile(turn.botId!, skill.name, turn.assignedSkills); if (!file) continue;
              const directory = join(skillsDir, skill.name); mkdirSync(directory, { mode: 0o700 });
              writeFileSync(join(directory, "SKILL.md"), readFileSync(file), { mode: 0o600 });
            }
            core = await createCore({ model: input.config.mode === "offline" ? new CoreOfflineModel() : new AnthropicModel({ model: turn.model ?? input.config.model, apiKey: key, baseURL: input.environment.ANTHROPIC_BASE_URL || "https://api.anthropic.com" }), instructions: turn.system, transcriptPath, skillsDir, mcpServers: servers,
              toolPolicy: { allowDangerous: input.config.allowDangerous },
              signal: controller.signal,
              toolAllowed: (name) => { const match = /^mcp__([a-zA-Z0-9_-]+)__(.+)$/.exec(name); return allowsTool(turn.toolScope, match ? { kind: "mcp", server: match[1], name: match[2] } : { kind: "native", name }); },
            });
            controller.signal.throwIfAborted();
            for (const warning of core.warnings) emit({ ...identity, eventId: randomUUID(), type: "runtime.notice", message: warning });
            const result = await core.chat.send(rebuilt ? turn.recoveryText! : turn.text, { signal: controller.signal, onEvent: event, approver: async (request) => {
              const requestId = randomUUID();
              persist(id, { schema: 1, botId: turn.botId, threadId: turn.threadId, turnId, status: "approval-pending", tool: request.tool, requestId });
              return new Promise<boolean>((resolve) => {
                const ended = (source: "timeout" | "system") => { if (!asks.delete(requestId)) return; clearTimeout(timer); controller.signal.removeEventListener("abort", abort); emit({ ...identity, eventId: randomUUID(), type: "request.resolved", requestId, behavior: "deny", source }); resolve(false); };
                const timer = setTimeout(() => ended("timeout"), 10 * 60_000);
                const abort = () => ended("system");
                controller.signal.addEventListener("abort", abort, { once: true });
                asks.set(requestId, { thread: turn.threadId, resolve: (value) => { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); resolve(value); } });
                emit({ ...identity, eventId: randomUUID(), type: "request.opened", requestId, requestType: "permission", tool: request.tool, summary: redactSecretsInText(`AIKING Core requests ${request.risk} access for ${request.tool}: ${JSON.stringify(request.input)}`).slice(0, 2000), nativeReview: "inactive", requiresExplicitApproval: request.risk === "dangerous" });
              });
            } });
            persist(id, { schema: 1, botId: turn.botId, threadId: turn.threadId, turnId, status: result.status });
            if (result.cost.unpricedModels.length) emit({ ...identity, eventId: randomUUID(), type: "runtime.notice", message: `Cost unavailable for: ${result.cost.unpricedModels.join(", ")}.` });
            completion = { ...identity, eventId: randomUUID(), type: "turn.completed", ok: result.status === "completed", stopReason: result.status, ...(result.cost.unpricedModels.length ? {} : { cost: result.cost.usd }) };
          } catch (error) {
            persist(id, { schema: 1, botId: turn.botId, threadId: turn.threadId, turnId, status: controller.signal.aborted ? "cancelled" : "error" });
            if (!controller.signal.aborted) emit({ ...identity, eventId: randomUUID(), type: "runtime.error", terminal: true, message: redactSecretsInText(error instanceof Error ? error.message : "Core turn failed.") });
            completion = { ...identity, eventId: randomUUID(), type: "turn.completed", ok: false, stopReason: controller.signal.aborted ? "cancelled" : "error" };
          } finally {
            try { await core?.close(); rmSync(skillsDir, { recursive: true, force: true }); }
            catch { emit({ ...identity, eventId: randomUUID(), type: "runtime.notice", message: "Core cleanup needs review before the next turn." }); }
            runs.delete(turn.threadId); if (completion) emit(completion);
          }
        };
        const running: Running = { id: turnId, bot: turn.botId ?? "", controller, done: Promise.resolve() };
        runs.set(turn.threadId, running);
        running.done = new Promise<void>((resolve) => { setTimeout(() => { void start().finally(resolve); }, 0); });
        return { turnId };
      },
      async interruptTurn(threadId, turnId) { const running = runs.get(threadId); if (running && (!turnId || running.id === turnId)) { running.controller.abort(); await running.done; } },
      async respondToRequest(threadId, requestId, decision): Promise<RequestOutcome> {
        const ask = asks.get(requestId); if (!ask || ask.thread !== threadId) return "unavailable";
        asks.delete(requestId); ask.resolve(decision.behavior === "allow");
        emit({ ...base(threadId, runs.get(threadId)?.id), type: "request.resolved", requestId, behavior: decision.behavior, source: "user" });
        return decision.behavior === "allow" ? "allowed-once" : "rejected";
      },
      hasSession: (thread) => paths.has(thread) && existsSync(paths.get(thread)!),
      async stopAll() { await Promise.all([...runs.values()].map(async (run) => { run.controller.abort(); await run.done; })); },
      onEvent(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    return { ...input, driverKind: KIND, models: catalog, adapter, snapshot: async () => ({ state: input.config.mode === "offline" || key ? "available" : "unavailable", authenticated: input.config.mode === "offline" || Boolean(key), reason: input.config.mode === "offline" ? "Offline test: scripted model; Core runtime and tools are real." : key ? undefined : "Configure ANTHROPIC_API_KEY on the server for AIKING Core.", billing: "metered" }), dispose: () => adapter.stopAll() };
  },
};
