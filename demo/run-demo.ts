// Copyright (c) 2026 AIKING. All rights reserved.
//
// Media production demo:
//   idea -> analyze requirements -> choose skills (plan_capabilities)
//        -> write brief (skills) -> MCP tools (real stdio server) -> render job
//
// `bun run demo`            offline: scripted model, real MCP process, real skill files
// `bun run demo --deny`     same, but the operator declines the render (shows the gate)
// `bun run demo --live`     Claude API (needs credentials; spends API credits)
//
// Side-effect tools go through the permission gate. In the offline demo the
// "operator" is a function that approves submit_render (or declines with
// --deny). purge_renders is destructive and is denied without asking.
// Writes a report to .aiking/demo-report.json.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCore } from "../src/core.ts";
import type { RuntimeEvent } from "../src/runtime/agent-runtime.ts";
import { AnthropicModel } from "../src/runtime/anthropic-model.ts";
import type { ModelClient } from "../src/runtime/model.ts";
import { lastToolResult, ScriptedModel, textBlock, toolCall, toolResults } from "../src/runtime/scripted-model.ts";
import type { GuardEvent } from "../src/runtime/tools.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const live = process.argv.includes("--live");
const deny = process.argv.includes("--deny");
const jobsDir = join(root, ".aiking", "render-jobs");

export const IDEA =
	"Idea: a 15-second TikTok video ad for our matte black ceramic tumbler product that keeps coffee hot for 6 hours. Make the brief and queue it for render.";

/** Scripted stand-in for the model: the same tool calls a live model is expected to make. */
export function scriptedMediaProducer(): ModelClient {
	let size = { width: 0, height: 0 };
	let timing: { shot: number; start: number; end: number }[] = [];
	return new ScriptedModel([
		// 1. Choose skills and tools for the whole job.
		() => ({ content: [toolCall("plan_capabilities", { task: IDEA })], stopReason: "tool_use" }),
		// 2. Read every skill in the plan (parallel calls).
		() => ({
			content: [
				textBlock("Plan found. Reading the skills it uses."),
				toolCall("read_skill", { name: "media-request-analysis" }),
				toolCall("read_skill", { name: "video-ad-script" }),
				toolCall("read_skill", { name: "production-brief" }),
			],
			stopReason: "tool_use",
		}),
		// 3. Requirements (TikTok default: 9:16, 1920, 15 s, 5 shots) -> tool inputs.
		() => ({
			content: [
				textBlock(
					[
						"Requirements: product matte black ceramic tumbler; platform TikTok; video 15 s; 9:16 (default);",
						"long edge 1920 (default); 5 shots (default); audience commuters and office workers; goal: show heat retention.",
					].join(" "),
				),
				toolCall("mcp__media__frame_size", { ratio: "9:16", long_edge: 1920 }),
				toolCall("mcp__media__shot_timing", { duration_s: 15, shots: 5 }),
			],
			stopReason: "tool_use",
		}),
		// 4. Script + brief from tool results, then queue the render (side effect -> approval).
		(request) => {
			const [sizeText = "{}", timingText = "[]"] = toolResults(request);
			size = JSON.parse(sizeText);
			timing = JSON.parse(timingText);
			const beats = [
				["Steam rises from the tumbler on a cold window sill at 6 am", "Coffee at 6 am..."],
				["Close-up of the speckled matte black glaze, a hand wraps around it", "Double-wall ceramic."],
				["Office desk, clock reads 12:00, lid opens, steam still rising", "...still hot at noon."],
				["Commuter on a train sips and smiles", "No microwave trips."],
				["Tumbler hero shot, name on screen", "Keep it hot. Shop now."],
			];
			const shots = timing.map((t, i) => `| ${t.shot} | ${t.start}-${t.end}s | ${beats[i]?.[0]} | ${beats[i]?.[1]} |`);
			const brief = [
				`Format: ${size.width}x${size.height}, 15 s, ${timing.length} shots`,
				"Shots:",
				"| # | time | visual | voiceover |",
				...shots,
				"Style: warm morning light, black and amber palette, slow push-in, lo-fi beat",
				"Negative: logos of other brands, text artifacts, extra cups, distorted hands",
			].join("\n");
			return {
				content: [
					textBlock(`Production brief:\n${brief}`),
					toolCall("mcp__media__submit_render", {
						title: "Tumbler TikTok 15s",
						brief,
						width: size.width,
						height: size.height,
					}),
					toolCall("mcp__media__purge_renders", {}),
				],
				stopReason: "tool_use",
			};
		},
		// 5. Report the outcome, including any denial.
		(request) => {
			const [render = "", purge = ""] = toolResults(request);
			const rendered = render.startsWith("{") ? `Render queued: ${render}` : `Render not queued: ${render}`;
			return {
				content: [
					textBlock(
						[
							`Done. Frame ${size.width}x${size.height}, ${timing.length} shots.`,
							rendered,
							`Cleanup of old renders was not run: ${purge || lastToolResult(request)}`,
						].join("\n"),
					),
				],
				stopReason: "end_turn",
			};
		},
	]);
}

