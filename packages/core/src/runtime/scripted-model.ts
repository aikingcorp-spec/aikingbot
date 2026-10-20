// Copyright (c) 2026 AIKING. All rights reserved.
//
// Offline ModelClient that replays scripted turns. Used by tests and by the
// demo when no API credentials are available. Each step receives the
// request, so a script can read tool results before it answers.

import type { ContentBlock, CreateOptions, ModelClient, ModelRequest, ModelResponse, StopReason } from "./model.ts";

export interface ScriptTurn {
	content: ContentBlock[];
	stopReason: StopReason;
	/** Optional overrides for tests of usage, fallback and cost handling. */
	model?: string;
	usage?: ModelResponse["usage"];
	fallbacks?: ModelResponse["fallbacks"];
}
export type ScriptStep = (request: ModelRequest) => ScriptTurn;

let nextId = 0;

export function textBlock(text: string): ContentBlock {
	return { type: "text", text };
}

export function toolCall(name: string, input: Record<string, unknown>): ContentBlock {
	nextId += 1;
	return { type: "tool_call", id: `call_scripted_${nextId}`, name, input };
}

/** Last tool_result text in the request, for scripts that react to tools. */
export function lastToolResult(request: ModelRequest): string {
	return toolResults(request).at(-1) ?? "";
}

/** All tool_result texts of the last user message, in call order. */
export function toolResults(request: ModelRequest): string[] {
	const last = request.messages.at(-1);
	if (!last || typeof last.content === "string") return [];
	return last.content.flatMap((b) => (b.type === "tool_result" ? [b.content] : []));
}

export class ScriptedModel implements ModelClient {
	readonly provider = "scripted";
	readonly requests: ModelRequest[] = [];
	private index = 0;

	constructor(private readonly steps: ScriptStep[]) {}

	/** With `chunkDelayMs`, text is streamed word by word through `onTextDelta`. */
	chunkDelayMs = 0;

	async create(request: ModelRequest, options: CreateOptions = {}): Promise<ModelResponse> {
		this.requests.push({ ...request, messages: [...request.messages] });
		const step = this.steps[this.index++];
		if (!step) throw new Error("scripted model has no more steps");
		const turn = step(request);
		const model = turn.model ?? "scripted";
		if (options.onTextDelta) {
			for (const block of turn.content) {
				if (block.type !== "text") continue;
				for (const piece of block.text.match(/\S+\s*|\s+/g) ?? []) {
					if (this.chunkDelayMs > 0) await new Promise((r) => setTimeout(r, this.chunkDelayMs));
					options.onTextDelta(piece);
				}
			}
		}
		return {
			content: turn.content,
			stopReason: turn.stopReason,
			model,
			usage: turn.usage ?? [{ model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }],
			fallbacks: turn.fallbacks ?? [],
		};
	}
}
