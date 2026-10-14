// Copyright (c) 2026 AIKING. All rights reserved.
//
// Chat session: keeps the conversation history, runs the agent for each user
// message, and appends every message to a JSONL transcript so a chat survives
// a restart.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { AgentRuntime, RunResult } from "../runtime/agent-runtime.ts";

type MessageParam = Anthropic.Beta.BetaMessageParam;

export class ChatSession {
	private constructor(
		private readonly runtime: AgentRuntime,
		private readonly history: MessageParam[],
		private readonly transcriptPath?: string,
	) {}

	/** Opens a session. With a transcript path, earlier messages are reloaded. */
	static async open(runtime: AgentRuntime, transcriptPath?: string): Promise<ChatSession> {
		const history: MessageParam[] = [];
		if (transcriptPath) {
			const text = await readFile(transcriptPath, "utf8").catch((error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return "";
				throw error;
			});
			for (const line of text.split("\n")) {
				if (line.trim()) history.push(JSON.parse(line) as MessageParam);
			}
			dropIncompleteTail(history);
		}
		return new ChatSession(runtime, history, transcriptPath);
	}

	messages(): readonly MessageParam[] {
		return this.history;
	}

	async send(text: string): Promise<RunResult> {
		const userMessage: MessageParam = { role: "user", content: text };
		const result = await this.runtime.run([...this.history, userMessage]);
		// Commit only after the run returns, so a failed request leaves no half turn.
		const turn = [userMessage, ...result.added];
		this.history.push(...turn);
		await this.persist(turn);
		return result;
	}

	private async persist(turn: MessageParam[]): Promise<void> {
		if (!this.transcriptPath) return;
		await mkdir(dirname(this.transcriptPath), { recursive: true });
		await appendFile(this.transcriptPath, turn.map((m) => `${JSON.stringify(m)}\n`).join(""));
	}
}

/**
 * A run that stopped at the step limit ends with tool results and no
 * assistant reply. Keep it: the next user message follows tool results,
 * which the API accepts. Only a trailing assistant `tool_use` turn without
 * results would be invalid, so that one is removed.
 */
function dropIncompleteTail(history: MessageParam[]): void {
	const last = history.at(-1);
	if (last?.role !== "assistant" || typeof last.content === "string") return;
	if (last.content.some((b) => b.type === "tool_use")) history.pop();
}
