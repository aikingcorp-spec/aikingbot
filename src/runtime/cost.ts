// Copyright (c) 2026 AIKING. All rights reserved.
//
// Token cost accounting. Prices are USD per million tokens. A model without
// a price is reported as unpriced, never guessed: a wrong number is worse
// than a missing one when deciding what a run cost.

import type { UsageEntry } from "./model.ts";

export interface ModelPrice {
	input: number;
	output: number;
	cacheRead: number;
	/** 5-minute cache write. */
	cacheWrite: number;
}

/**
 * Claude API first-party rates (cached 2026-10-06 from Anthropic's model
 * table). Cache reads 0.1x input except where listed; cache writes 1.25x.
 * Update when prices change; partner platforms (Bedrock, Vertex) differ.
 */
export const CLAUDE_PRICES: Record<string, ModelPrice> = {
	"claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
	"claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
	"claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
	"claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
	"claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
	"claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
	"claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
	"claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export function costOf(entry: UsageEntry, price: ModelPrice): number {
	return (
		(entry.inputTokens * price.input +
			entry.outputTokens * price.output +
			entry.cacheReadTokens * price.cacheRead +
			entry.cacheWriteTokens * price.cacheWrite) /
		1_000_000
	);
}

export interface ModelTotals {
	model: string;
	requests: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	/** null when the model has no price in the table. */
	usd: number | null;
}

export interface CostReport {
	byModel: ModelTotals[];
	/** Sum over priced models only. */
	usd: number;
	unpricedModels: string[];
}

export class CostTracker {
	private readonly totals = new Map<string, ModelTotals>();

	constructor(private readonly prices: Record<string, ModelPrice> = CLAUDE_PRICES) {}

	add(entries: readonly UsageEntry[]): void {
		for (const e of entries) {
			const t = this.totals.get(e.model) ?? {
				model: e.model,
				requests: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				usd: 0,
			};
			const price = this.prices[e.model];
			t.requests += 1;
			t.inputTokens += e.inputTokens;
			t.outputTokens += e.outputTokens;
			t.cacheReadTokens += e.cacheReadTokens;
			t.cacheWriteTokens += e.cacheWriteTokens;
			t.usd = price && t.usd !== null ? t.usd + costOf(e, price) : null;
			this.totals.set(e.model, t);
		}
	}

	report(): CostReport {
		const byModel = [...this.totals.values()].map((t) => ({ ...t }));
		return {
			byModel,
			usd: byModel.reduce((sum, t) => sum + (t.usd ?? 0), 0),
			unpricedModels: byModel.filter((t) => t.usd === null && t.inputTokens + t.outputTokens > 0).map((t) => t.model),
		};
	}
}
