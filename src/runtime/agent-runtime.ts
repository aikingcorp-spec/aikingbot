// Copyright (c) 2026 AIKING. All rights reserved.
//
// Agent runtime: the tool-use loop of the Claude Messages API.
// One `run` takes the conversation, asks the model, executes every
// requested tool, sends all results back in one user message, and repeats
// until the model ends its turn or the step limit is reached.

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolRegistry } from "./tools.ts";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type Message = Anthropic.Beta.BetaMessage;
type Tool = Anthropic.Tool;

export interface ModelRequest {
	system: string;
	messages: MessageParam[];
	tools: Tool[];
}

/** The only thing the runtime needs from a model provider. */
export interface ModelClient {
	create(request: ModelRequest): Promise<Message>;
}

export type RuntimeEvent =
	| { type: "text"; text: string }
	| { type: "tool_call"; id: string; name: string; input: unknown }
	| { type: "tool_result"; id: string; name: string; content: string; isError: boolean };

export type RunStatus = "completed" | "step_limit" | "max_tokens" | "refusal" | "context_exhausted";

export interface RunResult {
	status: RunStatus;
	/** Messages added by this run (assistant turns and tool results). */
	added: MessageParam[];
	/** Text of the last assistant turn. */
	text: string;
	steps: number;
}

export interface AgentRuntimeOptions {
	model: ModelClient;
	tools: ToolRegistry;
	system: string;
	maxSteps?: number;
	onEvent?: (event: RuntimeEvent) => void;
}

function textOf(message: Message): string {
	return message.content
		.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
		.map((b) => b.text)
		.join("");
}

export class AgentRuntime {
	private readonly maxSteps: number;

	constructor(private readonly options: AgentRuntimeOptions) {
		this.maxSteps = options.maxSteps ?? 12;
	}

	async run(history: readonly MessageParam[]): Promise<RunResult> {
		const { model, tools, system, onEvent } = this.options;
		const messages = [...history];
		const added: MessageParam[] = [];
		const push = (m: MessageParam) => {
			messages.push(m);
			added.push(m);
		};
		const definitions = tools.definitions();
		let text = "";

		for (let step = 1; step <= this.maxSteps; step++) {
			const response = await model.create({ system, messages, tools: definitions });
			// Append the full content unchanged: thinking and other blocks must round-trip.
			push({ role: "assistant", content: response.content });
			text = textOf(response);
			if (text) onEvent?.({ type: "text", text });

			switch (response.stop_reason) {
				case "tool_use":
					break;
				case "pause_turn":
					continue;
				case "max_tokens":
					return { status: "max_tokens", added, text, steps: step };
				case "refusal":
					return { status: "refusal", added, text, steps: step };
				case "model_context_window_exceeded":
					return { status: "context_exhausted", added, text, steps: step };
				default:
					return { status: "completed", added, text, steps: step };
			}

			const calls = response.content.filter(
				(b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
			);
			const results = await Promise.all(
				calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
					onEvent?.({ type: "tool_call", id: call.id, name: call.name, input: call.input });
					const outcome = await tools.call(call.name, call.input);
					onEvent?.({ type: "tool_result", id: call.id, name: call.name, ...outcome });
					return {
						type: "tool_result",
						tool_use_id: call.id,
						content: outcome.content,
						...(outcome.isError ? { is_error: true } : {}),
					};
				}),
			);
			// All results go back in one user message, in call order.
			push({ role: "user", content: results });
		}
		return { status: "step_limit", added, text, steps: this.maxSteps };
	}
}
