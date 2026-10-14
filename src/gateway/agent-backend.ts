// Copyright (c) 2026 AIKING. All rights reserved.
//
// The contract between the UI gateway and whatever runs agents. The AG-UI
// adapter and the HTTP server only use this interface, so the runtime behind
// it (AIKING Core today; another engine later) can change without touching
// the UI. `CoreBackend` is the AIKING Core implementation: one runtime per
// agent profile, threads and messages in SQLite.

import { randomUUID } from "node:crypto";
import type { Capability } from "../capabilities/capability-index.ts";
import { ChatSession } from "../chat/chat-session.ts";
import { createCore, type Core, type CoreConfig } from "../core.ts";
import type { RunHooks } from "../runtime/agent-runtime.ts";
import type { Message } from "../runtime/model.ts";
import type { AgentRow, SqliteStore, ThreadRow } from "../store/sqlite-store.ts";

export interface BackendRunRequest {
	agentId: string;
	threadId: string;
	runId: string;
	text: string;
}

export interface BackendRunResult {
	status: string;
	text: string;
	costUsd: number;
	unpricedModels: string[];
	servedBy: string[];
}

export interface SkillInfo {
	name: string;
	description: string;
	tasks: string[];
	inputs: string[];
	outputs: string[];
}

export interface AgentBackend {
	listAgents(): AgentRow[];
	listThreads(agentId: string): ThreadRow[];
	/** Creates the thread when it does not exist yet. */
	ensureThread(agentId: string, threadId: string, title: string): ThreadRow;
	history(threadId: string): Promise<Message[]>;
	capabilities(): Capability[];
	skills(): SkillInfo[];
	run(request: BackendRunRequest, hooks: RunHooks): Promise<BackendRunResult>;
	close(): Promise<void>;
}

export interface AgentProfile extends AgentRow {
	instructions?: string;
}

export interface CoreBackendOptions {
	store: SqliteStore;
	agents: AgentProfile[];
	/** Core settings shared by all agents (model, skills, MCP servers, tool policy). */
	core: Omit<CoreConfig, "transcriptPath" | "instructions">;
}

export class CoreBackend implements AgentBackend {
	private readonly sessions = new Map<string, ChatSession>();
	private readonly running = new Set<string>();

	private constructor(
		private readonly store: SqliteStore,
		private readonly cores: Map<string, Core>,
	) {}

	static async create(options: CoreBackendOptions): Promise<CoreBackend> {
		const cores = new Map<string, Core>();
		try {
			for (const agent of options.agents) {
				options.store.upsertAgent({ id: agent.id, name: agent.name, description: agent.description, color: agent.color });
				cores.set(agent.id, await createCore({ ...options.core, instructions: agent.instructions }));
			}
		} catch (error) {
			await Promise.allSettled([...cores.values()].map((c) => c.close()));
			throw error;
		}
		options.store.recoverInterruptedRuns();
		return new CoreBackend(options.store, cores);
	}

	/** Warnings from loading skills and connecting MCP servers. */
	warnings(): string[] {
		return [...new Set([...this.cores.values()].flatMap((c) => c.warnings))];
	}

	listAgents(): AgentRow[] {
		return this.store.listAgents();
	}

	listThreads(agentId: string): ThreadRow[] {
		return this.store.listThreads(agentId);
	}

	ensureThread(agentId: string, threadId: string, title: string): ThreadRow {
		const existing = this.store.getThread(threadId);
		if (existing) {
			if (existing.agentId !== agentId) throw new Error(`thread ${threadId} belongs to another agent`);
			return existing;
		}
		if (!this.cores.has(agentId)) throw new Error(`unknown agent "${agentId}"`);
		return this.store.createThread(threadId, agentId, title.slice(0, 80));
	}

	async history(threadId: string): Promise<Message[]> {
		return this.store.loadMessages(threadId);
	}

	private anyCore(): Core | undefined {
		return this.cores.values().next().value;
	}

	capabilities(): Capability[] {
		return this.anyCore()?.capabilities.list() ?? [];
	}

	skills(): SkillInfo[] {
		return (this.anyCore()?.skills.list() ?? []).map((s) => ({
			name: s.name,
			description: s.description,
			tasks: s.capability?.tasks ?? [],
			inputs: s.capability?.inputs ?? [],
			outputs: s.capability?.outputs ?? [],
		}));
	}

	async run(request: BackendRunRequest, hooks: RunHooks): Promise<BackendRunResult> {
		const core = this.cores.get(request.agentId);
		if (!core) throw new Error(`unknown agent "${request.agentId}"`);
		const thread = this.ensureThread(request.agentId, request.threadId, request.text);
		if (this.running.has(thread.id)) throw new Error("this thread already has a run in progress");
		this.running.add(thread.id);
		const runId = request.runId || randomUUID();
		try {
			this.store.startRun(runId, thread.id);
			let session = this.sessions.get(thread.id);
			if (!session) {
				session = await core.chat.withTranscript(this.store.transcript(thread.id));
				this.sessions.set(thread.id, session);
			}
			const result = await session.send(request.text, hooks);
			this.store.finishRun(thread.id, runId, {
				status: result.status,
				costUsd: result.cost.usd,
				servedBy: result.servedBy,
			});
			return {
				status: result.status,
				text: result.text,
				costUsd: result.cost.usd,
				unpricedModels: result.cost.unpricedModels,
				servedBy: result.servedBy,
			};
		} catch (error) {
			this.store.finishRun(thread.id, runId, { status: "error", error: (error as Error).message });
			throw error;
		} finally {
			this.running.delete(thread.id);
		}
	}

	async close(): Promise<void> {
		await Promise.allSettled([...this.cores.values()].map((c) => c.close()));
	}
}
