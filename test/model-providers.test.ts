// Copyright (c) 2026 AIKING. All rights reserved.
//
// Provider adapter, client-side fallback and cost, all without network:
// the Anthropic SDK client is replaced by a stub that returns recorded shapes.

import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicModel, toApiMessages } from "../src/runtime/anthropic-model.ts";
import { CostTracker } from "../src/runtime/cost.ts";
import { FallbackChainError, FallbackModel } from "../src/runtime/fallback-model.ts";
import { type ModelClient, ModelError, type ModelRequest, type ModelResponse } from "../src/runtime/model.ts";

const request: ModelRequest = {
	system: "s",
	messages: [{ role: "user", content: "hi" }],
	tools: [{ name: "echo", description: "Echo.", inputSchema: { type: "object", properties: {} } }],
};

function stubClient(respond: (params: Record<string, unknown>) => unknown) {
	const calls: Record<string, unknown>[] = [];
	const client = {
		beta: {
			messages: {
				create: async (params: Record<string, unknown>) => {
					calls.push(params);
					return respond(params);
				},
			},
		},
	} as unknown as Anthropic;
	return { client, calls };
}

const usage = (extra: Record<string, unknown> = {}) => ({
	input_tokens: 1000,
	output_tokens: 200,
	cache_read_input_tokens: 0,
	cache_creation_input_tokens: 0,
	...extra,
});

describe("AnthropicModel adapter", () => {
	test("maps the neutral request to the Messages API and back", async () => {
		const { client, calls } = stubClient(() => ({
			model: "claude-opus-5-5",
			stop_reason: "tool_use",
			content: [
				{ type: "thinking", thinking: "", signature: "sig" },
				{ type: "text", text: "checking", citations: null },
				{ type: "tool_use", id: "toolu_1", name: "echo", input: { a: 1 } },
			],
			usage: usage(),
		}));
		const response = await new AnthropicModel({ client }).create(request);

		const sent = calls[0] ?? {};
		expect(sent.model).toBe("claude-opus-5-5");
		expect(sent.tools).toEqual([{ name: "echo", description: "Echo.", input_schema: { type: "object", properties: {} } }]);
		expect(sent.fallbacks).toBe("default");
		expect(sent.betas).toEqual(["server-side-fallback-2026-07-01"]);

		expect(response.stopReason).toBe("tool_use");
		expect(response.content.map((b) => b.type)).toEqual(["opaque", "text", "tool_call"]);
		expect(response.content[2]).toEqual({ type: "tool_call", id: "toolu_1", name: "echo", input: { a: 1 } });
		expect(response.usage).toEqual([
			{ model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
		]);
		expect(response.fallbacks).toEqual([]);
	});

	test("opaque blocks round-trip to their own provider and are dropped for others", () => {
		const thinking = { type: "thinking", thinking: "", signature: "sig" };
		const api = toApiMessages([
			{
				role: "assistant",
				content: [
					{ type: "opaque", provider: "anthropic", data: thinking },
					{ type: "opaque", provider: "other", data: { x: 1 } },
					{ type: "tool_call", id: "t1", name: "echo", input: {} },
				],
			},
			{ role: "user", content: [{ type: "tool_result", toolCallId: "t1", content: "no", isError: true }] },
		]);
		expect(api).toEqual([
			{ role: "assistant", content: [thinking as never, { type: "tool_use", id: "t1", name: "echo", input: {} }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "no", is_error: true }] },
		]);
	});

	test("server-side refusal fallback: reports the switch and bills each model at its own rate", async () => {
		const { client } = stubClient(() => ({
			model: "claude-opus-5",
			stop_reason: "end_turn",
			content: [
				{
					type: "fallback",
					from: { model: "claude-opus-5-5" },
					to: { model: "claude-opus-5" },
					trigger: { type: "refusal" },
				},
				{ type: "text", text: "answer", citations: null },
			],
			usage: usage({
				iterations: [
					{ type: "message", model: "claude-opus-5-5", ...usage({ output_tokens: 50 }) },
					{ type: "fallback_message", model: "claude-opus-5", ...usage() },
				],
			}),
		}));
		const response = await new AnthropicModel({ client }).create(request);
		expect(response.model).toBe("claude-opus-5");
		expect(response.fallbacks).toEqual([{ from: "claude-opus-5-5", to: "claude-opus-5", reason: "refusal" }]);
		expect(response.usage.map((u) => [u.model, u.outputTokens])).toEqual([
			["claude-opus-5-5", 50],
			["claude-opus-5", 200],
		]);

		const cost = new CostTracker();
		cost.add(response.usage);
		// opus-5-5: 1000 x 4 + 50 x 20 = 5000 µ$ ; opus-5: 1000 x 5 + 200 x 25 = 10000 µ$
		expect(cost.report().usd).toBeCloseTo(0.015, 9);
	});

	test("a sticky fallback turn (no fallback block) is still reported", async () => {
		const { client } = stubClient(() => ({
			model: "claude-opus-5",
			stop_reason: "end_turn",
			content: [{ type: "text", text: "ok", citations: null }],
			usage: usage({ iterations: [{ type: "fallback_message", model: "claude-opus-5", ...usage() }] }),
		}));
		const response = await new AnthropicModel({ client }).create(request);
		expect(response.fallbacks).toEqual([{ from: "claude-opus-5-5", to: "claude-opus-5", reason: "refusal (sticky)" }]);
	});

	test("fallbacks can be turned off", async () => {
		const { client, calls } = stubClient(() => ({ model: "m", stop_reason: "end_turn", content: [], usage: usage() }));
		await new AnthropicModel({ client, fallbacks: false }).create(request);
		expect(calls[0]?.fallbacks).toBeUndefined();
		expect(calls[0]?.betas).toBeUndefined();
	});

	test.each([
		[401, "auth", false],
		[400, "invalid_request", false],
		[429, "rate_limit", true],
		[529, "overloaded", true],
		[500, "server", true],
	] as const)("HTTP %d becomes ModelError kind %s (retryable %s)", async (status, kind, retryable) => {
		const { client } = stubClient(() => {
			throw Anthropic.APIError.generate(status, { type: "error" }, `status ${status}`, new Headers());
		});
		const error = await new AnthropicModel({ client }).create(request).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ModelError);
		expect(error).toMatchObject({ kind, retryable, status, provider: "anthropic", model: "claude-opus-5-5" });
	});

	test("connection failures become network errors", async () => {
		const { client } = stubClient(() => {
			throw new Anthropic.APIConnectionError({ message: "ECONNRESET" });
		});
		const error = await new AnthropicModel({ client }).create(request).catch((e: unknown) => e);
		expect(error).toMatchObject({ kind: "network", retryable: true });
	});
});