if (import.meta.main) {
	const events: RuntimeEvent[] = [];
	const guard: GuardEvent[] = [];
	const approvals: { tool: string; approved: boolean }[] = [];
	await rm(join(root, ".aiking", "demo-transcript.jsonl"), { force: true });

	const core = await createCore({
		model: live ? new AnthropicModel() : scriptedMediaProducer(),
		skillsDir: join(here, "skills"),
		mcpServers: {
			media: {
				command: process.execPath,
				args: [join(here, "media-tools-server.ts")],
				env: { ...(process.env as Record<string, string>), AIKING_JOBS_DIR: jobsDir },
			},
		},
		transcriptPath: join(root, ".aiking", "demo-transcript.jsonl"),
		toolPolicy: {
			timeoutMs: 10_000,
			approver: ({ tool, risk }) => {
				const approved = !deny && tool === "mcp__media__submit_render";
				approvals.push({ tool, approved });
				console.log(`? approval ${risk} ${tool}: ${approved ? "APPROVED" : "DECLINED"} by demo operator`);
				return approved;
			},
		},
		onEvent: (event) => {
			events.push(event);
			if (event.type === "tool_call") console.log(`→ ${event.name} ${JSON.stringify(event.input).slice(0, 100)}`);
			if (event.type === "tool_result") {
				console.log(`← ${event.isError ? "ERROR " : ""}${event.content.split("\n").slice(0, 8).join("\n  ")}`);
			}
			if (event.type === "model_fallback") console.log(`! fallback ${event.fallback.from} → ${event.fallback.to}`);
		},
		onGuard: (event) => {
			guard.push(event);
			console.log(`! ${event.type}: ${event.tool}${event.type === "denied" ? ` (${event.reason})` : ""}`);
		},
	});

	try {
		for (const warning of core.warnings) console.warn(`warning: ${warning}`);
		console.log(`model: ${live ? "Claude API" : "scripted (offline)"}`);
		console.log(`capabilities:\n${core.capabilities.catalog()}\n`);
		console.log(`user: ${IDEA}\n`);
		const result = await core.chat.send(IDEA);
		console.log(`\nassistant (${result.status}, ${result.steps} steps, ${result.toolCalls} tool calls):\n${result.text}`);
		console.log(`cost: $${result.cost.usd.toFixed(4)}${result.cost.unpricedModels.length ? ` (unpriced: ${result.cost.unpricedModels.join(", ")})` : ""}`);

		const report = {
			mode: live ? "live" : "scripted",
			status: result.status,
			steps: result.steps,
			toolCalls: events.flatMap((e) => (e.type === "tool_call" ? [e.name] : [])),
			toolErrors: events.filter((e) => e.type === "tool_result" && e.isError).length,
			approvals,
			guard,
			servedBy: result.servedBy,
			fallbacks: result.fallbacks,
			cost: result.cost,
			answer: result.text,
		};
		await mkdir(join(root, ".aiking"), { recursive: true });
		await writeFile(join(root, ".aiking", "demo-report.json"), `${JSON.stringify(report, null, 2)}\n`);
		console.log("\nreport: .aiking/demo-report.json");
	} finally {
		await core.close();
	}
}
