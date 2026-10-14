// Copyright (c) 2026 AIKING. All rights reserved.
//
// End-to-end demo of the vertical slice:
//   Chat -> Agent Runtime -> read_skill -> MCP tool (real stdio server) -> answer
//
// `bun run demo`          offline: scripted model, real MCP process, real skill files
// `bun run demo --live`   Claude API (needs ANTHROPIC_API_KEY or an `ant auth login` profile)
//
// Writes a report to .aiking/demo-report.json.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCore } from "../src/core.ts";
import type { ModelClient, RuntimeEvent } from "../src/runtime/agent-runtime.ts";
import { AnthropicModel } from "../src/runtime/anthropic-model.ts";
import { lastToolResult, ScriptedModel, textBlock, toolUseBlock } from "../src/runtime/scripted-model.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const live = process.argv.includes("--live");

function scriptedProductShot(): ModelClient {
	return new ScriptedModel([
		() => ({ content: [toolUseBlock("read_skill", { name: "product-shot-brief" })], stop_reason: "tool_use" }),
		() => ({
			content: [toolUseBlock("mcp__media__frame_size", { ratio: "4:5", long_edge: 1536 })],
			stop_reason: "tool_use",
		}),
		(request) => {
			const { width, height } = JSON.parse(lastToolResult(request)) as { width: number; height: number };
			return {
				content: [
					textBlock(
						[
							`Size: ${width} x ${height}`,
							"Prompt: Matte black ceramic coffee tumbler, fine speckled glaze, soft key light from the left with a gentle rim light, seamless warm beige background, 85mm product photography, shallow depth of field.",
							"Negative: hands, text, logo, extra props, clutter, distortion",
						].join("\n"),
					),
				],
				stop_reason: "end_turn",
			};
		},
	]);
}

const events: RuntimeEvent[] = [];
const core = await createCore({
	model: live ? new AnthropicModel() : scriptedProductShot(),
	skillsDir: join(here, "skills"),
	mcpServers: { media: { command: process.execPath, args: [join(here, "media-tools-server.ts")] } },
	transcriptPath: join(root, ".aiking", "demo-transcript.jsonl"),
	onEvent: (event) => {
		events.push(event);
		if (event.type === "tool_call") console.log(`→ ${event.name} ${JSON.stringify(event.input)}`);
		if (event.type === "tool_result") console.log(`← ${event.isError ? "ERROR " : ""}${event.content.split("\n")[0]}`);
	},
});

try {
	for (const warning of core.warnings) console.warn(`warning: ${warning}`);
	console.log(`model: ${live ? "Claude API" : "scripted (offline)"}`);
	console.log(`skills: ${core.skills.list().map((s) => s.name).join(", ")}`);
	console.log(`MCP tools: ${core.mcp.definitions().map((t) => t.name).join(", ")}\n`);

	const prompt = "Write a product shot brief for a matte black ceramic coffee tumbler, Instagram feed post.";
	console.log(`user: ${prompt}\n`);
	const result = await core.chat.send(prompt);
	console.log(`\nassistant (${result.status}, ${result.steps} steps):\n${result.text}`);

	const report = {
		mode: live ? "live" : "scripted",
		status: result.status,
		steps: result.steps,
		toolCalls: events.filter((e) => e.type === "tool_call").map((e) => e.type === "tool_call" && e.name),
		toolErrors: events.filter((e) => e.type === "tool_result" && e.isError).length,
		answer: result.text,
	};
	await mkdir(join(root, ".aiking"), { recursive: true });
	await writeFile(join(root, ".aiking", "demo-report.json"), `${JSON.stringify(report, null, 2)}\n`);
	console.log("\nreport: .aiking/demo-report.json");
} finally {
	await core.close();
}
