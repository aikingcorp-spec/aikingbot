// Copyright (c) 2026 AIKING. All rights reserved.
//
// Whole slice with a real stdio MCP process and real skill files:
// Chat -> Runtime -> read_skill -> MCP tool -> answer, then reload the chat.

import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/core.ts";
import { lastToolResult, ScriptedModel, textBlock, toolUseBlock } from "../src/runtime/scripted-model.ts";

const demo = join(import.meta.dir, "..", "demo");

test("chat uses a skill and an MCP tool, and the transcript survives a restart", async () => {
	const transcriptPath = join(await mkdtemp(join(tmpdir(), "aiking-chat-")), "chat.jsonl");
	const model = new ScriptedModel([
		(req) => {
			expect(req.system).toContain("- product-shot-brief:");
			return { content: [toolUseBlock("read_skill", { name: "product-shot-brief" })], stop_reason: "tool_use" };
		},
		(req) => {
			expect(lastToolResult(req)).toContain("mcp__media__frame_size");
			return {
				content: [toolUseBlock("mcp__media__frame_size", { ratio: "4:5", long_edge: 1536 })],
				stop_reason: "tool_use",
			};
		},
		(req) => ({ content: [textBlock(`Size from tool: ${lastToolResult(req)}`)], stop_reason: "end_turn" }),
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
