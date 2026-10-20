// Copyright (c) 2026 AIKING. All rights reserved.
//
// Offline stand-in for a real model, for the UI prototype: no API, no cost.
// It reads the conversation and makes the same tool calls a live model is
// expected to make for a media request:
//   plan_capabilities -> read_skill x3 -> frame_size + shot_timing
//   -> production brief -> submit_render (needs approval) -> summary
// Anything else gets a short answer listing what it can do. Text is streamed
// word by word so the UI shows streaming exactly as with a live model.

import type {
	ContentBlock,
	CreateOptions,
	Message,
	ModelClient,
	ModelRequest,
	ModelResponse,
	StopReason,
} from "../src/runtime/model.ts";

let callCounter = 0;
const call = (name: string, input: Record<string, unknown>): ContentBlock => ({
	type: "tool_call",
	id: `call_offline_${Date.now().toString(36)}_${++callCounter}`,
	name,
	input,
});

const MEDIA = /video|clip|reel|tiktok|short|ad\b|quảng cáo|render|brief/i;

interface Spec {
	ratio: string;
	longEdge: number;
	duration: number;
	shots: number;
	platform: string;
}

export function specFor(idea: string): Spec {
	const feed = /instagram feed|feed post|4:5/i.test(idea);
	const youtube = /youtube(?! shorts)|16:9|landscape/i.test(idea);
	const seconds = /(\d{1,3})\s*(?:-?\s*)(?:s\b|sec|second|giây)/i.exec(idea);
	const duration = Math.min(120, Math.max(5, Number(seconds?.[1] ?? 15)));
	return {
		ratio: feed ? "4:5" : youtube ? "16:9" : "9:16",
		longEdge: feed ? 1536 : 1920,
		duration,
		shots: Math.min(8, Math.max(3, Math.round(duration / 3))),
		platform: feed ? "Instagram feed" : youtube ? "YouTube" : "TikTok / Reels",
	};
}

/** Messages since the last plain user message, and that message's text. */
function currentTurn(messages: readonly Message[]): { idea: string; steps: Message[] } {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m?.role === "user" && typeof m.content === "string") return { idea: m.content, steps: messages.slice(i + 1) };
	}
	return { idea: "", steps: [] };
}

function resultsOf(message: Message | undefined): { content: string; isError: boolean }[] {
	if (!message || typeof message.content === "string") return [];
	return message.content.flatMap((b) => (b.type === "tool_result" ? [{ content: b.content, isError: b.isError }] : []));
}

export class OfflineProducerModel implements ModelClient {
	readonly provider = "offline-demo";

	constructor(private readonly chunkDelayMs = 25) {}

	async create(request: ModelRequest, options: CreateOptions = {}): Promise<ModelResponse> {
		const { content, stopReason } = this.turn(request);
		if (options.onTextDelta) {
			for (const block of content) {
				if (block.type !== "text") continue;
				for (const piece of block.text.match(/\S+\s*|\s+/g) ?? []) {
					if (this.chunkDelayMs > 0) await new Promise((r) => setTimeout(r, this.chunkDelayMs));
					options.onTextDelta(piece);
				}
			}
		}
		return {
			content,
			stopReason,
			model: "offline-demo",
			usage: [{ model: "offline-demo", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }],
			fallbacks: [],
		};
	}

	private turn(request: ModelRequest): { content: ContentBlock[]; stopReason: StopReason } {
		const { idea, steps } = currentTurn(request.messages);
		const done = (text: string) => ({ content: [{ type: "text", text } as ContentBlock], stopReason: "end_turn" as const });
		if (!MEDIA.test(idea)) {
			return done(
				[
					"I am running in offline demo mode (no model API).",
					"Ask me for a short video ad, for example: “15-second TikTok ad for our matte black tumbler, queue it for render”.",
					"I will plan which skills and tools to combine, write the brief, and ask before queueing the render.",
				].join(" "),
			);
		}
		const step = steps.filter((m) => m.role === "assistant").length;
		const spec = specFor(idea);
		switch (step) {
			case 0:
				return {
					content: [{ type: "text", text: "Let me find which skills and tools this needs." }, call("plan_capabilities", { task: idea })],
					stopReason: "tool_use",
				};
			case 1:
				return {
					content: [
						{ type: "text", text: "The plan combines three skills and three tools. Reading the skills first." },
						call("read_skill", { name: "media-request-analysis" }),
						call("read_skill", { name: "video-ad-script" }),
						call("read_skill", { name: "production-brief" }),
					],
					stopReason: "tool_use",
				};
			case 2:
				return {
					content: [
						{
							type: "text",
							text: `Requirements: platform ${spec.platform}; ${spec.duration} s; ${spec.ratio}; ${spec.shots} shots. Getting frame size and shot timing.`,
						},
						call("mcp__media__frame_size", { ratio: spec.ratio, long_edge: spec.longEdge }),
						call("mcp__media__shot_timing", { duration_s: spec.duration, shots: spec.shots }),
					],
					stopReason: "tool_use",
				};
			case 3: {
				const [sizeR, timingR] = resultsOf(steps.at(-1));
				if (!sizeR || !timingR || sizeR.isError || timingR.isError) {
					return done(`A media tool failed: ${sizeR?.content ?? "no result"} ${timingR?.content ?? ""}`.trim());
				}
				const size = JSON.parse(sizeR.content) as { width: number; height: number };
				const timing = JSON.parse(timingR.content) as { shot: number; start: number; end: number }[];
				const subject = idea.replace(/^.*?\bfor\s+(our\s+)?/i, "").split(/[,.]/)[0]?.trim() || "the product";
				const rows = timing.map((t, i) => {
					const beat =
						i === 0 ? `Hook: close-up of ${subject}, unexpected angle` : i === timing.length - 1 ? `Hero shot of ${subject}, name and call to action` : `Benefit ${i}: ${subject} in daily use`;
					return `| ${t.shot} | ${t.start}-${t.end}s | ${beat} |`;
				});
				const brief = [
					`Format: ${size.width}x${size.height}, ${spec.duration} s, ${timing.length} shots`,
					"",
					"| # | time | visual |",
					"| --- | --- | --- |",
					...rows,
					"",
					"Style: warm natural light, slow push-in, clean background",
					"Negative: other brands' logos, text artifacts, distorted hands",
				].join("\n");
				return {
					content: [
						{ type: "text", text: `Production brief:\n\n${brief}\n\nQueueing the render now; this needs your approval.` },
						call("mcp__media__submit_render", { title: subject.slice(0, 80), brief, width: size.width, height: size.height }),
					],
					stopReason: "tool_use",
				};
			}
			default: {
				const [render] = resultsOf(steps.at(-1));
				if (!render) return done("Done.");
				return done(
					render.isError
						? `The render was not queued: ${render.content.replace(/ Do not retry.*$/, "")}. The brief above is ready; approve the render when you want it.`
						: `Render queued: ${render.content}. You can follow it in the render jobs folder.`,
				);
			}
		}
	}
}
