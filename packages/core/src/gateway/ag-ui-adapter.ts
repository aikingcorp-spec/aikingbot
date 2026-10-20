// Copyright (c) 2026 AIKING. All rights reserved.
//
// AG-UI adapter: turns an AgentBackend run into AG-UI protocol events
// (https://github.com/ag-ui-protocol/ag-ui, MIT; types from @ag-ui/core).
//
// Approval uses AG-UI interrupts. When a tool needs approval, the current
// run ends with RUN_FINISHED { outcome: interrupt } while the agent loop
// waits in memory. The client answers with a new run on the same thread
// whose `resume` entries resolve the interrupt; the continuation streams on
// that new run. An unanswered interrupt is declined after `approvalTimeoutMs`.
// If the process restarts while waiting, the interrupt is gone: the client
// gets RUN_ERROR and the thread keeps its last finished turn.

import { randomUUID } from "node:crypto";
import {
	type BaseEvent,
	EventType,
	type Interrupt,
	type Message as AgUiMessage,
	type ResumeEntry,
	type RunAgentInput,
} from "@ag-ui/core";
import type { RuntimeEvent } from "../runtime/agent-runtime.ts";
import type { Message } from "../runtime/model.ts";
import type { PermissionRequest } from "../runtime/tools.ts";
import type { AgentBackend } from "./agent-backend.ts";

export type EventSink = (event: BaseEvent) => void;

interface PendingApproval {
	interrupt: Interrupt;
	resolve: (approved: boolean) => void;
	timer: ReturnType<typeof setTimeout>;
}

/** One agent loop that may span several AG-UI runs (one per interrupt). */
interface ActiveRun {
	threadId: string;
	runId: string;
	sink: EventSink | undefined;
	done: (() => void) | undefined;
	pending: Map<string, PendingApproval>;
}

export interface AgUiAdapterOptions {
	approvalTimeoutMs?: number;
}

const AIKING = "aiking";

export class AgUiAdapter {
	private readonly active = new Map<string, ActiveRun>();
	private readonly approvalTimeoutMs: number;

	constructor(
		private readonly backend: AgentBackend,
		options: AgUiAdapterOptions = {},
	) {
		this.approvalTimeoutMs = options.approvalTimeoutMs ?? 10 * 60_000;
	}

	/**
	 * Handles one AG-UI run. Resolves when this run's event stream is complete
	 * (finished, errored, or suspended on an interrupt).
	 */
	run(agentId: string, input: RunAgentInput, sink: EventSink): Promise<void> {
		return new Promise<void>((resolveStream) => {
			const finishStream = () => resolveStream();
			if (input.resume && input.resume.length > 0) {
				this.resume(input, sink, finishStream);
				return;
			}
			this.start(agentId, input, sink, finishStream);
		});
	}

	/** Interrupts waiting for an answer on a thread (so a reloaded UI can show them again). */
	pendingInterrupts(threadId: string): Interrupt[] {
		return [...(this.active.get(threadId)?.pending.values() ?? [])].map((p) => p.interrupt);
	}

	/** True while an agent loop is running or suspended on this thread. */
	isActive(threadId: string): boolean {
		return this.active.has(threadId);
	}

	private emit(run: ActiveRun, event: BaseEvent): void {
		run.sink?.({ timestamp: Date.now(), ...event });
	}

	/** Ends the AG-UI run currently attached to the agent loop. */
	private endStream(run: ActiveRun, last: BaseEvent): void {
		this.emit(run, last);
		run.sink = undefined;
		const done = run.done;
		run.done = undefined;
		done?.();
	}

	private resume(input: RunAgentInput, sink: EventSink, finishStream: () => void): void {
		const run = this.active.get(input.threadId);
		const started = { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent;
		const unknown = (input.resume ?? []).filter((r) => !run?.pending.has(r.interruptId));
		if (!run || unknown.length > 0) {
			sink({ timestamp: Date.now(), ...started });
			sink({
				timestamp: Date.now(),
				type: EventType.RUN_ERROR,
				message: "This approval request is no longer pending (it expired, was answered, or the app restarted). Send the message again.",
				code: "interrupt_not_found",
			} as BaseEvent);
			finishStream();
			return;
		}
		run.sink = sink;
		run.done = finishStream;
		run.runId = input.runId;
		this.emit(run, started);
		for (const entry of input.resume ?? []) this.answer(run, entry);
	}

	private answer(run: ActiveRun, entry: ResumeEntry): void {
		const pending = run.pending.get(entry.interruptId);
		if (!pending) return;
		run.pending.delete(entry.interruptId);
		clearTimeout(pending.timer);
		const approved = entry.status === "resolved" && (entry.payload as { approved?: unknown } | undefined)?.approved === true;
		this.emit(run, {
			type: EventType.CUSTOM,
			name: `${AIKING}.approval_answered`,
			value: { interruptId: entry.interruptId, approved },
		} as BaseEvent);
		pending.resolve(approved);
	}

	private start(agentId: string, input: RunAgentInput, sink: EventSink, finishStream: () => void): void {
		const started = { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent;
		const text = lastUserText(input.messages);
		if (this.active.has(input.threadId) || !text) {
			sink({ timestamp: Date.now(), ...started });
			sink({
				timestamp: Date.now(),
				type: EventType.RUN_ERROR,
				message: !text ? "The run has no user message." : "This thread already has a run in progress.",
				code: !text ? "no_user_message" : "thread_busy",
			} as BaseEvent);
			finishStream();
			return;
		}
		const run: ActiveRun = { threadId: input.threadId, runId: input.runId, sink, done: finishStream, pending: new Map() };
		this.active.set(input.threadId, run);
		this.emit(run, started);

		const mapper = new EventMapper((event) => this.emit(run, event));
		const approver = (request: PermissionRequest) =>
			new Promise<boolean>((resolve) => {
				const interrupt: Interrupt = {
					id: `int_${randomUUID()}`,
					reason: "tool_call",
					message: `Allow ${request.risk === "dangerous" ? "dangerous" : "side-effect"} tool ${request.tool}?`,
					...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
					responseSchema: {
						type: "object",
						properties: { approved: { type: "boolean" } },
						required: ["approved"],
					},
					expiresAt: new Date(Date.now() + this.approvalTimeoutMs).toISOString(),
					metadata: { tool: request.tool, risk: request.risk, input: request.input },
				};
				const timer = setTimeout(() => {
					run.pending.delete(interrupt.id);
					resolve(false);
				}, this.approvalTimeoutMs);
				run.pending.set(interrupt.id, { interrupt, resolve, timer });
				this.endStream(run, {
					type: EventType.RUN_FINISHED,
					threadId: run.threadId,
					runId: run.runId,
					outcome: { type: "interrupt", interrupts: [interrupt] },
				} as BaseEvent);
			});

		this.backend
			.run({ agentId, threadId: input.threadId, runId: input.runId, text }, { onEvent: (e) => mapper.map(e), approver })
			.then(
				(result) => {
					this.endStream(run, {
						type: EventType.RUN_FINISHED,
						threadId: run.threadId,
						runId: run.runId,
						outcome: { type: "success" },
						result,
					} as BaseEvent);
				},
				(error: unknown) => {
					this.endStream(run, {
						type: EventType.RUN_ERROR,
						message: (error as Error).message,
						code: "run_failed",
					} as BaseEvent);
				},
			)
			.finally(() => {
				for (const p of run.pending.values()) clearTimeout(p.timer);
				this.active.delete(input.threadId);
			});
	}
}

function lastUserText(messages: readonly AgUiMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m?.role !== "user") continue;
		if (typeof m.content === "string") return m.content.trim();
		return m.content
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n")
			.trim();
	}
	return "";
}

