// Copyright (c) 2026 AIKING. All rights reserved.

import { describe, expect, test } from "bun:test";
import { type GuardEvent, PermissionGate, type PermissionRequest, ToolRegistry, type ToolRisk, type ToolSource } from "../src/runtime/tools.ts";

function tool(name: string, risk: ToolRisk, onRun: () => void = () => {}): ToolSource {
	return {
		definitions: () => [{ name, risk, inputSchema: { type: "object" } }],
		call: async (n) => (n === name ? (onRun(), { content: "ran", isError: false }) : undefined),
	};
}
const req = (tool: string, risk: ToolRisk): PermissionRequest => ({ tool, risk, input: {} });

describe("PermissionGate", () => {
	test("read tools run without asking", async () => {
		expect(await new PermissionGate().check(req("t", "read"))).toEqual({ allowed: true });
	});

	test("side effects are denied when no approver is configured (safe default)", async () => {
		const d = await new PermissionGate().check(req("write", "side_effect"));
		expect(d).toMatchObject({ allowed: false });
	});

	test("side effects follow the approver's answer; preapproved names skip it", async () => {
		const asked: string[] = [];
		const gate = new PermissionGate({
			preapproved: ["safe_write"],
			approver: ({ tool }) => (asked.push(tool), tool === "yes"),
		});
		expect(await gate.check(req("yes", "side_effect"))).toEqual({ allowed: true });
		expect(await gate.check(req("no", "side_effect"))).toMatchObject({ allowed: false, reason: 'approval for "no" was declined' });
		expect(await gate.check(req("safe_write", "side_effect"))).toEqual({ allowed: true });
		expect(asked).toEqual(["yes", "no"]);
	});

	test("dangerous tools are denied without asking unless policy enables them", async () => {
		let asked = 0;
		const approver = () => (asked++, true);
		const gate = new PermissionGate({ approver, preapproved: ["rm"] });
		expect(await gate.check(req("rm", "dangerous"))).toMatchObject({ allowed: false });
		expect(asked).toBe(0); // preapproved never applies to dangerous tools

		const enabled = new PermissionGate({ approver, allowDangerous: ["rm"] });
		expect(await enabled.check(req("rm", "dangerous"))).toEqual({ allowed: true });
		expect(asked).toBe(1); // still asked every time
	});

	test("an approver that throws denies", async () => {
		const gate = new PermissionGate({
			approver: () => {
				throw new Error("UI closed");
			},
		});
		expect(await gate.check(req("w", "side_effect"))).toEqual({ allowed: false, reason: "approver failed: UI closed" });
	});
});

describe("ToolRegistry guard", () => {
	test("a denied tool never runs, returns an error result and emits an event", async () => {
		let ran = false;
		const events: GuardEvent[] = [];
		const registry = new ToolRegistry([tool("deploy", "side_effect", () => (ran = true))], {}, (e) => events.push(e));
		const outcome = await registry.call("deploy", {});
		expect(ran).toBe(false);
		expect(outcome.isError).toBe(true);
		expect(outcome.content).toStartWith("Permission denied:");
		expect(events).toEqual([
			{ type: "denied", tool: "deploy", risk: "side_effect", reason: '"deploy" needs approval and no approver is configured' },
		]);
	});

	test("approved side effect runs", async () => {
		let ran = false;
		const registry = new ToolRegistry([tool("deploy", "side_effect", () => (ran = true))], { approver: () => true });
		expect(await registry.call("deploy", {})).toEqual({ content: "ran", isError: false });
		expect(ran).toBe(true);
	});

	test("timeout per tool and output cap", async () => {
		const slow: ToolSource = {
			definitions: () => [{ name: "slow", risk: "read", inputSchema: { type: "object" } }],
			call: async (_n, _i, ctx) => {
				await new Promise((r) => setTimeout(r, 500));
				return { content: ctx.signal.aborted ? "aborted" : "late", isError: false };
			},
		};
		const big: ToolSource = {
			definitions: () => [{ name: "big", risk: "read", inputSchema: { type: "object" } }],
			call: async () => ({ content: "x".repeat(100), isError: false }),
		};
		const registry = new ToolRegistry([slow, big], { timeoutMs: 10_000, timeouts: { slow: 20 }, maxOutputChars: 10 });
		expect((await registry.call("slow", {})).content).toBe('Tool "slow" failed: tool "slow" timed out after 20 ms');
		expect((await registry.call("big", {})).content).toBe(`${"x".repeat(10)}\n[truncated]`);
	});
});
