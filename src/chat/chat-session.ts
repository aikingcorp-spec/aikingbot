// Copyright (c) 2026 AIKING. All rights reserved.
//
// Chat session: keeps the conversation history, runs the agent for each user
// message, and appends every finished turn to a transcript store (JSONL file
// or SQLite) so a chat survives a restart.

import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { AgentRuntime, RunHooks, RunResult } from "../runtime/agent-runtime.ts";
import type { Message } from "../runtime/model.ts";

/** Where a conversation is kept. Appends are whole turns only. */
export interface TranscriptStore {
	load(): Promise<Message[]>;
	append(messages: Message[]): Promise<void>;
}

export class JsonlTranscript implements TranscriptStore {
	constructor(private readonly path: string) {}

	async load(): Promise<Message[]> {
		const text = await readFile(this.path, "utf8").catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return "";
			throw error;
		});
		return text
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line) as Message);
	}

	async append(messages: Message[]): Promise<void> {
		await mkdir(dirname(this.path), { recursive: true });
		const previous = await readFile(this.path, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
		const temp = `${this.path}.${randomUUID()}.tmp`;
		await writeFile(temp, previous + messages.map((m) => `${JSON.stringify(m)}\n`).join(""), { mode: 0o600, flush: true });
		await rename(temp, this.path);
	}
}

export class ChatSession {
	private constructor(
		private readonly runtime: AgentRuntime,
		private readonly history: Message[],
		private readonly store?: TranscriptStore,
	) {}

	/** Opens a session. A transcript path means a JSONL file; earlier messages are reloaded. */
	static async open(runtime: AgentRuntime, store?: string | TranscriptStore): Promise<ChatSession> {
		const transcript = typeof store === "string" ? new JsonlTranscript(store) : store;
		const history = transcript ? await transcript.load() : [];
		dropIncompleteTail(history);
		return new ChatSession(runtime, history, transcript);
	}

	/** Another conversation on the same runtime (one per thread). */
	withTranscript(store: TranscriptStore): Promise<ChatSession> {
		return ChatSession.open(this.runtime, store);
	}

	messages(): readonly Message[] {
		return this.history;
	}

	async send(text: string, hooks?: RunHooks): Promise<RunResult> {
		const userMessage: Message = { role: "user", content: text };
		const result = await this.runtime.run([...this.history, userMessage], hooks);
		// Commit only after the run returns, so a failed request leaves no half turn.
		const turn = [userMessage, ...result.added];
		await this.store?.append(turn);
		this.history.push(...turn);
		return result;
	}
}

/**
 * A run that stopped at the step limit ends with tool results and no
 * assistant reply. Keep it: the next user message follows tool results,
 * which the API accepts. Only a trailing assistant `tool_call` turn without
 * results would be invalid, so that one is removed.
 */
function dropIncompleteTail(history: Message[]): void {
	const last = history.at(-1);
	if (last?.role !== "assistant" || typeof last.content === "string") return;
	if (last.content.some((b) => b.type === "tool_call")) history.pop();
}
