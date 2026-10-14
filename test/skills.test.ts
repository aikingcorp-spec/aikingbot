// Copyright (c) 2026 AIKING. All rights reserved.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillFile, SkillFormatError, SkillLibrary } from "../src/skills/skill-library.ts";
import { SkillTools } from "../src/skills/skill-tools.ts";

async function skillsRoot(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "aiking-skills-"));
	for (const [dir, text] of Object.entries(files)) {
		await mkdir(join(root, dir), { recursive: true });
		await writeFile(join(root, dir, "SKILL.md"), text);
	}
	return root;
}

describe("parseSkillFile", () => {
	test("reads name, description and body", () => {
		const skill = parseSkillFile("x", "---\nname: brief\ndescription: Write a brief.\n---\n# Steps\nDo it.\n");
		expect(skill).toEqual({ name: "brief", description: "Write a brief.", body: "# Steps\nDo it." });
	});

	test.each([
		["no front matter", "# just markdown"],
		["bad name", "---\nname: Bad Name\ndescription: d\n---\n"],
		["no description", "---\nname: ok\n---\n"],
		["invalid yaml", "---\nname: [\n---\n"],
	])("rejects %s", (_label, text) => {
		expect(() => parseSkillFile("x", text)).toThrow(SkillFormatError);
	});
});

describe("SkillLibrary.load", () => {
	test("loads valid skills and reports bad ones without failing", async () => {
		const root = await skillsRoot({
			good: "---\nname: good\ndescription: Good skill.\n---\nBody",
			broken: "no front matter",
		});
		const { library, errors } = await SkillLibrary.load(root);
		expect(library.list().map((s) => s.name)).toEqual(["good"]);
		expect(errors).toHaveLength(1);
		expect(library.catalog()).toBe("- good: Good skill.");
	});

	test("a missing directory gives an empty library", async () => {
		const { library } = await SkillLibrary.load(join(tmpdir(), "aiking-no-such-dir"));
		expect(library.list()).toEqual([]);
	});

	test("rejects two skills with the same name", async () => {
		const root = await skillsRoot({
			a: "---\nname: same\ndescription: A.\n---\n",
			b: "---\nname: same\ndescription: B.\n---\n",
		});
		await expect(SkillLibrary.load(root)).rejects.toThrow(/duplicate skill name/);
	});
});

describe("read_skill tool", () => {
	const library = new SkillLibrary([{ name: "brief", description: "d", body: "Step 1", directory: "/x" }]);
	const tools = new SkillTools(library);

	test("returns the skill body", async () => {
		expect(await tools.call("read_skill", { name: "brief" })).toEqual({
			content: "# Skill: brief\n\nStep 1",
			isError: false,
		});
	});

	test("unknown skill is a tool error that lists installed skills", async () => {
		const outcome = await tools.call("read_skill", { name: "../../etc/passwd" });
		expect(outcome?.isError).toBe(true);
		expect(outcome?.content).toContain("Installed: brief");
	});

	test("does not claim other tool names", async () => {
		expect(await tools.call("other", {})).toBeUndefined();
	});
});
