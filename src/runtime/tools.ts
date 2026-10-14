// Copyright (c) 2026 AIKING. All rights reserved.
//
// Tool contract between the agent runtime and tool sources (MCP servers,
// built-in tools). Definitions use the Anthropic SDK `Tool` type directly.

import type Anthropic from "@anthropic-ai/sdk";

export interface ToolOutcome {
	content: string;
	isError: boolean;
}

export interface ToolSource {
	definitions(): Anthropic.Tool[];
	/** Returns undefined when this source does not own `name`. */
	call(name: string, input: unknown): Promise<ToolOutcome | undefined>;
}

/** Routes a tool call to the first source that owns the tool name. */
export class ToolRegistry {
	constructor(private readonly sources: ToolSource[]) {}

	definitions(): Anthropic.Tool[] {
		const seen = new Set<string>();
		const tools: Anthropic.Tool[] = [];
		for (const source of this.sources) {
			for (const tool of source.definitions()) {
				if (seen.has(tool.name)) throw new Error(`duplicate tool name "${tool.name}"`);
				seen.add(tool.name);
				tools.push(tool);
			}
		}
		return tools;
	}

	async call(name: string, input: unknown): Promise<ToolOutcome> {
		for (const source of this.sources) {
			try {
				const outcome = await source.call(name, input);
				if (outcome) return outcome;
			} catch (error) {
				return { content: `Tool "${name}" failed: ${(error as Error).message}`, isError: true };
			}
		}
		return { content: `Unknown tool "${name}".`, isError: true };
	}
}
