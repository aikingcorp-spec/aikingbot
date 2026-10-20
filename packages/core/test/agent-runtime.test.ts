// Copyright (c) 2026 AIKING. All rights reserved.

import { describe, expect, test } from "bun:test";
import { AgentRuntime, type RuntimeEvent } from "../src/runtime/agent-runtime.ts";
import type { StopReason, ToolResultBlock } from "../src/runtime/model.ts";
import { lastToolResult, ScriptedModel, textBlock, toolCall } from "../src/runtime/scripted-model.ts";
import { type ToolOutcome, ToolRegistry, type ToolRisk, type ToolSource } from "../src/runtime/tools.ts";
import { ChatSession, type TranscriptStore } from "../src/chat/chat-session.ts";
import type { Message } from "../src/runtime/model.ts";

function source(
	handlers: Record<string, (input: unknown) => ToolOutcome | Promise<ToolOutcome>>,
	risk: ToolRisk = "read",
): ToolSource {
	return {
		definitions: () =>
			Object.keys(handlers).map((name) => ({ name, risk, inputSchema: { type: "object" as const, properties: {} } })),
		call: async (name, input) => handlers[name]?.(input),
	};
}

const echo = source({ echo: (input) => ({ content: JSON.stringify(input), isError: false }) });
const resultsOf = (m: unknown) => (m as { content: ToolResultBlock[] }).content;

describe("AgentRuntime", () => {
	test("runs tools until the model ends its turn", async () => {
		const model = new ScriptedModel([
			() => ({ content: [toolCall("echo", { v: 1 })], stopReason: "tool_use" }),
			(req) => ({ content: [textBlock(`got ${lastToolResult(req)}`)], stopReason: "end_turn" }),
		]);
		const events: RuntimeEvent[] = [];
		const runtime = new AgentRuntime({
			model,
			tools: new ToolRegistry([echo]),
			system: "s",
			onEvent: (e) => events.push(e),
		});
		const result = await runtime.run([{ role: "user", content: "hi" }]);

		expect(result).toMatchObject({ status: "completed", text: 'got {"v":1}', steps: 2, toolCalls: 1 });
		expect(result.added.map((m) => m.role)).toEqual(["assistant", "user", "assistant"]);
		expect(events.filter((e) => ["tool_call", "tool_result", "text", "text_delta"].includes(e.type)).map((e) => e.type)).toEqual([
			"tool_call",
			"tool_result",
			"text_delta", // "got "
			"text_delta", // '{"v":1}'
			"text",
		]);
		// Risk is policy data and never sent to the model.
		expect(model.requests[0]?.tools).toEqual([{ name: "echo", description: undefined, inputSchema: { type: "object", properties: {} } }]);
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
			() => ({ content: [toolCall("slow", {}), toolCall("fast", {})], stopReason: "tool_use" }),
			() => ({ content: [textBlock("done")], stopReason: "end_turn" }),
		]);
		const result = await new AgentRuntime({ model, tools: new ToolRegistry([slow]), system: "s" }).run([
			{ role: "user", content: "go" },
		]);
		expect(resultsOf(result.added[1]).map((b) => b.content)).toEqual(["slow", "fast"]);
	});

	test("an unknown or throwing tool becomes an error result and the loop continues", async () => {
		const failing = source({
			boom: () => {
				throw new Error("disk full");
			},
		});
		const model = new ScriptedModel([
			() => ({ content: [toolCall("boom", {}), toolCall("missing", {})], stopReason: "tool_use" }),
			() => ({ content: [textBlock("recovered")], stopReason: "end_turn" }),
		]);
		const result = await new AgentRuntime({ model, tools: new ToolRegistry([failing]), system: "s" }).run([
			{ role: "user", content: "go" },
		]);
		const blocks = resultsOf(result.added[1]);
		expect(blocks.every((b) => b.isError)).toBe(true);
		expect(blocks[0]?.content).toContain("disk full");
		expect(result.status).toBe("completed");
	});

	test("stops at the step limit", async () => {
		const loop = () => ({ content: [toolCall("echo", {})], stopReason: "tool_use" as const });
		const model = new ScriptedModel([loop, loop, loop]);
		const result = await new AgentRuntime({ model, tools: new ToolRegistry([echo]), system: "s", maxSteps: 2 }).run([
			{ role: "user", content: "go" },
		]);
		expect(result.status).toBe("step_limit");
		expect(model.requests).toHaveLength(2);
	});

	test("caps tool calls per turn and per run; every call still gets a result", async () => {
		let runs = 0;
		const counter = source({ count: () => ((runs += 1), { content: "ok", isError: false }) });
		const three = () => ({
			content: [toolCall("count", {}), toolCall("count", {}), toolCall("count", {})],
			stopReason: "tool_use" as const,
		});
		const model = new ScriptedModel([three, three, () => ({ content: [textBlock("x")], stopReason: "end_turn" })]);
		const events: RuntimeEvent[] = [];
		const result = await new AgentRuntime({
			model,
			tools: new ToolRegistry([counter]),
			system: "s",
			maxToolCallsPerStep: 2,
			maxToolCalls: 3,
			onEvent: (e) => events.push(e),
		}).run([{ role: "user", content: "go" }]);

		expect(runs).toBe(3); // 2 in turn one (third over per-turn cap), 1 in turn two (run cap).
		expect(result.status).toBe("tool_limit");
		expect(result.toolCalls).toBe(3);
		expect(resultsOf(result.added[1]).map((b) => b.isError)).toEqual([false, false, true]);
		expect(resultsOf(result.added[3]).map((b) => b.isError)).toEqual([false, true, true]);
		expect(events.filter((e) => e.type === "tool_limit")).toHaveLength(3);
	});

	test.each([
		["max_tokens", "max_tokens"],
		["refusal", "refusal"],
		["context_exhausted", "context_exhausted"],
	] as const)("stop reason %s ends the run as %s without running tools", async (stopReason: StopReason, status) => {
		let called = false;
		const spy = source({ echo: () => ((called = true), { content: "", isError: false }) });
		const model = new ScriptedModel([() => ({ content: [toolCall("echo", {})], stopReason })]);
		const result = await new AgentRuntime({ model, tools: new ToolRegistry([spy]), system: "s" }).run([
			{ role: "user", content: "go" },
		]);
		expect(result.status).toBe(status);
		expect(called).toBe(false);
	});

	test("accumulates cost per served model and reports fallbacks", async () => {
		const usage = (model: string, i: number, o: number) => ({
			model,
			inputTokens: i,
			outputTokens: o,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
		const model = new ScriptedModel([
			() => ({
				content: [toolCall("echo", {})],
				stopReason: "tool_use",
				model: "claude-opus-5-5",
				usage: [usage("claude-opus-5-5", 1_000_000, 0)],
			}),
			() => ({
				content: [textBlock("ok")],
				stopReason: "end_turn",
				model: "claude-opus-5",
				usage: [usage("claude-opus-5-5", 0, 100_000), usage("claude-opus-5", 0, 1_000_000)],
				fallbacks: [{ from: "claude-opus-5-5", to: "claude-opus-5", reason: "refusal" }],
			}),
		]);
		const result = await new AgentRuntime({ model, tools: new ToolRegistry([echo]), system: "s" }).run([
			{ role: "user", content: "go" },
		]);
		expect(result.servedBy).toEqual(["claude-opus-5-5", "claude-opus-5"]);
		expect(result.fallbacks).toEqual([{ from: "claude-opus-5-5", to: "claude-opus-5", reason: "refusal" }]);
		// opus-5-5: 1M in x $4 + 0.1M out x $20 = 6; opus-5: 1M out x $25 = 25.
		expect(result.cost.usd).toBeCloseTo(31, 6);
		expect(result.cost.unpricedModels).toEqual([]);
	});

	test("rejects duplicate tool names across sources", () => {
		expect(() => new ToolRegistry([echo, echo]).definitions()).toThrow(/duplicate tool name/);
	});
});

