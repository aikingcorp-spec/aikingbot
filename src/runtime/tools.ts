// Copyright (c) 2026 AIKING. All rights reserved.
//
// Tool contract between the agent runtime and tool sources (MCP servers,
// built-in tools), plus the guard every call goes through: a permission
// gate by risk level, a per-call timeout, and an output size cap.

import type { ToolDefinition } from "./model.ts";

export interface ToolOutcome {
	content: string;
	isError: boolean;
}

/**
 * - `read`: no side effects (lookups, calculations).
 * - `side_effect`: changes state outside the conversation (writes files, queues jobs, spends credits).
 * - `dangerous`: destructive or irreversible (deletes, publishes, pays).
 */
export type ToolRisk = "read" | "side_effect" | "dangerous";

export interface GuardedToolDefinition extends ToolDefinition {
	risk: ToolRisk;
}

export interface ToolCallContext {
	signal: AbortSignal;
	timeoutMs: number;
}

export interface ToolSource {
	definitions(): GuardedToolDefinition[];
	/** Returns undefined when this source does not own `name`. */
	call(name: string, input: unknown, context: ToolCallContext): Promise<ToolOutcome | undefined>;
}

export interface PermissionRequest {
	tool: string;
	risk: ToolRisk;
	input: unknown;
}

/** Asks a human (or a policy) whether one call may run. */
export type Approver = (request: PermissionRequest) => Promise<boolean> | boolean;

export interface ToolPolicy {
	/** Tool names that need no approval even with side effects. Never applies to `dangerous`. */
	preapproved?: string[];
	/**
	 * Tool names allowed to ask for approval at `dangerous` risk. A dangerous
	 * tool not listed here is denied without asking.
	 */
	allowDangerous?: string[];
	/** Called for side-effect calls not preapproved and for allowed dangerous calls. No approver means deny. */
	approver?: Approver;
	/** Per-call timeout. Default 30 s. */
	timeoutMs?: number;
	/** Per-tool timeout overrides. */
	timeouts?: Record<string, number>;
	/** Longest tool output passed back to the model. Default 50 000 characters. */
	maxOutputChars?: number;
}

export type GateDecision = { allowed: true } | { allowed: false; reason: string };

export class PermissionGate {
	constructor(private readonly policy: ToolPolicy = {}) {}

	async check(request: PermissionRequest): Promise<GateDecision> {
		const { risk, tool } = request;
		if (risk === "read") return { allowed: true };
		if (risk === "side_effect" && this.policy.preapproved?.includes(tool)) return { allowed: true };
		if (risk === "dangerous" && !this.policy.allowDangerous?.includes(tool)) {
			return { allowed: false, reason: `"${tool}" is dangerous and not enabled by policy` };
		}
		if (!this.policy.approver) return { allowed: false, reason: `"${tool}" needs approval and no approver is configured` };
		try {
			return (await this.policy.approver(request))
				? { allowed: true }
				: { allowed: false, reason: `approval for "${tool}" was declined` };
		} catch (error) {
			return { allowed: false, reason: `approver failed: ${(error as Error).message}` };
		}
	}
}

export class ToolTimeoutError extends Error {
	constructor(tool: string, ms: number) {
		super(`tool "${tool}" timed out after ${ms} ms`);
		this.name = "ToolTimeoutError";
	}
}

export type GuardEvent =
	| { type: "denied"; tool: string; risk: ToolRisk; reason: string }
	| { type: "timeout"; tool: string; ms: number };

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT = 50_000;

/** Routes a tool call to the source that owns the tool name, through the gate. */
export class ToolRegistry {
	private readonly gate: PermissionGate;

	constructor(
		private readonly sources: ToolSource[],
		private readonly policy: ToolPolicy = {},
		private readonly onGuard?: (event: GuardEvent) => void,
	) {
		this.gate = new PermissionGate(policy);
	}

	definitions(): GuardedToolDefinition[] {
		const seen = new Set<string>();
		const tools: GuardedToolDefinition[] = [];
		for (const source of this.sources) {
			for (const tool of source.definitions()) {
				if (seen.has(tool.name)) throw new Error(`duplicate tool name "${tool.name}"`);
				seen.add(tool.name);
				tools.push(tool);
			}
		}
		return tools;
	}

	async call(name: string, input: unknown): Promise<ToolOutcome> {
		const owner = this.sources.find((s) => s.definitions().some((d) => d.name === name));
		const definition = owner?.definitions().find((d) => d.name === name);
		if (!owner || !definition) return { content: `Unknown tool "${name}".`, isError: true };

		const decision = await this.gate.check({ tool: name, risk: definition.risk, input });
		if (!decision.allowed) {
			this.onGuard?.({ type: "denied", tool: name, risk: definition.risk, reason: decision.reason });
			return { content: `Permission denied: ${decision.reason}. Do not retry; tell the user what is needed.`, isError: true };
		}

		const timeoutMs = this.policy.timeouts?.[name] ?? this.policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				controller.abort();
				reject(new ToolTimeoutError(name, timeoutMs));
			}, timeoutMs);
		});
		try {
			const outcome = await Promise.race([owner.call(name, input, { signal: controller.signal, timeoutMs }), timeout]);
			if (!outcome) return { content: `Unknown tool "${name}".`, isError: true };
			return this.capped(outcome);
		} catch (error) {
			if (error instanceof ToolTimeoutError) this.onGuard?.({ type: "timeout", tool: name, ms: timeoutMs });
			return { content: `Tool "${name}" failed: ${(error as Error).message}`, isError: true };
		} finally {
			clearTimeout(timer);
		}
	}

	private capped(outcome: ToolOutcome): ToolOutcome {
		const max = this.policy.maxOutputChars ?? DEFAULT_MAX_OUTPUT;
		if (outcome.content.length <= max) return outcome;
		return { ...outcome, content: `${outcome.content.slice(0, max)}\n[truncated]` };
	}
}
