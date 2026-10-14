// Copyright (c) 2026 AIKING. All rights reserved.
//
// Minimal AG-UI client for the shell: POST a RunAgentInput, read the SSE
// stream of AG-UI events, and fold events and history into view items.
// The UI only depends on the AG-UI protocol, not on AIKING Core.

import type { BaseEvent, Interrupt, Message, ResumeEntry, RunAgentInput } from "@ag-ui/core";

export interface AgentInfo {
	id: string;
	name: string;
	description: string;
	color: string;
}
export interface ThreadInfo {
	id: string;
	agentId: string;
	title: string;
	updatedAt: string;
}
export interface CapabilityInfo {
	id: string;
	kind: "skill" | "tool";
	summary: string;
	tasks: string[];
	inputs: string[];
	outputs: string[];
	risk: "read" | "side_effect" | "dangerous";
}

export type Item =
	| { kind: "user"; id: string; text: string }
	| { kind: "assistant"; id: string; text: string; streaming: boolean }
	| {
			kind: "tool";
			id: string;
			name: string;
			args: string;
			result?: string;
			status: "running" | "done" | "error" | "awaiting";
			startedAt: number;
			finishedAt?: number;
	  }
	| { kind: "approval"; id: string; interrupt: Interrupt; status: "pending" | "approved" | "declined" | "sending" }
	| { kind: "error"; id: string; text: string };

async function getJson<T>(path: string): Promise<T> {
	const res = await fetch(path);
	if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
	return (await res.json()) as T;
}

export const api = {
	agents: () => getJson<{ agents: AgentInfo[] }>("/api/agents").then((r) => r.agents),
	threads: (agentId: string) =>
		getJson<{ threads: ThreadInfo[] }>(`/api/agents/${encodeURIComponent(agentId)}/threads`).then((r) => r.threads),
	messages: (threadId: string) =>
		getJson<{ messages: Message[] }>(`/api/threads/${encodeURIComponent(threadId)}/messages`).then((r) => r.messages),
	pending: (threadId: string) =>
		getJson<{ active: boolean; interrupts: Interrupt[] }>(`/api/threads/${encodeURIComponent(threadId)}/pending`),
	capabilities: () => getJson<{ capabilities: CapabilityInfo[] }>("/api/capabilities").then((r) => r.capabilities),
};

/** Runs one AG-UI run and calls `onEvent` for each event until the stream ends. */
export async function runAgent(
	agentId: string,
	input: { threadId: string; text?: string; resume?: ResumeEntry[] },
	onEvent: (event: BaseEvent & Record<string, unknown>) => void,
): Promise<void> {
	const body: RunAgentInput = {
		threadId: input.threadId,
		runId: crypto.randomUUID(),
		messages: input.text ? [{ id: crypto.randomUUID(), role: "user", content: input.text }] : [],
		tools: [],
		context: [],
		...(input.resume ? { resume: input.resume } : {}),
	};
	const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/run`, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "text/event-stream" },
		body: JSON.stringify(body),
	});
	if (!res.ok || !res.body) throw new Error(`run failed: HTTP ${res.status}`);
	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += value;
		let cut = buffer.indexOf("\n\n");
		while (cut >= 0) {
			const frame = buffer.slice(0, cut);
			buffer = buffer.slice(cut + 2);
			const data = frame
				.split("\n")
				.filter((l) => l.startsWith("data:"))
				.map((l) => l.slice(5).trimStart())
				.join("\n");
			if (data) onEvent(JSON.parse(data));
			cut = buffer.indexOf("\n\n");
		}
	}
}

/** History (AG-UI messages) to view items. */
export function itemsFromMessages(messages: Message[]): Item[] {
	const items: Item[] = [];
	const tools = new Map<string, Extract<Item, { kind: "tool" }>>();
	for (const m of messages) {
		if (m.role === "user") {
			const text = typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : "")).join("");
			items.push({ kind: "user", id: m.id, text });
		} else if (m.role === "assistant") {
			if (m.content) items.push({ kind: "assistant", id: m.id, text: m.content, streaming: false });
			for (const call of m.toolCalls ?? []) {
				const item: Extract<Item, { kind: "tool" }> = {
					kind: "tool",
					id: call.id,
					name: call.function.name,
					args: call.function.arguments,
					status: "running",
					startedAt: 0,
				};
				tools.set(call.id, item);
				items.push(item);
			}
		} else if (m.role === "tool") {
			const item = tools.get(m.toolCallId);
			if (item) {
				item.result = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
				item.status = m.error ? "error" : "done";
			}
		}
	}
	// A tool call without a result in saved history was cut off.
	for (const t of tools.values()) if (t.status === "running") t.status = "error";
	return items;
}

/** Applies one AG-UI event to the items of the current thread. Returns the new list. */
export function applyEvent(items: Item[], event: BaseEvent & Record<string, unknown>): Item[] {
	const e = event as Record<string, unknown> & { type: string };
	const now = typeof e.timestamp === "number" ? e.timestamp : Date.now();
	const update = <K extends Item["kind"]>(kind: K, id: string, f: (item: Extract<Item, { kind: K }>) => Item) =>
		items.map((it) => (it.kind === kind && it.id === id ? f(it as Extract<Item, { kind: K }>) : it));

	switch (e.type) {
		case "TEXT_MESSAGE_START":
			return [...items, { kind: "assistant", id: e.messageId as string, text: "", streaming: true }];
		case "TEXT_MESSAGE_CONTENT":
			return update("assistant", e.messageId as string, (it) => ({ ...it, text: it.text + (e.delta as string) }));
		case "TEXT_MESSAGE_END":
			return update("assistant", e.messageId as string, (it) => ({ ...it, streaming: false }));
		case "TOOL_CALL_START":
			return [
				...items,
				{ kind: "tool", id: e.toolCallId as string, name: e.toolCallName as string, args: "", status: "running", startedAt: now },
			];
		case "TOOL_CALL_ARGS":
			return update("tool", e.toolCallId as string, (it) => ({ ...it, args: it.args + (e.delta as string) }));
		case "TOOL_CALL_RESULT": {
			const isError = (e.metadata as Record<string, unknown> | undefined)?.["aiking/isError"] === true;
			return update("tool", e.toolCallId as string, (it) => ({
				...it,
				result: e.content as string,
				status: isError ? "error" : "done",
				finishedAt: now,
			}));
		}
		case "RUN_FINISHED": {
			const outcome = e.outcome as { type: string; interrupts?: Interrupt[] } | undefined;
			if (outcome?.type !== "interrupt") return items;
			let next = items;
			for (const interrupt of outcome.interrupts ?? []) {
				if (interrupt.toolCallId) next = next.map((it) => (it.kind === "tool" && it.id === interrupt.toolCallId ? { ...it, status: "awaiting" } : it));
				next = [...next, { kind: "approval", id: interrupt.id, interrupt, status: "pending" }];
			}
			return next;
		}
		case "CUSTOM":
			if (e.name === "aiking.approval_answered") {
				const v = e.value as { interruptId: string; approved: boolean };
				return update("approval", v.interruptId, (it) => ({ ...it, status: v.approved ? "approved" : "declined" }));
			}
			return items;
		case "RUN_ERROR":
			return [...items, { kind: "error", id: crypto.randomUUID(), text: e.message as string }];
		default:
			return items;
	}
}
