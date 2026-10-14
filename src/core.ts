// Copyright (c) 2026 AIKING. All rights reserved.
//
// Wires the core: Chat -> Agent Runtime -> guarded tools
// (read_skill, plan_capabilities, MCP tools).

import { CapabilityIndex } from "./capabilities/capability-index.ts";
import { CapabilityTools } from "./capabilities/capability-tools.ts";
import { ChatSession } from "./chat/chat-session.ts";
import { McpHub, type McpServerConfig } from "./mcp/mcp-hub.ts";
import { AgentRuntime, type RuntimeEvent } from "./runtime/agent-runtime.ts";
import type { ModelClient } from "./runtime/model.ts";
import { type GuardEvent, ToolRegistry, type ToolPolicy, type ToolSource } from "./runtime/tools.ts";
import { SkillLibrary } from "./skills/skill-library.ts";
import { SkillTools } from "./skills/skill-tools.ts";

export interface CoreConfig {
	toolAllowed?: (name: string) => boolean;
	toolSources?: ToolSource[];
	model: ModelClient;
	skillsDir?: string;
	mcpServers?: Record<string, McpServerConfig>;
	transcriptPath?: string;
	instructions?: string;
	maxSteps?: number;
	maxToolCalls?: number;
	/** Permission, timeout and output limits for tools. Default: read-only tools only. */
	toolPolicy?: ToolPolicy;
	onEvent?: (event: RuntimeEvent) => void;
	onGuard?: (event: GuardEvent) => void;
}

export interface Core {
	chat: ChatSession;
	skills: SkillLibrary;
	mcp: McpHub;
	capabilities: CapabilityIndex;
	warnings: string[];
	close(): Promise<void>;
}

export function systemPrompt(capabilities: CapabilityIndex, instructions?: string): string {
	return [
		instructions ?? "You are AIKINGBOT, an assistant for an AI media production team.",
		"",
		"Installed capabilities. A skill is read with read_skill; a tool is called directly.",
		"`needs` and `makes` name artifacts: one capability's output can be another's input.",
		capabilities.catalog(),
		"",
		"For a task that may need several capabilities, call plan_capabilities first and follow its order.",
		"Read each skill in the plan before doing its step. If a tool is denied, do not retry it; explain what approval is needed.",
	].join("\n");
}

export async function createCore(config: CoreConfig): Promise<Core> {
	const warnings: string[] = [];
	const { library, errors } = config.skillsDir
		? await SkillLibrary.load(config.skillsDir)
		: { library: new SkillLibrary([]), errors: [] };
	for (const error of errors) warnings.push(`skill skipped: ${error.message}`);

	const mcp = new McpHub();
	for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
		try {
			if ("command" in server) await mcp.connectStdio(name, server);
			else await mcp.connectRemote(name, server);
		} catch (error) {
			warnings.push(`MCP server "${name}" not connected: ${(error as Error).message}`);
		}
	}

	const capabilities = CapabilityIndex.from(library, mcp.toolInfo());
	const runtime = new AgentRuntime({
		model: config.model,
		tools: new ToolRegistry(
			[new SkillTools(library), new CapabilityTools(capabilities), mcp, ...(config.toolSources ?? [])].map((source) => ({
				definitions: () => source.definitions().filter((definition) => config.toolAllowed?.(definition.name) !== false),
				call: (name, input, context) => config.toolAllowed?.(name) === false ? Promise.resolve(undefined) : source.call(name, input, context),
			})),
			config.toolPolicy,
			config.onGuard,
		),
		system: systemPrompt(capabilities, config.instructions),
		maxSteps: config.maxSteps,
		maxToolCalls: config.maxToolCalls,
		onEvent: config.onEvent,
	});
	const chat = await ChatSession.open(runtime, config.transcriptPath);
	return { chat, skills: library, mcp, capabilities, warnings, close: () => mcp.close() };
}