function fake(provider: string, behave: () => ModelResponse | Promise<ModelResponse>): ModelClient & { calls: number } {
	return {
		provider,
		calls: 0,
		async create() {
			this.calls += 1;
			return behave();
		},
	};
}
const ok = (model: string): ModelResponse => ({
	content: [{ type: "text", text: `from ${model}` }],
	stopReason: "end_turn",
	model,
	usage: [{ model, inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }],
	fallbacks: [],
});
const fail = (kind: ModelError["kind"], model: string) => () => {
	throw new ModelError(kind, "p", model, `${kind}!`, kind === "auth" ? 401 : 529);
};

describe("FallbackModel (client-side chain)", () => {
	test("first model succeeds: no fallback, one attempt", async () => {
		const chain = new FallbackModel([
			{ client: fake("a", () => ok("m1")), model: "m1" },
			{ client: fake("b", () => ok("m2")), model: "m2" },
		]);
		const res = await chain.create(request);
		expect(res.model).toBe("m1");
		expect(res.fallbacks).toEqual([]);
		expect(chain.lastAttempts).toEqual([{ provider: "a", model: "m1", ok: true }]);
	});

	test("retryable error moves to the next model and records why", async () => {
		const logged: string[] = [];
		const second = fake("b", () => ok("m2"));
		const chain = new FallbackModel(
			[
				{ client: fake("a", fail("overloaded", "m1")), model: "m1" },
				{ client: second, model: "m2" },
			],
			(a) => logged.push(`${a.model}:${a.ok ? "ok" : a.error?.kind}`),
		);
		const res = await chain.create(request);
		expect(res.model).toBe("m2");
		expect(res.fallbacks).toEqual([{ from: "m1", to: "m2", reason: "overloaded" }]);
		expect(logged).toEqual(["m1:overloaded", "m2:ok"]);
		expect(second.calls).toBe(1);
	});

	test("non-retryable error stops the chain: no silent switch on bad credentials", async () => {
		const second = fake("b", () => ok("m2"));
		const chain = new FallbackModel([
			{ client: fake("a", fail("auth", "m1")), model: "m1" },
			{ client: second, model: "m2" },
		]);
		const error = await chain.create(request).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(FallbackChainError);
		expect((error as FallbackChainError).attempts).toEqual([
			{ provider: "a", model: "m1", ok: false, error: { kind: "auth", message: "auth!", status: 401 } },
		]);
		expect(second.calls).toBe(0);
	});

	test("all models failing reports every attempt", async () => {
		const chain = new FallbackModel([
			{ client: fake("a", fail("overloaded", "m1")), model: "m1" },
			{ client: fake("b", fail("rate_limit", "m2")), model: "m2" },
		]);
		const error = (await chain.create(request).catch((e: unknown) => e)) as FallbackChainError;
		expect(error.message).toBe("all models failed (a/m1: overloaded; b/m2: rate_limit)");
		expect(error.attempts).toHaveLength(2);
	});
});

describe("CostTracker", () => {
	test("unknown models are reported as unpriced, never guessed", () => {
		const cost = new CostTracker();
		cost.add([
			{ model: "claude-haiku-5-5", inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 },
			{ model: "gpt-x", inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
			{ model: "scripted", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
		]);
		const report = cost.report();
		expect(report.usd).toBeCloseTo(0.11, 9);
		expect(report.unpricedModels).toEqual(["gpt-x"]);
		expect(report.byModel.find((m) => m.model === "gpt-x")?.usd).toBeNull();
	});
});
