// Copyright (c) 2026 AIKING. All rights reserved.
//
// Capability discovery over skills and MCP tools.
//
// Each capability says which tasks it solves and which artifacts it needs
// (`inputs`) and makes (`outputs`). Matching the task text only picks the
// deliverable. The rest of the plan comes from the artifact graph: for each
// missing input, the planner pulls in a capability that produces it, even
// when that capability shares no words with the task. That is how a
// "video ad" request reaches a frame-size tool or a timing tool.

import type { McpToolInfo } from "../mcp/mcp-hub.ts";
import type { ToolRisk } from "../runtime/tools.ts";
import type { SkillLibrary } from "../skills/skill-library.ts";

export interface Capability {
	/** Skill name, or exposed tool name for MCP tools. */
	id: string;
	kind: "skill" | "tool";
	summary: string;
	tasks: string[];
	inputs: string[];
	outputs: string[];
	risk: ToolRisk;
}

export interface CapabilityMatch {
	capability: Capability;
	score: number;
	matchedTerms: string[];
}

export interface PlanStep {
	capability: Capability;
	/** Why it is in the plan. */
	reason: string;
	/** Inputs and which earlier step (or "given") provides each. */
	inputsFrom: Record<string, string>;
}

export interface CapabilityPlan {
	task: string;
	deliverable: string | undefined;
	steps: PlanStep[];
	/** Artifacts the plan needs that nothing installed can produce. */
	missing: string[];
}

/** Artifact every plan starts with: the user's own request. */
export const GIVEN = "idea";

const STOPWORDS = new Set([
	"the", "and", "for", "with", "from", "into", "that", "this", "make", "create", "need", "want", "please",
	"một", "cho", "của", "và", "với", "các", "những", "tạo", "làm",
]);

export function terms(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((t) => t.length >= 3 && !STOPWORDS.has(t))
		.map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}

export class CapabilityIndex {
	private readonly byId: Map<string, Capability>;

	constructor(capabilities: Iterable<Capability>) {
		this.byId = new Map();
		for (const c of capabilities) {
			if (this.byId.has(c.id)) throw new Error(`duplicate capability "${c.id}"`);
			this.byId.set(c.id, c);
		}
	}

	static from(skills: SkillLibrary, tools: readonly McpToolInfo[]): CapabilityIndex {
		const caps: Capability[] = [];
		for (const s of skills.list()) {
			caps.push({
				id: s.name,
				kind: "skill",
				summary: s.description,
				tasks: s.capability?.tasks ?? [],
				inputs: s.capability?.inputs ?? [],
				outputs: s.capability?.outputs ?? [],
				risk: "read",
			});
		}
		for (const t of tools) {
			caps.push({
				id: t.name,
				kind: "tool",
				summary: t.description,
				tasks: t.capability?.tasks ?? [],
				inputs: t.capability?.inputs ?? [],
				outputs: t.capability?.outputs ?? [],
				risk: t.risk,
			});
		}
		return new CapabilityIndex(caps);
	}

	list(): Capability[] {
		return [...this.byId.values()];
	}

	get(id: string): Capability | undefined {
		return this.byId.get(id);
	}

	/** Producers of an artifact. */
	producers(artifact: string): Capability[] {
		return this.list().filter((c) => c.outputs.includes(artifact));
	}

	/** Ranks capabilities by overlap between the task and their tasks, summary and outputs. */
	match(task: string): CapabilityMatch[] {
		const wanted = new Set(terms(task));
		const matches: CapabilityMatch[] = [];
		for (const capability of this.byId.values()) {
			// Declared tasks weigh more than the free-text summary.
			const strong = new Set([...capability.tasks.flatMap(terms), ...capability.outputs.flatMap(terms)]);
			const weak = new Set(terms(capability.summary));
			const matched = [...wanted].filter((t) => strong.has(t) || weak.has(t));
			const score = [...wanted].reduce((sum, t) => sum + (strong.has(t) ? 2 : weak.has(t) ? 1 : 0), 0);
			if (score > 0) matches.push({ capability, score, matchedTerms: matched });
		}
		return matches.sort((a, b) => b.score - a.score || a.capability.id.localeCompare(b.capability.id));
	}