describe("ChatSession images", () => {
	test("images reach every model call of their turn and the transcript keeps only a note", async () => {
		const model = new ScriptedModel([
			() => ({ content: [toolCall("echo", { v: 1 })], stopReason: "tool_use" }),
			() => ({ content: [textBlock("A red square.")], stopReason: "end_turn" }),
			() => ({ content: [textBlock("Still red.")], stopReason: "end_turn" }),
		]);
		const saved: Message[] = [];
		const store: TranscriptStore = { load: async () => [], append: async (messages) => { saved.push(...structuredClone(messages)); } };
		const session = await ChatSession.open(new AgentRuntime({ model, tools: new ToolRegistry([echo]), system: "s" }), store);
		const image = { type: "image" as const, mediaType: "image/png" as const, data: Buffer.from("png-bytes").toString("base64") };
		const result = await session.send("What colour is this?", undefined, [image]);
		expect(result.text).toBe("A red square.");
		for (const request of model.requests.slice(0, 2)) expect(request.messages[0]!.content).toEqual([image, { type: "text", text: "What colour is this?" }]);
		expect(JSON.stringify(saved)).not.toContain(image.data);
		expect(saved[0]).toEqual({ role: "user", content: [
			{ type: "text", text: "[Image attached earlier: image/png, 9 bytes. It was shown to the model only in that turn.]" },
			{ type: "text", text: "What colour is this?" },
		] });
		await session.send("And now?");
		expect(JSON.stringify(model.requests[2]!.messages)).not.toContain(image.data);
	});
});
