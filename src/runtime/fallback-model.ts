// Copyright (c) 2026 AIKING. All rights reserved.
//
// Client-side fallback across models or providers. Tries each client in
// order; moves to the next only on a retryable ModelError (rate limit,
// overload, server, network, timeout). Auth and invalid-request errors stop
// the chain: another model would fail the same way or hide a real bug.
// Every attempt is recorded so failures are visible, not swallowed.

import { type CreateOptions, type ModelClient, ModelError, type ModelRequest, type ModelResponse } from "./model.ts";

export interface FallbackAttempt {
	provider: string;
	model: string;
	ok: boolean;
	error?: { kind: string; message: string; status?: number };
}

export interface NamedClient {
	client: ModelClient;
	/** Label for logs and fallback notes, e.g. "claude-opus-5-5". */
	model: string;
}

export class FallbackChainError extends Error {
	constructor(readonly attempts: FallbackAttempt[], options?: { cause?: unknown }) {
		const summary = attempts.map((a) => `${a.provider}/${a.model}: ${a.error?.kind ?? "ok"}`).join("; ");
		super(`all models failed (${summary})`, options);
		this.name = "FallbackChainError";
	}
}

export class FallbackModel implements ModelClient {
	readonly provider = "fallback-chain";
	/** Attempts of the most recent `create` call. */
	lastAttempts: FallbackAttempt[] = [];

	constructor(
		private readonly chain: NamedClient[],
		private readonly onAttempt?: (attempt: FallbackAttempt) => void,
	) {
		if (chain.length === 0) throw new Error("fallback chain needs at least one model");
	}

	async create(request: ModelRequest, options: CreateOptions = {}): Promise<ModelResponse> {
		const attempts: FallbackAttempt[] = [];
		this.lastAttempts = attempts;
		const record = (a: FallbackAttempt) => {
			attempts.push(a);
			this.onAttempt?.(a);
		};
		let lastError: unknown;
		for (const [index, { client, model }] of this.chain.entries()) {
			options.signal?.throwIfAborted();
			try {
				const response = await client.create(request, options);
				record({ provider: client.provider, model, ok: true });
				// Earlier failed attempts are model switches the caller must see.
				const switches = attempts.slice(0, -1).map((a, i) => ({
					from: a.model,
					to: this.chain[i + 1]?.model ?? model,
					reason: a.error?.kind ?? "error",
				}));
				return index === 0 ? response : { ...response, fallbacks: [...switches, ...response.fallbacks] };
			} catch (error) {
				options.signal?.throwIfAborted();
				lastError = error;
				const me = error instanceof ModelError ? error : undefined;
				record({
					provider: client.provider,
					model,
					ok: false,
					error: {
						kind: me?.kind ?? "unknown",
						message: (error as Error).message,
						...(me?.status !== undefined ? { status: me.status } : {}),
					},
				});
				if (!me?.retryable) break;
			}
		}
		throw new FallbackChainError(attempts, { cause: lastError });
	}
}
