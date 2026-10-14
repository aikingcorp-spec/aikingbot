// Copyright (c) 2026 AIKING. All rights reserved.
//
// Exposes capability discovery to the model as the `plan_capabilities` tool.

import type { GuardedToolDefinition, ToolOutcome, ToolSource } from "../runtime/tools.ts";
import { type CapabilityIndex, renderPlan } from "./capability-index.ts";

export const PLAN_CAPABILITIES = "plan_capabilities";

export class CapabilityTools implements ToolSource {
	constructor(private readonly index: CapabilityIndex) {}

	definitions(): GuardedToolDefinition[] {
		return [
			{
				name: PLAN_CAPABILITIES,
				risk: "read",
				description:
					"Find which installed skills and tools together can deliver a task, in the order to use them. " +
					"Use it for any task that may need more than one skill or tool. Pass `deliverable` when you know " +
					"the artifact the user wants (an artifact name from the catalog).",
				inputSchema: {
					type: "object",
					properties: {
						task: { type: "string", description: "The user's task in their words." },
						deliverable: { type: "string", description: "Artifact name the user wants in the end." },
						have: {
							type: "array",
							items: { type: "string" },
							description: "Artifact names already available in the conversation.",
						},
					},
					required: ["task"],
					additionalProperties: false,
				},
			},
		];
	}

	async call(name: string, input: unknown): Promise<ToolOutcome | undefined> {
		if (name !== PLAN_CAPABILITIES) return undefined;
		const { task, deliverable, have } = (input ?? {}) as { task?: unknown; deliverable?: unknown; have?: unknown };
		if (typeof task !== "string" || task.trim() === "") return { content: "`task` must be a non-empty string.", isError: true };
		if (deliverable !== undefined && typeof deliverable !== "string") {
			return { content: "`deliverable` must be a string.", isError: true };
		}
		const haveList = Array.isArray(have) ? have.filter((h): h is string => typeof h === "string") : [];
		const plan = this.index.plan(task, { deliverable, have: haveList });
		return { content: renderPlan(plan), isError: plan.steps.length === 0 };
	}
}
