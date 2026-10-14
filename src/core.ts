// Copyright (c) 2026 AIKING. All rights reserved.
//
// Wires the vertical slice: Chat -> Agent Runtime -> MCP tools + Skills.

import { AgentRuntime, type ModelClient, type RuntimeEvent } from "./runtime/agent-runtime.ts";
import { ToolRegistry } from "./runtime/tools.ts";
import { McpHub, type StdioServerConfig } from "./mcp/mcp-hub.ts";
import { SkillLibrary } from "./skills/skill-library.ts";
import { SkillTools } from "./skills/skill-tools.ts";
import { ChatSession } from "./chat/chat-session.ts";

export interface CoreConfig {
	model: ModelClient;
	skillsDir?: string;
	mcpServers?: Record<string, StdioServerConfig>;
	transcriptPath?: string;
	instructions?: string;
	maxSteps?: number;
	onEvent?: (event: RuntimeEvent) => void;
}

export interface Core {
	chat: ChatSession;
	skills: SkillLibrary;
	mcp: McpHub;
	warnings: string[];
	close(): Promise<void>;
}

export function systemPrompt(skills: SkillLibrary, instructions?: string): string {
	return [
		instructions ?? "You are AIKINGBOT, an assistant for an AI media production team.",
		"",
		"Installed skills (read one with the read_skill tool before you do a task it covers):",
		skills.catalog(),
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
			await mcp.connectStdio(name, server);
		} catch (error) {
			warnings.push(`MCP server "${name}" not connected: ${(error as Error).message}`);
		}
	}

	const runtime = new AgentRuntime({
		model: config.model,
		tools: new ToolRegistry([new SkillTools(library), mcp]),
		system: systemPrompt(library, config.instructions),
		maxSteps: config.maxSteps,
		onEvent: config.onEvent,
	});
	const chat = await ChatSession.open(runtime, config.transcriptPath);
	return { chat, skills: library, mcp, warnings, close: () => mcp.close() };
}
