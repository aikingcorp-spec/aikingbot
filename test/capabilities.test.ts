// Copyright (c) 2026 AIKING. All rights reserved.
//
// Capability discovery: the plan for a compound task must combine several
// skills and tools through their inputs and outputs, not by keyword alone.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CapabilityIndex, terms } from "../src/capabilities/capability-index.ts";
import { CapabilityTools } from "../src/capabilities/capability-tools.ts";
import { McpHub } from "../src/mcp/mcp-hub.ts";
import { parseSkillFile, SkillFormatError, SkillLibrary } from "../src/skills/skill-library.ts";

const demo = join(import.meta.dir, "..", "demo");
let hub: McpHub;
let index: CapabilityIndex;

beforeAll(async () => {
	const { library, errors } = await SkillLibrary.load(join(demo, "skills"));
	expect(errors).toEqual([]);
	hub = new McpHub();
	await hub.connectStdio("media", { command: process.execPath, args: [join(demo, "media-tools-server.ts")] });
	index = CapabilityIndex.from(library, hub.toolInfo());
});
afterAll(() => hub.close());

const TASK = "Make a 15-second TikTok video ad for our matte black tumbler product, then queue it for render.";

describe("skill capability front matter", () => {
	test("parses tasks, inputs and outputs", () => {
		const skill = parseSkillFile(
			"x",
			"---\nname: a\ndescription: d\ntasks: [write things]\ninputs: [idea]\noutputs: [draft]\n---\nbody",
		);
		expect(skill.capability).toEqual({ tasks: ["write things"], inputs: ["idea"], outputs: ["draft"] });
	});

	test("rejects artifact names that are not slugs", () => {
		expect(() => parseSkillFile("x", "---\nname: a\ndescription: d\noutputs: [Big Draft]\n---\n")).toThrow(SkillFormatError);
	});

	test("skills without capability fields stay valid", () => {
		expect(parseSkillFile("x", "---\nname: a\ndescription: d\n---\n").capability).toBeUndefined();
	});
});

describe("CapabilityIndex", () => {
	test("indexes skills and MCP tools with what they need and make", () => {
		expect(index.get("production-brief")).toMatchObject({
			kind: "skill",
			inputs: ["ad-script", "frame-spec", "shot-timing"],
			outputs: ["production-brief"],
		});
		expect(index.get("mcp__media__frame_size")).toMatchObject({ kind: "tool", outputs: ["frame-spec"], risk: "read" });
		expect(index.get("mcp__media__submit_render")).toMatchObject({ risk: "side_effect" });
	});

	test("keyword matching alone misses the tools the task needs", () => {
		const matched = index.match(TASK).map((m) => m.capability.id);
		expect(matched).not.toContain("mcp__media__frame_size");
		// ...and it picks up a distractor that shares the word "product".
		expect(matched).toContain("product-shot-brief");
	});

	test("compound task: the plan chains at least 3 different capabilities across skills and tools", () => {
		const plan = index.plan(TASK);
		const ids = plan.steps.map((s) => s.capability.id);

		expect(plan.deliverable).toBe("render-job");
		expect(plan.missing).toEqual([]);
		expect(ids).toEqual([
			"media-request-analysis",
			"video-ad-script",
			"mcp__media__frame_size",
			"mcp__media__shot_timing",
			"production-brief",
			"mcp__media__submit_render",
		]);
		expect(new Set(plan.steps.map((s) => s.capability.kind))).toEqual(new Set(["skill", "tool"]));
		// Pulled in by the artifact graph, not by keywords.
		expect(plan.steps.find((s) => s.capability.id === "mcp__media__frame_size")?.reason).toBe(
			'produces "frame-spec" needed by production-brief',
		);
		expect(plan.steps.find((s) => s.capability.id === "production-brief")?.inputsFrom).toEqual({
			"ad-script": "video-ad-script",
			"frame-spec": "mcp__media__frame_size",
			"shot-timing": "mcp__media__shot_timing",
		});
		// The keyword distractor is not part of the plan.
		expect(ids).not.toContain("product-shot-brief");
	});

	test("every step's inputs are available before it runs", () => {
		const plan = index.plan(TASK);
		const have = new Set(["idea"]);
		for (const step of plan.steps) {
			for (const input of step.capability.inputs) expect(have.has(input)).toBe(true);
			for (const output of step.capability.outputs) have.add(output);
		}
	});

	test("artifacts already in hand are not produced again", () => {
		const plan = index.plan(TASK, { deliverable: "production-brief", have: ["ad-script"] });
		const ids = plan.steps.map((s) => s.capability.id);
		expect(ids).not.toContain("video-ad-script");
		expect(ids).not.toContain("media-request-analysis");
		expect(ids.at(-1)).toBe("production-brief");
	});

	test("an artifact nothing can produce is reported as missing", () => {
		const plan = index.plan("anything", { deliverable: "voice-over-audio" });
		expect(plan.steps).toEqual([]);
		expect(plan.missing).toEqual(["voice-over-audio"]);
	});

	test("a producer whose inputs cannot be met is skipped without leaving partial steps", () => {
		const local = new CapabilityIndex([
			{ id: "a-broken", kind: "skill", summary: "", tasks: [], inputs: ["nope", "idea"], outputs: ["x"], risk: "read" },
			{ id: "b-works", kind: "skill", summary: "", tasks: [], inputs: ["idea"], outputs: ["x"], risk: "read" },
		]);
		const plan = local.plan("t", { deliverable: "x" });
		expect(plan.steps.map((s) => s.capability.id)).toEqual(["b-works"]);
		expect(plan.missing).toEqual([]);
	});

	test("catalog states needs, makes and approval for the system prompt", () => {
		const catalog = index.catalog();
		expect(catalog).toContain("- skill production-brief:");
		expect(catalog).toContain("[needs: ad-script, frame-spec, shot-timing; makes: production-brief]");
		expect(catalog).toContain("mcp__media__submit_render");
		expect(catalog).toContain("(side_effect, needs approval)");
	});

	test("terms handles Vietnamese text", () => {
		expect(terms("Tạo video quảng cáo TikTok")).toEqual(["video", "quảng", "cáo", "tiktok"]);
	});
});

describe("plan_capabilities tool", () => {
	test("returns the ordered plan as text", async () => {
		const outcome = await new CapabilityTools(index).call("plan_capabilities", { task: TASK });
		expect(outcome?.isError).toBe(false);
		expect(outcome?.content).toContain("Deliverable: render-job");
		expect(outcome?.content).toContain("5. [skill] production-brief");
	});

	test("rejects a missing task", async () => {
		expect((await new CapabilityTools(index).call("plan_capabilities", {}))?.isError).toBe(true);
	});
});
