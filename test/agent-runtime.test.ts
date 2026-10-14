// Copyright (c) 2026 AIKING. All rights reserved.

import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { AgentRuntime, type RuntimeEvent } from "../src/runtime/agent-runtime.ts";
import { lastToolResult, ScriptedModel, textBlock, toolUseBlock } from "../src/runtime/scripted-model.ts";
import { type ToolOutcome, ToolRegistry, type ToolSource } from "../src/runtime/tools.ts";

function source(handlers: Record<string, (input: unknown) => ToolOutcome | Promise<ToolOutcome>>): ToolSource {
	return {
		definitions: () =>
			Object.keys(handlers).map((name) => ({ name, input_schema: { type: "object" as const, properties: {} } })),
		call: async (name, input) => handlers[name]?.(input),
	};
}

const echo = source({ echo: (input) => ({ content: JSON.stringify(input), isError: false }) });

describe("AgentRuntime", () => {
	test("runs tools until the model ends its turn", async () => {
		const model = new ScriptedModel([
			() => ({ content: [toolUseBlock("echo", { v: 1 })], stop_reason: "tool_use" }),
			(req) => ({ content: [textBlock(`got ${lastToolResult(req)}`)], stop_reason: "end_turn" }),
		]);
		const events: RuntimeEvent[] = [];
		const runtime = new AgentRuntime({
			model,
			tools: new ToolRegistry([echo]),
			system: "s",
			onEvent: (e) => events.push(e),
		});
		const result = await runtime.run([{ role: "user", content: "hi" }]);

		expect(result).toMatchObject({ status: "completed", text: 'got {"v":1}', steps: 2 });
		expect(result.added.map((m) => m.role)).toEqual(["assistant", "user", "assistant"]);
		expect(events.map((e) => e.type)).toEqual(["tool_call", "tool_result", "text"]);
		expect(model.requests[0]?.tools.map((t) => t.name)).toEqual(["echo"]);
	});

	test("returns all parallel tool results in one user message, in call order", async () => {
		const slow = source({
			slow: async () => {
				await Bun.sleep(5);
				return { content: "slow", isError: false };
			},
			fast: () => ({ content: "fast", isError: false }),
		});
		const model = new ScriptedModel([
			() => ({ content: [toolUseBlock("slow", {}), toolUseBlock("fast", {})], stop_reason: "tool_use" }),
			() => ({ content: [textBlock("done")], stop_reason: "end_turn" }),
		]);
		const result = await new AgentRuntime({ model, tools: new ToolRegistry([slow]), system: "s" }).run([
			{ role: "user", content: "go" },
		]);
		const toolMessage = result.added[1] as Anthropic.Beta.BetaMessageParam;
		const blocks = toolMessage.content as Anthropic.Beta.BetaToolResultBlockParam[];
		expect(blocks.map((b) => b.content)).toEqual(["slow", "fast"]);
	});

	test("an unknown or throwing tool becomes an is_error result and the loop continues", async () => {
		const failing = source({
			boom: () => {
				throw new Error("disk full");
			},
		});
		const model = new ScriptedModel([
			() => ({ content: [toolUseBlock("boom", {}), toolUseBlock("missing", {})], stop_reason: "tool_use" }),
			() => ({ content: [textBlock("recovered")], stop_reason: "end_turn" }),
		]);
		const result = await new AgentRuntime({ model, tools: new ToolRegistry([failing]), system: "s" }).run([
			{ role: "user", content: "go" },
		]);
		const blocks = result.added[1]?.content as Anthropic.Beta.BetaToolResultBlockParam[];
		expect(blocks.every((b) => b.is_error === true)).toBe(true);
		expect(blocks[0]?.content).toContain("disk full");
		expect(result.status).toBe("completed");
	});

	test("stops at the step limit", async () => {
		const loop = () => ({ content: [toolUseBlock("echo", {})], stop_reason: "tool_use" as const });
		const model = new ScriptedModel([loop, loop, loop]);
		const result = await new AgentRuntime({ model, tools: new ToolRegistry([echo]), system: "s", maxSteps: 2 }).run([
			{ role: "user", content: "go" },
		]);
		expect(result.status).toBe("step_limit");
		expect(model.requests).toHaveLength(2);
	});

	test.each([
		["max_tokens", "max_tokens"],
		["refusal", "refusal"],
		["model_context_window_exceeded", "context_exhausted"],
	] as const)("stop_reason %s ends the run as %s without running tools", async (stopReason, status) => {
		let called = false;
		const spy = source({ echo: () => ((called = true), { content: "", isError: false }) });
		const model = new ScriptedModel([() => ({ content: [toolUseBlock("echo", {})], stop_reason: stopReason })]);
		const result = await new AgentRuntime({ model, tools: new ToolRegistry([spy]), system: "s" }).run([
			{ role: "user", content: "go" },
		]);
		expect(result.status).toBe(status);
		expect(called).toBe(false);
	});

	test("rejects duplicate tool names across sources", () => {
		expect(() => new ToolRegistry([echo, echo]).definitions()).toThrow(/duplicate tool name/);
	});
});
