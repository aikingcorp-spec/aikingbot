// Copyright (c) 2026 AIKING. All rights reserved.
//
// Agent runtime: a provider-neutral tool-use loop. One `run` takes the
// conversation, asks the model, executes every requested tool (through the
// registry's permission gate and timeout), sends all results back in one
// user message, and repeats until the model ends its turn or a limit is hit.

import { CostTracker, type CostReport } from "./cost.ts";
import {
	type FallbackNote,
	type Message,
	type ModelClient,
	type ToolCallBlock,
	type ToolDefinition,
	type ToolResultBlock,
	textOf,
	type UsageEntry,
} from "./model.ts";
import type { Approver, ToolRegistry } from "./tools.ts";

/** Per-run hooks, for callers (such as a UI gateway) that serve many conversations with one runtime. */
export interface RunHooks {
	signal?: AbortSignal;
	onEvent?: (event: RuntimeEvent) => void;
	/** Approver for this run; replaces the registry policy's approver. */
	approver?: Approver;
}

export type RuntimeEvent =
	| { type: "text_start"; messageId: string }
	| { type: "text_delta"; messageId: string; delta: string }
	| { type: "text_end"; messageId: string }
	| { type: "text"; text: string }
	| { type: "step"; step: number }
	| { type: "tool_call"; id: string; name: string; input: unknown }
	| { type: "tool_result"; id: string; name: string; content: string; isError: boolean }
	| { type: "tool_limit"; id: string; name: string; reason: string }
	| { type: "model_fallback"; fallback: FallbackNote }
	| { type: "usage"; model: string; usage: UsageEntry[] };

export type RunStatus =
	| "completed"
	| "step_limit"
	| "tool_limit"
	| "max_tokens"
	| "refusal"
	| "context_exhausted";

export interface RunResult {
	status: RunStatus;
	/** Messages added by this run (assistant turns and tool results). */
	added: Message[];
	/** Text of the last assistant turn. */
	text: string;
	steps: number;
	toolCalls: number;
	/** Models that served each step, in order. */
	servedBy: string[];
	fallbacks: FallbackNote[];
	cost: CostReport;
}

export interface AgentRuntimeOptions {
	model: ModelClient;
	tools: ToolRegistry;
	system: string;
	/** Model requests per run. Default 12. */
	maxSteps?: number;
	/** Tool executions per run. Calls past the limit get an error result and the run ends. Default 40. */
	maxToolCalls?: number;
	/** Tool calls executed from one model turn. Extra calls get an error result. Default 8. */
	maxToolCallsPerStep?: number;
	onEvent?: (event: RuntimeEvent) => void;
}

export class AgentRuntime {
	private readonly maxSteps: number;
	private readonly maxToolCalls: number;
	private readonly maxPerStep: number;

	constructor(private readonly options: AgentRuntimeOptions) {
		this.maxSteps = options.maxSteps ?? 12;
		this.maxToolCalls = options.maxToolCalls ?? 40;
		this.maxPerStep = options.maxToolCallsPerStep ?? 8;
	}

	async run(history: readonly Message[], hooks: RunHooks = {}): Promise<RunResult> {
		const { model, tools, system } = this.options;
		const global = this.options.onEvent;
		const local = hooks.onEvent;
		const onEvent =
			global || local
				? (event: RuntimeEvent) => {
						global?.(event);
						local?.(event);
					}
				: undefined;
		const messages = [...history];
		const added: Message[] = [];
		const push = (m: Message) => {
			messages.push(m);
			added.push(m);
		};
		// The model sees name, description and schema; risk stays on our side.
		const definitions: ToolDefinition[] = tools
			.definitions()
			.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
		const cost = new CostTracker();
		const servedBy: string[] = [];
		const fallbacks: FallbackNote[] = [];
		let toolCalls = 0;
		let text = "";
		const result = (status: RunStatus, steps: number): RunResult => ({
			status,
			added,
			text,
			steps,
			toolCalls,
			servedBy,
			fallbacks,
			cost: cost.report(),
		});

		for (let step = 1; step <= this.maxSteps; step++) {
			hooks.signal?.throwIfAborted();
			onEvent?.({ type: "step", step });
			const messageId = `msg_${crypto.randomUUID()}`;
			let streaming = false;
			const response = await model.create(
				{ system, messages, tools: definitions },
				onEvent
					? {
							signal: hooks.signal,
							onTextDelta: (delta) => {
								if (!streaming) onEvent({ type: "text_start", messageId });
								streaming = true;
								onEvent({ type: "text_delta", messageId, delta });
							},
						}
					: { signal: hooks.signal },
			);
			hooks.signal?.throwIfAborted();
			if (streaming) onEvent?.({ type: "text_end", messageId });
			cost.add(response.usage);
			servedBy.push(response.model);
			onEvent?.({ type: "usage", model: response.model, usage: response.usage });
			for (const fallback of response.fallbacks) {
				fallbacks.push(fallback);
				onEvent?.({ type: "model_fallback", fallback });
			}
			// Append the full content unchanged: opaque blocks must round-trip.
			push({ role: "assistant", content: response.content });
			text = textOf(response.content);
			if (text) onEvent?.({ type: "text", text });

			switch (response.stopReason) {
				case "tool_use":
					break;
				case "pause":
					continue;
				case "max_tokens":
					return result("max_tokens", step);
				case "refusal":
					return result("refusal", step);
				case "context_exhausted":
					return result("context_exhausted", step);
				default:
					return result("completed", step);
			}

			const calls = response.content.filter((b): b is ToolCallBlock => b.type === "tool_call");
			let limitHit = false;
			const results = await Promise.all(
				calls.map(async (call, index): Promise<ToolResultBlock> => {
					const overRun = toolCalls + index >= this.maxToolCalls;
					const overStep = index >= this.maxPerStep;
					if (overRun || overStep) {
						const reason = overRun
							? `tool call limit for this run (${this.maxToolCalls}) reached`
							: `at most ${this.maxPerStep} tool calls run per turn`;
						if (overRun) limitHit = true;
						onEvent?.({ type: "tool_limit", id: call.id, name: call.name, reason });
						return { type: "tool_result", toolCallId: call.id, content: `Not run: ${reason}.`, isError: true };
					}
					onEvent?.({ type: "tool_call", id: call.id, name: call.name, input: call.input });
					const outcome = await tools.call(call.name, call.input, { approver: hooks.approver, toolCallId: call.id, signal: hooks.signal });
					onEvent?.({ type: "tool_result", id: call.id, name: call.name, ...outcome });
					return { type: "tool_result", toolCallId: call.id, content: outcome.content, isError: outcome.isError };
				}),
			);
			toolCalls += Math.min(calls.length, this.maxPerStep, Math.max(0, this.maxToolCalls - toolCalls));
			hooks.signal?.throwIfAborted();
			// Every call gets a result, in call order, in one user message.
			push({ role: "user", content: results });
			if (limitHit) return result("tool_limit", step);
		}
		return result("step_limit", this.maxSteps);
	}
}
