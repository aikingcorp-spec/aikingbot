// Copyright (c) 2026 AIKING. All rights reserved.
//
// Provider-neutral model contract. The runtime, chat and tools only use the
// types in this file; each provider (Claude, others later) is an adapter that
// maps them to and from its own API. Nothing here imports a provider SDK.

export interface TextBlock {
	type: "text";
	text: string;
}

export interface ToolCallBlock {
	type: "tool_call";
	id: string;
	name: string;
	input: unknown;
}

export interface ToolResultBlock {
	type: "tool_result";
	toolCallId: string;
	content: string;
	isError: boolean;
}

/**
 * A provider-specific block the runtime does not interpret (thinking,
 * fallback markers, server tool output). The adapter that produced it sends
 * it back unchanged; other adapters drop it.
 */
export interface OpaqueBlock {
	type: "opaque";
	provider: string;
	data: unknown;
}

export type ContentBlock = TextBlock | ToolCallBlock | ToolResultBlock | OpaqueBlock;

export interface Message {
	role: "user" | "assistant";
	content: string | ContentBlock[];
}

export interface ToolDefinition {
	name: string;
	description?: string;
	/** JSON Schema of the input object. */
	inputSchema: { type: "object"; [key: string]: unknown };
}

export interface ModelRequest {
	system: string;
	messages: Message[];
	tools: ToolDefinition[];
}

export type StopReason =
	| "end_turn"
	| "tool_use"
	| "pause"
	| "max_tokens"
	| "refusal"
	| "context_exhausted";

/** Tokens billed for one model in one response. */
export interface UsageEntry {
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

export interface FallbackNote {
	from: string;
	to: string;
	/** "refusal" for a provider-side refusal fallback, otherwise the error kind that caused a client-side switch. */
	reason: string;
}

export interface ModelResponse {
	content: ContentBlock[];
	stopReason: StopReason;
	/** Model that produced the final content (after any fallback). */
	model: string;
	/** One entry per model that was billed for this response. */
	usage: UsageEntry[];
	/** Every model switch that happened while producing this response. */
	fallbacks: FallbackNote[];
}

/** The only thing the runtime needs from a model provider. */
export interface ModelClient {
	readonly provider: string;
	create(request: ModelRequest): Promise<ModelResponse>;
}

export type ModelErrorKind =
	| "auth"
	| "invalid_request"
	| "rate_limit"
	| "overloaded"
	| "server"
	| "network"
	| "timeout"
	| "unknown";

const RETRYABLE: ReadonlySet<ModelErrorKind> = new Set(["rate_limit", "overloaded", "server", "network", "timeout"]);

/** A failed model request, classified so callers can decide to fall back. */
export class ModelError extends Error {
	constructor(
		readonly kind: ModelErrorKind,
		readonly provider: string,
		readonly model: string,
		message: string,
		readonly status?: number,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.name = "ModelError";
	}

	/** True when another attempt (same or other model) may succeed. */
	get retryable(): boolean {
		return RETRYABLE.has(this.kind);
	}
}

export function textOf(content: readonly ContentBlock[]): string {
	return content
		.filter((b): b is TextBlock => b.type === "text")
		.map((b) => b.text)
		.join("");
}
