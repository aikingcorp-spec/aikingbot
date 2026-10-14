// Copyright (c) 2026 AIKING. All rights reserved.
//
// Demo MCP server (stdio) built with the official MCP TypeScript SDK.
// Every tool declares MCP annotations (risk) and `_meta["aiking/capability"]`
// (tasks, inputs, outputs) so the core can discover and combine it.
//
// - frame_size     read-only  pixel size for an aspect ratio
// - shot_timing    read-only  split a video duration into shots
// - submit_render  side effect: writes a render job file to the jobs folder (no real rendering)
// - purge_renders  destructive: deletes every job file (always denied in the demo)

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

export function frameSize(ratio: string, longEdge: number): { width: number; height: number } {
	const match = /^(\d+):(\d+)$/.exec(ratio.trim());
	if (!match) throw new Error(`ratio must look like "16:9", got "${ratio}"`);
	const w = Number(match[1]);
	const h = Number(match[2]);
	if (w === 0 || h === 0) throw new Error("ratio parts must be greater than 0");
	const round8 = (n: number) => Math.max(8, Math.round(n / 8) * 8);
	return w >= h
		? { width: round8(longEdge), height: round8((longEdge * h) / w) }
		: { width: round8((longEdge * w) / h), height: round8(longEdge) };
}

/** Splits a duration into shots: a short hook, even middle beats, a fixed CTA. */
export function shotTiming(durationS: number, shots: number): { shot: number; start: number; end: number }[] {
	if (shots < 3) throw new Error("need at least 3 shots (hook, body, call to action)");
	const hook = Math.min(2, durationS / shots);
	const cta = Math.min(3, durationS / shots);
	const body = (durationS - hook - cta) / (shots - 2);
	const out: { shot: number; start: number; end: number }[] = [];
	let t = 0;
	for (let i = 1; i <= shots; i++) {
		const len = i === 1 ? hook : i === shots ? cta : body;
		out.push({ shot: i, start: round1(t), end: round1(t + len) });
		t += len;
	}
	return out;
}
const round1 = (n: number) => Math.round(n * 10) / 10;

const capability = (tasks: string[], inputs: string[], outputs: string[]) => ({
	"aiking/capability": { tasks, inputs, outputs },
});
const text = (value: unknown, isError = false) => ({
	content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }],
	...(isError ? { isError: true } : {}),
});

export function createMediaToolsServer(jobsDir = process.env.AIKING_JOBS_DIR ?? join(process.cwd(), ".aiking", "render-jobs")): McpServer {
	const server = new McpServer({ name: "aiking-media-tools", version: "0.2.0" });

	server.registerTool(
		"frame_size",
		{
			description: "Pixel width and height for an aspect ratio and a long edge, rounded to a multiple of 8.",
			inputSchema: {
				ratio: z.string().describe('Aspect ratio, for example "4:5" or "16:9".'),
				long_edge: z.number().int().min(64).max(8192).describe("Long edge in pixels."),
			},
			annotations: { readOnlyHint: true },
			_meta: capability(["output resolution for a platform aspect ratio"], [], ["frame-spec"]),
		},
		async ({ ratio, long_edge }) => {
			try {
				return text(frameSize(ratio, long_edge));
			} catch (error) {
				return text((error as Error).message, true);
			}
		},
	);

	server.registerTool(
		"shot_timing",
		{
			description: "Start and end second of each shot for a video of a given length.",
			inputSchema: {
				duration_s: z.number().min(3).max(600).describe("Video length in seconds."),
				shots: z.number().int().min(3).max(40).describe("Number of shots."),
			},
			annotations: { readOnlyHint: true },
			_meta: capability(["timing of shots in an edit"], [], ["shot-timing"]),
		},
		async ({ duration_s, shots }) => {
			try {
				return text(shotTiming(duration_s, shots));
			} catch (error) {
				return text((error as Error).message, true);
			}
		},
	);

	server.registerTool(
		"submit_render",
		{
			description: "Queue a render job from a finished production brief. Writes a job file; returns the job id.",
			inputSchema: {
				title: z.string().min(1).max(120),
				brief: z.string().min(1).describe("The full production brief."),
				width: z.number().int().min(64).max(8192),
				height: z.number().int().min(64).max(8192),
			},
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
			_meta: capability(["queue a render job"], ["production-brief"], ["render-job"]),
		},
		async ({ title, brief, width, height }) => {
			await mkdir(jobsDir, { recursive: true });
			const id = `job_${Date.now().toString(36)}`;
			await writeFile(join(jobsDir, `${id}.json`), `${JSON.stringify({ id, title, width, height, brief }, null, 2)}\n`);
			return text({ id, status: "queued" });
		},
	);

	server.registerTool(
		"purge_renders",
		{
			description: "Delete every queued render job.",
			inputSchema: {},
			annotations: { readOnlyHint: false, destructiveHint: true },
		},
		async () => {
			const files = await readdir(jobsDir).catch(() => []);
			await rm(jobsDir, { recursive: true, force: true });
			return text({ deleted: files.length });
		},
	);
	return server;
}

if (import.meta.main) {
	await createMediaToolsServer().connect(new StdioServerTransport());
}
