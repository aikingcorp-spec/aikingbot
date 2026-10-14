// Copyright (c) 2026 AIKING. All rights reserved.
//
// Connects to MCP servers with the official MCP TypeScript SDK and exposes
// their tools to the agent runtime. Tool names are namespaced as
// `mcp__<server>__<tool>` so two servers can export the same tool name.

import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ToolOutcome, ToolSource } from "../runtime/tools.ts";

export interface StdioServerConfig {
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
}

const SERVER_NAME = /^[a-zA-Z0-9-]{1,24}$/;
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_RESULT_CHARS = 50_000;

interface ConnectedServer {
	client: Client;
	tools: Map<string, string>; // exposed name -> MCP tool name
	definitions: Anthropic.Tool[];
}

export function exposedToolName(server: string, tool: string): string {
	return `mcp__${server}__${tool}`;
}

type CallToolContent = { type: string; text?: string; mimeType?: string };

/** Turns an MCP CallToolResult into plain text for the model. */
export function renderToolResult(result: Record<string, unknown>): ToolOutcome {
	const parts: string[] = [];
	// Servers on older protocol versions return a bare `toolResult` value.
	if ("toolResult" in result && !("content" in result)) {
		return { content: JSON.stringify(result.toolResult), isError: false };
	}
	const content = Array.isArray(result.content) ? (result.content as CallToolContent[]) : [];
	for (const item of content) {
		if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
		else parts.push(`[${item.type}${item.mimeType ? ` ${item.mimeType}` : ""} content omitted]`);
	}
	if (parts.length === 0 && result.structuredContent !== undefined) {
		parts.push(JSON.stringify(result.structuredContent));
	}
	let text = parts.join("\n");
	if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated]`;
	return { content: text, isError: result.isError === true };
}

export class McpHub implements ToolSource {
	private readonly servers = new Map<string, ConnectedServer>();

	/** Connects one server over any MCP transport (stdio, HTTP, in-memory). */
	async connect(name: string, transport: Transport): Promise<string[]> {
		if (!SERVER_NAME.test(name)) throw new Error(`invalid MCP server name "${name}"`);
		if (this.servers.has(name)) throw new Error(`MCP server "${name}" is already connected`);

		const client = new Client({ name: "aiking-core", version: "0.1.0" });
		await client.connect(transport);
		try {
			const { tools } = await client.listTools();
			const map = new Map<string, string>();
			const definitions: Anthropic.Tool[] = [];
			for (const tool of tools) {
				const exposed = exposedToolName(name, tool.name);
				if (!TOOL_NAME.test(exposed)) continue; // Name the model API cannot accept.
				map.set(exposed, tool.name);
				definitions.push({
					name: exposed,
					description: tool.description ?? `MCP tool ${tool.name} from ${name}.`,
					input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
				});
			}
			this.servers.set(name, { client, tools: map, definitions });
			return [...map.keys()];
		} catch (error) {
			await client.close();
			throw error;
		}
	}

	connectStdio(name: string, config: StdioServerConfig): Promise<string[]> {
		return this.connect(
			name,
			new StdioClientTransport({
				command: config.command,
				args: config.args,
				cwd: config.cwd,
				env: config.env,
				stderr: "pipe",
			}),
		);
	}

	definitions(): Anthropic.Tool[] {
		return [...this.servers.values()].flatMap((s) => s.definitions);
	}

	async call(name: string, input: unknown): Promise<ToolOutcome | undefined> {
		for (const server of this.servers.values()) {
			const toolName = server.tools.get(name);
			if (toolName === undefined) continue;
			const args = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
			const result = await server.client.callTool({ name: toolName, arguments: args });
			return renderToolResult(result);
		}
		return undefined;
	}

	async close(): Promise<void> {
		const servers = [...this.servers.values()];
		this.servers.clear();
		await Promise.allSettled(servers.map((s) => s.client.close()));
	}
}