	/**
	 * Builds an ordered plan for a task. The deliverable is the given artifact,
	 * or the output of the best match among capabilities that declare outputs.
	 * Inputs are resolved backward through producers; steps come out in
	 * dependency order.
	 */
	plan(task: string, options: { deliverable?: string; have?: string[] } = {}): CapabilityPlan {
		const matches = this.match(task);
		const scoreOf = new Map(matches.map((m) => [m.capability.id, m.score]));
		const deliverable = options.deliverable ?? this.pickDeliverable(matches);
		const available = new Map<string, string>([[GIVEN, "given"], ...(options.have ?? []).map((a) => [a, "given"] as const)]);
		const steps: PlanStep[] = [];
		const missing = new Set<string>();
		const visiting = new Set<string>();

		const resolve = (artifact: string, neededBy: string | undefined): boolean => {
			if (available.has(artifact)) return true;
			// Prefer the producer that best matches the task, then fewer inputs, then id.
			const candidates = this.producers(artifact)
				.filter((c) => !visiting.has(c.id))
				.sort(
					(a, b) =>
						(scoreOf.get(b.id) ?? 0) - (scoreOf.get(a.id) ?? 0) ||
						a.inputs.length - b.inputs.length ||
						a.id.localeCompare(b.id),
				);
			for (const c of candidates) {
				visiting.add(c.id);
				const stepsBefore = steps.length;
				const availableBefore = new Map(available);
				const missingBefore = new Set(missing);
				const inputsFrom: Record<string, string> = {};
				const ok = c.inputs.every((input) => resolve(input, c.id) && (inputsFrom[input] = available.get(input) ?? "?"));
				visiting.delete(c.id);
				if (!ok) {
					// Undo what this candidate pulled in, then try the next producer.
					steps.length = stepsBefore;
					available.clear();
					for (const [k, v] of availableBefore) available.set(k, v);
					missing.clear();
					for (const m of missingBefore) missing.add(m);
					continue;
				}
				steps.push({
					capability: c,
					reason: neededBy ? `produces "${artifact}" needed by ${neededBy}` : `produces the deliverable "${artifact}"`,
					inputsFrom,
				});
				for (const out of c.outputs) if (!available.has(out)) available.set(out, c.id);
				return true;
			}
			missing.add(artifact);
			return false;
		};

		if (deliverable) resolve(deliverable, undefined);
		return { task, deliverable, steps, missing: [...missing] };
	}

	/**
	 * A compound request names several steps ("write an ad ... and queue it
	 * for render"); the deliverable is the last one. Among strong matches
	 * (at least half the top score), pick the output that sits deepest in the
	 * artifact graph, then the higher score.
	 */
	private pickDeliverable(matches: CapabilityMatch[]): string | undefined {
		const withOutputs = matches.filter((m) => m.capability.outputs.length > 0);
		const top = withOutputs[0]?.score ?? 0;
		const strong = withOutputs.filter((m) => m.score * 2 >= top);
		let best: { artifact: string; depth: number; score: number } | undefined;
		for (const m of strong) {
			for (const artifact of m.capability.outputs) {
				const depth = this.depth(artifact, new Set());
				if (!best || depth > best.depth || (depth === best.depth && m.score > best.score)) {
					best = { artifact, depth, score: m.score };
				}
			}
		}
		return best?.artifact;
	}

	/** Longest producer chain behind an artifact (0 for given or unproducible). */
	private depth(artifact: string, seen: Set<string>): number {
		if (artifact === GIVEN || seen.has(artifact)) return 0;
		seen.add(artifact);
		let max = 0;
		for (const p of this.producers(artifact)) {
			const d = 1 + Math.max(0, ...p.inputs.map((i) => this.depth(i, seen)));
			max = Math.max(max, d);
		}
		seen.delete(artifact);
		return max;
	}

	/** Catalog text for the system prompt: what each capability does and what it connects to. */
	catalog(): string {
		if (this.byId.size === 0) return "No capabilities are installed.";
		return this.list()
			.map((c) => {
				const io = c.inputs.length + c.outputs.length > 0 ? ` [needs: ${c.inputs.join(", ") || "-"}; makes: ${c.outputs.join(", ") || "-"}]` : "";
				const risk = c.risk === "read" ? "" : ` (${c.risk}, needs approval)`;
				return `- ${c.kind} ${c.id}: ${c.summary}${io}${risk}`;
			})
			.join("\n");
	}
}

export function renderPlan(plan: CapabilityPlan): string {
	const lines = [`Deliverable: ${plan.deliverable ?? "(none matched; ask the user what they want)"}`];
	plan.steps.forEach((s, i) => {
		const inputs = Object.entries(s.inputsFrom)
			.map(([a, from]) => `${a} <- ${from}`)
			.join(", ");
		lines.push(`${i + 1}. [${s.capability.kind}] ${s.capability.id}: ${s.reason}${inputs ? ` (inputs: ${inputs})` : ""}`);
	});
	if (plan.missing.length > 0) lines.push(`Missing (no installed capability makes these): ${plan.missing.join(", ")}`);
	return lines.join("\n");
}
