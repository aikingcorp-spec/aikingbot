// Copyright (c) 2026 AIKING. All rights reserved.
//
// ModelClient for the Claude API through the official Anthropic SDK.
// Server-side refusal fallback is on by default: if the main model declines,
// the API re-runs the same request on a fallback model in the same call.

import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelRequest } from "./agent-runtime.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";

export interface AnthropicModelOptions {
	model?: string;
	maxTokens?: number;
	effort?: "low" | "medium" | "high" | "xhigh" | "max";
	/** Set false to turn off server-side refusal fallback. */
	fallbacks?: boolean;
	client?: Anthropic;
}

export class AnthropicModel implements ModelClient {
	private readonly client: Anthropic;

	constructor(private readonly options: AnthropicModelOptions = {}) {
		// Credentials come from the environment (ANTHROPIC_API_KEY, auth token or `ant` profile).
		this.client = options.client ?? new Anthropic();
	}

	create(request: ModelRequest) {
		const useFallbacks = this.options.fallbacks !== false;
		return this.client.beta.messages.create({
			model: this.options.model ?? DEFAULT_MODEL,
			max_tokens: this.options.maxTokens ?? 16_000,
			output_config: { effort: this.options.effort ?? "medium" },
			system: request.system,
			messages: request.messages,
			tools: request.tools,
			...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
		});
	}
}
