// Copyright (c) 2026 AIKING. All rights reserved.
//
// Local-first storage on SQLite (bun:sqlite): agents, threads, messages and
// runs. Schema changes are numbered migrations applied in order inside a
// transaction and recorded in `schema_migrations`, so a newer app can open
// an older database and an older app refuses a newer one.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { TranscriptStore } from "../chat/chat-session.ts";
import type { Message } from "../runtime/model.ts";

export const MIGRATIONS: readonly string[] = [
	// 1: initial schema
	`CREATE TABLE agents (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		color TEXT NOT NULL DEFAULT 'teal',
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	);
	CREATE TABLE threads (
		id TEXT PRIMARY KEY,
		agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
		title TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
		updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	);
	CREATE INDEX threads_by_agent ON threads(agent_id, updated_at);
	CREATE TABLE messages (
		thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
		seq INTEGER NOT NULL,
		role TEXT NOT NULL CHECK (role IN ('user','assistant')),
		content TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
		PRIMARY KEY (thread_id, seq)
	);`,
	// 2: run records (status, cost, models, errors)
	`CREATE TABLE runs (
		id TEXT NOT NULL,
		thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
		status TEXT NOT NULL,
		error TEXT,
		cost_usd REAL,
		served_by TEXT,
		started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
		finished_at TEXT,
		PRIMARY KEY (thread_id, id)
	);
	CREATE INDEX runs_by_thread ON runs(thread_id, started_at);`,
];

export interface AgentRow {
	id: string;
	name: string;
	description: string;
	color: string;
}

export interface ThreadRow {
	id: string;
	agentId: string;
	title: string;
	updatedAt: string;
}

export interface RunRow {
	id: string;
	threadId: string;
	status: string;
	error: string | null;
	costUsd: number | null;
	servedBy: string | null;
}

export class SqliteStore {
	readonly db: Database;

	constructor(path: string, migrations: readonly string[] = MIGRATIONS) {
		if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
		this.db = new Database(path, { create: true, strict: true });
		this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
		this.migrate(migrations);
	}

	schemaVersion(): number {
		const row = this.db.query("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
		return row.v ?? 0;
	}

	private migrate(migrations: readonly string[]): void {
		this.db.exec(
			"CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
		);
		const current = this.schemaVersion();
		if (current > migrations.length) {
			throw new Error(`database schema v${current} is newer than this app (v${migrations.length}); update the app`);
		}
		for (let v = current + 1; v <= migrations.length; v++) {
			this.db.transaction(() => {
				this.db.exec(migrations[v - 1] as string);
				this.db.query("INSERT INTO schema_migrations (version) VALUES (?)").run(v);
			})();
		}
	}

	/** Consistent online copy of the database (SQLite VACUUM INTO). */
	backup(toPath: string): void {
		mkdirSync(dirname(toPath), { recursive: true });
		this.db.query("VACUUM INTO ?").run(toPath);
	}

	close(): void {
		this.db.close();
	}

	// ---- agents ----

	upsertAgent(agent: AgentRow): void {
		this.db
			.query(
				"INSERT INTO agents (id, name, description, color) VALUES ($id, $name, $description, $color) ON CONFLICT(id) DO UPDATE SET name = $name, description = $description, color = $color",
			)
			.run({ ...agent } as Record<string, string>);
	}

	listAgents(): AgentRow[] {
		return this.db.query("SELECT id, name, description, color FROM agents ORDER BY created_at, id").all() as AgentRow[];
	}

	// ---- threads ----

	createThread(id: string, agentId: string, title: string): ThreadRow {
		this.db.query("INSERT INTO threads (id, agent_id, title) VALUES (?, ?, ?)").run(id, agentId, title);
		return this.getThread(id) as ThreadRow;
	}

	getThread(id: string): ThreadRow | undefined {
		return (
			(this.db
				.query("SELECT id, agent_id AS agentId, title, updated_at AS updatedAt FROM threads WHERE id = ?")
				.get(id) as ThreadRow | null) ?? undefined
		);
	}

	listThreads(agentId: string): ThreadRow[] {
		return this.db
			.query(
				"SELECT id, agent_id AS agentId, title, updated_at AS updatedAt FROM threads WHERE agent_id = ? ORDER BY updated_at DESC, id",
			)
			.all(agentId) as ThreadRow[];
	}

	// ---- messages ----

	loadMessages(threadId: string): Message[] {
		const rows = this.db
			.query("SELECT role, content FROM messages WHERE thread_id = ? ORDER BY seq")
			.all(threadId) as { role: Message["role"]; content: string }[];
		return rows.map((r) => ({ role: r.role, content: JSON.parse(r.content) as Message["content"] }));
	}

	appendMessages(threadId: string, messages: readonly Message[]): void {
		this.db.transaction(() => {
			const { next } = this.db
				.query("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE thread_id = ?")
				.get(threadId) as { next: number };
			const insert = this.db.query("INSERT INTO messages (thread_id, seq, role, content) VALUES (?, ?, ?, ?)");
			messages.forEach((m, i) => insert.run(threadId, next + i, m.role, JSON.stringify(m.content)));
			this.db
				.query("UPDATE threads SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
				.run(threadId);
		})();
	}

	transcript(threadId: string): TranscriptStore {
		return {
			load: async () => this.loadMessages(threadId),
			append: async (messages) => this.appendMessages(threadId, messages),
		};
	}

	// ---- runs ----

	startRun(id: string, threadId: string): void {
		this.db.query("INSERT INTO runs (id, thread_id, status) VALUES (?, ?, 'running')").run(id, threadId);
	}

	finishRun(threadId: string, id: string, outcome: { status: string; error?: string; costUsd?: number; servedBy?: string[] }): void {
		this.db
			.query(
				"UPDATE runs SET status = ?, error = ?, cost_usd = ?, served_by = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE thread_id = ? AND id = ?",
			)
			.run(outcome.status, outcome.error ?? null, outcome.costUsd ?? null, outcome.servedBy?.join(",") ?? null, threadId, id);
	}

	listRuns(threadId: string): RunRow[] {
		return this.db
			.query(
				"SELECT id, thread_id AS threadId, status, error, cost_usd AS costUsd, served_by AS servedBy FROM runs WHERE thread_id = ? ORDER BY started_at, id",
			)
			.all(threadId) as RunRow[];
	}

	/** Runs left as `running` by a crash or restart are marked interrupted. Returns how many. */
	recoverInterruptedRuns(): number {
		return this.db
			.query(
				"UPDATE runs SET status = 'interrupted', error = 'process stopped before the run finished', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status = 'running'",
			)
			.run().changes;
	}
}
