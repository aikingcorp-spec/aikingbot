// Copyright (c) 2026 AIKING. All rights reserved.
//
// Connects to MCP servers with the official MCP TypeScript SDK and exposes
// their tools to the agent runtime. Tool names are namespaced as
// `mcp__<server>__<tool>` so two servers can export the same tool name.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { GuardedToolDefinition, ToolCallContext, ToolOutcome, ToolRisk, ToolSource } from "../runtime/tools.ts";

export interface ServerOptions {
	/**
	 * Risk per MCP tool name, set by the operator. Overrides the server's own
	 * annotations, which are hints from the server and not trusted to lower risk.
	 */
	toolRisk?: Record<string, ToolRisk>;
}

export interface StdioServerConfig extends ServerOptions {
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
}

export interface RemoteServerConfig extends ServerOptions {
	type: "http" | "sse";
	url: string;
	headers?: Record<string, string>;
}
export type McpServerConfig = StdioServerConfig | RemoteServerConfig;

/** Inputs and outputs a tool declares under `_meta["aiking/capability"]`. */
export interface ToolCapability {
	tasks: string[];
	inputs: string[];
	outputs: string[];
}

export interface McpToolInfo {
	name: string;
	server: string;
	description: string;
	risk: ToolRisk;
	capability?: ToolCapability;
}

export const CAPABILITY_META_KEY = "aiking/capability";

interface ToolAnnotations {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
}

/**
 * Risk from MCP tool annotations, following the spec defaults: a tool is
 * not read-only and is destructive unless it says otherwise. So a tool
 * without annotations is treated as dangerous.
 */
export function riskFromAnnotations(annotations: ToolAnnotations | undefined): ToolRisk {
	if (annotations?.readOnlyHint === true) return "read";
	if (annotations?.destructiveHint === false) return "side_effect";
	return "dangerous";
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function capabilityFromMeta(meta: Record<string, unknown> | undefined): ToolCapability | undefined {
	const raw = meta?.[CAPABILITY_META_KEY];
	if (typeof raw !== "object" || raw === null) return undefined;
	const c = raw as Record<string, unknown>;
	return { tasks: strings(c.tasks), inputs: strings(c.inputs), outputs: strings(c.outputs) };
}

const SERVER_NAME = /^[a-zA-Z0-9-]{1,24}$/;
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_RESULT_CHARS = 50_000;

interface ConnectedServer {
	client: Client;
	tools: Map<string, string>; // exposed name -> MCP tool name
	definitions: GuardedToolDefinition[];
	info: McpToolInfo[];
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
	async connect(name: string, transport: Transport, options: ServerOptions = {}): Promise<string[]> {
		if (!SERVER_NAME.test(name)) throw new Error(`invalid MCP server name "${name}"`);
		if (this.servers.has(name)) throw new Error(`MCP server "${name}" is already connected`);

		const client = new Client({ name: "aiking-core", version: "0.2.0" });
		try {
			await client.connect(transport, { timeout: 30_000 });
			const { tools } = await client.listTools();
			const map = new Map<string, string>();
			const definitions: GuardedToolDefinition[] = [];
			const info: McpToolInfo[] = [];
			for (const tool of tools) {
				const exposed = exposedToolName(name, tool.name);
				if (!TOOL_NAME.test(exposed)) continue; // Name the model API cannot accept.
				map.set(exposed, tool.name);
				const description = tool.description ?? `MCP tool ${tool.name} from ${name}.`;
				const risk = options.toolRisk?.[tool.name] ?? riskFromAnnotations(tool.annotations);
				definitions.push({ name: exposed, description, risk, inputSchema: tool.inputSchema });
				const capability = capabilityFromMeta(tool._meta);
				info.push({ name: exposed, server: name, description, risk, ...(capability ? { capability } : {}) });
			}
			this.servers.set(name, { client, tools: map, definitions, info });
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
			{ toolRisk: config.toolRisk },
		);
	}

	connectRemote(name: string, config: RemoteServerConfig): Promise<string[]> {
		const url = new URL(config.url);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("MCP requires HTTP(S), with credentials in headers.");
		const requestInit = { headers: config.headers };
		return this.connect(name, config.type === "sse"
			? new SSEClientTransport(url, { requestInit, eventSourceInit: { fetch: (input, init) => fetch(input, { ...init, headers: config.headers }) } })
			: new StreamableHTTPClientTransport(url, { requestInit }), config);
	}

	definitions(): GuardedToolDefinition[] {
		return [...this.servers.values()].flatMap((s) => s.definitions);
	}

	/** Tool metadata for capability discovery. */
	toolInfo(): McpToolInfo[] {
		return [...this.servers.values()].flatMap((s) => s.info);
	}

	async call(name: string, input: unknown, context?: ToolCallContext): Promise<ToolOutcome | undefined> {
		for (const server of this.servers.values()) {
			const toolName = server.tools.get(name);
			if (toolName === undefined) continue;
			const args = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
			const result = await server.client.callTool(
				{ name: toolName, arguments: args },
				undefined,
				context ? { signal: context.signal, timeout: context.timeoutMs } : undefined,
			);
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
