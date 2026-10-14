// Copyright (c) 2026 AIKING. All rights reserved.
//
// Offline ModelClient that replays scripted turns. Used by tests and by the
// demo when no Claude API credentials are available. Each step receives the
// request, so a script can read tool results before it answers.

import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelRequest } from "./agent-runtime.ts";

type Block = Anthropic.Beta.BetaContentBlock;
export type ScriptStep = (request: ModelRequest) => { content: Block[]; stop_reason: Anthropic.Beta.BetaStopReason };

let nextId = 0;

export function textBlock(text: string): Block {
	return { type: "text", text, citations: null } as Block;
}

export function toolUseBlock(name: string, input: Record<string, unknown>): Block {
	nextId += 1;
	return { type: "tool_use", id: `toolu_scripted_${nextId}`, name, input } as Block;
}

/** Last tool_result text in the request, for scripts that react to tools. */
export function lastToolResult(request: ModelRequest): string {
	const last = request.messages.at(-1);
	if (!last || typeof last.content === "string") return "";
	const result = [...last.content].reverse().find((b) => b.type === "tool_result");
	if (!result || result.type !== "tool_result") return "";
	return typeof result.content === "string" ? result.content : JSON.stringify(result.content);
}

export class ScriptedModel implements ModelClient {
	readonly requests: ModelRequest[] = [];
	private index = 0;

	constructor(private readonly steps: ScriptStep[]) {}

	async create(request: ModelRequest) {
		this.requests.push({ ...request, messages: [...request.messages] });
		const step = this.steps[this.index++];
		if (!step) throw new Error("scripted model has no more steps");
		const { content, stop_reason } = step(request);
		return {
			id: `msg_scripted_${this.index}`,
			type: "message",
			role: "assistant",
			model: "scripted",
			content,
			stop_reason,
			stop_sequence: null,
			usage: { input_tokens: 0, output_tokens: 0 },
		} as unknown as Anthropic.Beta.BetaMessage;
	}
}
