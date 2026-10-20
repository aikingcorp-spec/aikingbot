// Copyright (c) 2026 AIKING. All rights reserved.
//
// Claude adapter: maps the provider-neutral ModelClient contract to the
// Claude Messages API through the official Anthropic SDK.
//
// Server-side refusal fallback is on by default: if the main model declines,
// the API re-runs the request on a fallback model in the same call. The
// adapter reports that switch in `fallbacks` and bills each model's tokens
// separately from `usage.iterations`.

import Anthropic from "@anthropic-ai/sdk";
import {
	type ContentBlock,
	type CreateOptions,
	type FallbackNote,
	type Message,
	type ModelClient,
	ModelError,
	type ModelErrorKind,
	type ModelRequest,
	type ModelResponse,
	type StopReason,
	type UsageEntry,
} from "./model.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const PROVIDER = "anthropic";

type ApiMessageParam = Anthropic.Beta.BetaMessageParam;
type ApiBlockParam = Anthropic.Beta.BetaContentBlockParam;
type ApiMessage = Anthropic.Beta.BetaMessage;

export interface AnthropicModelOptions {
	apiKey?: string;
	baseURL?: string;
	model?: string;
	maxTokens?: number;
	effort?: "low" | "medium" | "high" | "xhigh" | "max";
	/** Set false to turn off server-side refusal fallback. */
	fallbacks?: boolean;
	/** SDK-level retries for 408/409/429/5xx and connection errors (SDK default: 2). */
	maxRetries?: number;
	/** Request timeout in milliseconds. */
	timeoutMs?: number;
	client?: Anthropic;
}

// ---- neutral -> Claude ----

function toApiBlock(block: ContentBlock): ApiBlockParam | undefined {
	switch (block.type) {
		case "text":
			return block.text ? { type: "text", text: block.text } : undefined;
		case "tool_call":
			return { type: "tool_use", id: block.id, name: block.name, input: block.input };
		case "tool_result":
			return {
				type: "tool_result",
				tool_use_id: block.toolCallId,
				content: block.content,
				...(block.isError ? { is_error: true } : {}),
			};
		case "image":
			return { type: "image", source: { type: "base64", media_type: block.mediaType, data: block.data } };
		case "opaque":
			// Thinking and fallback blocks must round-trip unchanged; blocks from
			// other providers mean nothing to Claude and are dropped.
			return block.provider === PROVIDER ? (block.data as ApiBlockParam) : undefined;
	}
}

export function toApiMessages(messages: readonly Message[]): ApiMessageParam[] {
	const out: ApiMessageParam[] = [];
	for (const m of messages) {
		if (typeof m.content === "string") {
			out.push({ role: m.role, content: m.content });
			continue;
		}
		const content = m.content.map(toApiBlock).filter((b): b is ApiBlockParam => b !== undefined);
		if (content.length > 0) out.push({ role: m.role, content });
	}
	return out;
}

// ---- Claude -> neutral ----

function fromApiBlock(block: Anthropic.Beta.BetaContentBlock): ContentBlock {
	if (block.type === "text") return { type: "text", text: block.text };
	if (block.type === "tool_use") return { type: "tool_call", id: block.id, name: block.name, input: block.input };
	return { type: "opaque", provider: PROVIDER, data: block };
}

const STOP_REASONS: Record<string, StopReason> = {
	end_turn: "end_turn",
	stop_sequence: "end_turn",
	tool_use: "tool_use",
	pause_turn: "pause",
	max_tokens: "max_tokens",
	refusal: "refusal",
	model_context_window_exceeded: "context_exhausted",
};

function usageEntry(
	model: string,
	u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null },
): UsageEntry {
	return {
		model,
		inputTokens: u.input_tokens,
		outputTokens: u.output_tokens,
		cacheReadTokens: u.cache_read_input_tokens ?? 0,
		cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
	};
}

/**
 * Billing per model. With `usage.iterations` each sampling pass (including a
 * declined hop and the fallback that served the turn) is billed at its own
 * model's rates. Without it, the whole response is billed to `message.model`.
 */
export function usageOf(message: ApiMessage, requestedModel: string): UsageEntry[] {
	const iterations = message.usage.iterations;
	if (!iterations || iterations.length === 0) return [usageEntry(message.model, message.usage)];
	return iterations.map((it) => usageEntry(("model" in it && it.model) || requestedModel, it));
}

export function fallbacksOf(message: ApiMessage, requestedModel: string): FallbackNote[] {
	const notes: FallbackNote[] = [];
	for (const block of message.content) {
		if (block.type === "fallback") notes.push({ from: block.from.model, to: block.to.model, reason: "refusal" });
	}
	// A "sticky" turn is served by the fallback model with no fallback block in content.
	const served = message.usage.iterations?.some((it) => it.type === "fallback_message");
	if (served && notes.length === 0) notes.push({ from: requestedModel, to: message.model, reason: "refusal (sticky)" });
	return notes;
}

export function fromApiMessage(message: ApiMessage, requestedModel: string): ModelResponse {
	return {
		content: message.content.map(fromApiBlock),
		stopReason: STOP_REASONS[message.stop_reason ?? "end_turn"] ?? "end_turn",
		model: message.model,
		usage: usageOf(message, requestedModel),
		fallbacks: fallbacksOf(message, requestedModel),
	};
}

export function classifyApiError(error: unknown): ModelErrorKind {
	if (error instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
	if (error instanceof Anthropic.APIConnectionError) return "network";
	if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return "auth";
	if (error instanceof Anthropic.RateLimitError) return "rate_limit";
	if (
		error instanceof Anthropic.BadRequestError ||
		error instanceof Anthropic.NotFoundError ||
		error instanceof Anthropic.UnprocessableEntityError
	) {
		return "invalid_request";
	}
	if (error instanceof Anthropic.APIError && typeof error.status === "number") {
		if (error.status === 529) return "overloaded";
		if (error.status >= 500) return "server";
	}
	return "unknown";
}

export class AnthropicModel implements ModelClient {
	readonly provider = PROVIDER;
	private readonly client: Anthropic;
	readonly model: string;

	constructor(private readonly options: AnthropicModelOptions = {}) {
		// Credentials come from the environment (ANTHROPIC_API_KEY, auth token or `ant` profile).
		this.client =
			options.client ??
			new Anthropic({
				...(options.apiKey ? { apiKey: options.apiKey, authToken: null } : {}),
				...(options.baseURL ? { baseURL: options.baseURL } : {}),
				...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
				...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
			});
		this.model = options.model ?? DEFAULT_MODEL;
	}

	async create(request: ModelRequest, options: CreateOptions = {}): Promise<ModelResponse> {
		const useFallbacks = this.options.fallbacks !== false;
		let message: ApiMessage;
		try {
			const params = {
				model: this.model,
				max_tokens: this.options.maxTokens ?? 16_000,
				output_config: { effort: this.options.effort ?? "medium" },
				system: request.system,
				messages: toApiMessages(request.messages),
				tools: request.tools.map((t) => ({
					name: t.name,
					...(t.description ? { description: t.description } : {}),
					input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
				})),
				...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
			};
			const { onTextDelta } = options;
			message = onTextDelta
				? await this.client.beta.messages.stream(params, { signal: options.signal }).on("text", (delta) => onTextDelta(delta)).finalMessage()
				: await this.client.beta.messages.create(params, { signal: options.signal });
		} catch (error) {
			const status = error instanceof Anthropic.APIError ? error.status : undefined;
			throw new ModelError(classifyApiError(error), PROVIDER, this.model, (error as Error).message, status, {
				cause: error,
			});
		}
		return fromApiMessage(message, this.model);
	}
}
