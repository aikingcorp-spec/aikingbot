// Copyright (c) 2026 AIKING. All rights reserved.
//
// Whole slice with a real stdio MCP process and real skill files:
// Chat -> Runtime -> read_skill -> MCP tool -> answer, then reload the chat.

import { expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/core.ts";
import { lastToolResult, ScriptedModel, textBlock, toolCall } from "../src/runtime/scripted-model.ts";

const demo = join(import.meta.dir, "..", "demo");

test("chat uses a skill and an MCP tool, and the transcript survives a restart", async () => {
	const transcriptPath = join(await mkdtemp(join(tmpdir(), "aiking-chat-")), "chat.jsonl");
	const model = new ScriptedModel([
		(req) => {
			expect(req.system).toContain("- skill product-shot-brief:");
			return { content: [toolCall("read_skill", { name: "product-shot-brief" })], stopReason: "tool_use" };
		},
		(req) => {
			expect(lastToolResult(req)).toContain("mcp__media__frame_size");
			return {
				content: [toolCall("mcp__media__frame_size", { ratio: "4:5", long_edge: 1536 })],
				stopReason: "tool_use",
			};
		},
		(req) => ({ content: [textBlock(`Size from tool: ${lastToolResult(req)}`)], stopReason: "end_turn" }),
	]);
	const mcpServers = { media: { command: process.execPath, args: [join(demo, "media-tools-server.ts")] } };

	const core = await createCore({ model, skillsDir: join(demo, "skills"), mcpServers, transcriptPath });
	try {
		expect(core.warnings).toEqual([]);
		const result = await core.chat.send("brief for a tumbler");
		expect(result.status).toBe("completed");
		expect(result.text).toBe('Size from tool: {"width":1232,"height":1536}');
		expect(core.chat.messages()).toHaveLength(6);
	} finally {
		await core.close();
	}

	const reopened = await createCore({ model: new ScriptedModel([]), transcriptPath });
	expect(reopened.chat.messages()).toHaveLength(6);
	await reopened.close();
});

test("a failed model request leaves no half turn in the history", async () => {
	const core = await createCore({ model: new ScriptedModel([]) });
	await expect(core.chat.send("hi")).rejects.toThrow(/no more steps/);
	expect(core.chat.messages()).toHaveLength(0);
	await core.close();
});

test("a server that cannot start is a warning, not a crash", async () => {
	const core = await createCore({
		model: new ScriptedModel([]),
		mcpServers: { broken: { command: join(demo, "does-not-exist") } },
	});
	expect(core.warnings[0]).toContain('MCP server "broken" not connected');
	await core.close();
});

test("media pipeline demo: plan -> skills -> MCP tools -> gated render, offline", async () => {
	const { scriptedMediaProducer, IDEA } = await import("../demo/run-demo.ts");
	const jobsDir = await mkdtemp(join(tmpdir(), "aiking-jobs-"));
	const approvals: string[] = [];
	const called: string[] = [];
	const core = await createCore({
		model: scriptedMediaProducer(),
		skillsDir: join(demo, "skills"),
		mcpServers: {
			media: {
				command: process.execPath,
				args: [join(demo, "media-tools-server.ts")],
				env: { ...(process.env as Record<string, string>), AIKING_JOBS_DIR: jobsDir },
			},
		},
		toolPolicy: { approver: ({ tool }) => (approvals.push(tool), true) },
		onEvent: (e) => {
			if (e.type === "tool_call") called.push(e.name);
		},
	});
	try {
		const result = await core.chat.send(IDEA);
		expect(result.status).toBe("completed");
		expect(new Set(called)).toEqual(
			new Set([
				"plan_capabilities",
				"read_skill",
				"mcp__media__frame_size",
				"mcp__media__shot_timing",
				"mcp__media__submit_render",
				"mcp__media__purge_renders",
			]),
		);
		// Only the side-effect tool reached the approver; the destructive one was denied without asking.
		expect(approvals).toEqual(["mcp__media__submit_render"]);
		expect(result.text).toContain("Render queued");
		expect(result.text).toContain("Cleanup of old renders was not run: Permission denied");
		expect(await readdir(jobsDir)).toHaveLength(1);
	} finally {
		await core.close();
	}
});