/** Maps AIKING runtime events to AG-UI events. */
export class EventMapper {
	private streamed = false;

	constructor(private readonly emit: (event: BaseEvent) => void) {}

	map(event: RuntimeEvent): void {
		const emit = (e: Record<string, unknown>) => this.emit(e as unknown as BaseEvent);
		switch (event.type) {
			case "step":
				this.streamed = false;
				emit({ type: EventType.CUSTOM, name: `${AIKING}.step`, value: { step: event.step } });
				return;
			case "text_start":
				this.streamed = true;
				emit({ type: EventType.TEXT_MESSAGE_START, messageId: event.messageId, role: "assistant" });
				return;
			case "text_delta":
				emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: event.messageId, delta: event.delta });
				return;
			case "text_end":
				emit({ type: EventType.TEXT_MESSAGE_END, messageId: event.messageId });
				return;
			case "text":
				// A provider that did not stream still shows its text once.
				if (!this.streamed && event.text) {
					const messageId = `msg_${randomUUID()}`;
					emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
					emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: event.text });
					emit({ type: EventType.TEXT_MESSAGE_END, messageId });
				}
				return;
			case "tool_call":
				emit({ type: EventType.TOOL_CALL_START, toolCallId: event.id, toolCallName: event.name });
				emit({ type: EventType.TOOL_CALL_ARGS, toolCallId: event.id, delta: JSON.stringify(event.input ?? {}) });
				emit({ type: EventType.TOOL_CALL_END, toolCallId: event.id });
				return;
			case "tool_result":
				emit({
					type: EventType.TOOL_CALL_RESULT,
					messageId: `tool_${event.id}`,
					toolCallId: event.id,
					content: event.content,
					role: "tool",
					...(event.isError ? { metadata: { [`${AIKING}/isError`]: true } } : {}),
				});
				return;
			case "tool_limit":
				emit({ type: EventType.CUSTOM, name: `${AIKING}.tool_limit`, value: event });
				return;
			case "model_fallback":
				emit({ type: EventType.CUSTOM, name: `${AIKING}.model_fallback`, value: event.fallback });
				return;
			case "usage":
				emit({ type: EventType.CUSTOM, name: `${AIKING}.usage`, value: { model: event.model, usage: event.usage } });
				return;
		}
	}
}

/** Thread history as AG-UI messages (user, assistant with tool calls, tool results). */
export function toAgUiMessages(threadId: string, messages: readonly Message[]): AgUiMessage[] {
	const out: AgUiMessage[] = [];
	messages.forEach((m, i) => {
		const id = `${threadId}_${i}`;
		if (typeof m.content === "string") {
			out.push({ id, role: m.role, content: m.content } as AgUiMessage);
			return;
		}
		if (m.role === "user") {
			for (const b of m.content) {
				if (b.type === "tool_result") {
					out.push({
						id: `tool_${b.toolCallId}`,
						role: "tool",
						toolCallId: b.toolCallId,
						content: b.content,
						...(b.isError ? { error: b.content } : {}),
					} as AgUiMessage);
				} else if (b.type === "text") {
					out.push({ id, role: "user", content: b.text } as AgUiMessage);
				}
			}
			return;
		}
		const text = m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
		const toolCalls = m.content.flatMap((b) =>
			b.type === "tool_call"
				? [{ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }]
				: [],
		);
		if (!text && toolCalls.length === 0) return;
		out.push({
			id,
			role: "assistant",
			...(text ? { content: text } : {}),
			...(toolCalls.length ? { toolCalls } : {}),
		} as AgUiMessage);
	});
	return out;
}
