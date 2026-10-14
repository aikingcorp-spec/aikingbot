// Copyright (c) 2026 AIKING. All rights reserved.
//
// Skill library. A skill is a directory that holds a `SKILL.md` file:
// YAML front matter (`name`, `description`) and a Markdown body with the
// instructions. The agent sees only the catalog (name + description) in its
// system prompt and reads the body on demand through the `read_skill` tool.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface Skill {
	name: string;
	description: string;
	body: string;
	directory: string;
}

export class SkillFormatError extends Error {
	constructor(
		readonly file: string,
		reason: string,
	) {
		super(`${file}: ${reason}`);
		this.name = "SkillFormatError";
	}
}

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseSkillFile(file: string, text: string): Omit<Skill, "directory"> {
	const match = FRONT_MATTER.exec(text);
	if (!match) throw new SkillFormatError(file, "missing YAML front matter");
	const [, header = "", body = ""] = match;

	let meta: unknown;
	try {
		meta = parseYaml(header);
	} catch (error) {
		throw new SkillFormatError(file, `invalid YAML: ${(error as Error).message}`);
	}
	if (typeof meta !== "object" || meta === null) {
		throw new SkillFormatError(file, "front matter must be a mapping");
	}
	const { name, description } = meta as Record<string, unknown>;
	if (typeof name !== "string" || !SKILL_NAME.test(name)) {
		throw new SkillFormatError(file, "`name` must be lowercase letters, digits and dashes");
	}
	if (typeof description !== "string" || description.trim() === "") {
		throw new SkillFormatError(file, "`description` is required");
	}
	return { name, description: description.trim(), body: body.trim() };
}

export interface LoadResult {
	library: SkillLibrary;
	errors: SkillFormatError[];
}

export class SkillLibrary {
	private readonly skills: ReadonlyMap<string, Skill>;

	constructor(skills: Iterable<Skill>) {
		const map = new Map<string, Skill>();
		for (const skill of skills) {
			if (map.has(skill.name)) {
				throw new SkillFormatError(skill.directory, `duplicate skill name "${skill.name}"`);
			}
			map.set(skill.name, skill);
		}
		this.skills = map;
	}

	/** Loads every `<root>/<dir>/SKILL.md`. A bad skill is reported, not fatal. */
	static async load(root: string): Promise<LoadResult> {
		const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return [];
			throw error;
		});
		const skills: Skill[] = [];
		const errors: SkillFormatError[] = [];
		for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
			const directory = join(root, entry.name);
			const file = join(directory, "SKILL.md");
			let text: string;
			try {
				text = await readFile(file, "utf8");
			} catch {
				continue; // Directory without SKILL.md is not a skill.
			}
			try {
				skills.push({ ...parseSkillFile(file, text), directory });
			} catch (error) {
				if (error instanceof SkillFormatError) errors.push(error);
				else throw error;
			}
		}
		return { library: new SkillLibrary(skills), errors };
	}

	list(): Skill[] {
		return [...this.skills.values()];
	}

	get(name: string): Skill | undefined {
		return this.skills.get(name);
	}

	/** Short catalog for the system prompt. Bodies stay out until requested. */
	catalog(): string {
		if (this.skills.size === 0) return "No skills are installed.";
		return this.list()
			.map((s) => `- ${s.name}: ${s.description}`)
			.join("\n");
	}
}
