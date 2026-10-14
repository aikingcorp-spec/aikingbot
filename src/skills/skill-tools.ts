// Copyright (c) 2026 AIKING. All rights reserved.
//
// Exposes the skill library to the model as the `read_skill` tool.

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolOutcome, ToolSource } from "../runtime/tools.ts";
import type { SkillLibrary } from "./skill-library.ts";

export const READ_SKILL = "read_skill";

export class SkillTools implements ToolSource {
	constructor(private readonly library: SkillLibrary) {}

	definitions(): Anthropic.Tool[] {
		return [
			{
				name: READ_SKILL,
				description:
					"Read the full instructions of an installed skill. Call it before you do a task that a skill in the catalog covers.",
				input_schema: {
					type: "object",
					properties: { name: { type: "string", description: "Skill name from the catalog." } },
					required: ["name"],
					additionalProperties: false,
				},
			},
		];
	}

	async call(name: string, input: unknown): Promise<ToolOutcome | undefined> {
		if (name !== READ_SKILL) return undefined;
		const skillName = (input as { name?: unknown } | null)?.name;
		if (typeof skillName !== "string") {
			return { content: "`name` must be a string.", isError: true };
		}
		const skill = this.library.get(skillName);
		if (!skill) {
			const known = this.library.list().map((s) => s.name).join(", ") || "none";
			return { content: `No skill named "${skillName}". Installed: ${known}.`, isError: true };
		}
		return { content: `# Skill: ${skill.name}\n\n${skill.body}`, isError: false };
	}
}
