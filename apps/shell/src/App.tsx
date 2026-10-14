// Copyright (c) 2026 AIKING. All rights reserved.
//
// AIKINGBOT shell: agent sidebar, streaming chat, tool activity, approvals
// and the capability catalog. Talks to the gateway only through AG-UI
// (agui-client.ts). Visual language follows OpenBot (design tokens, agent
// rows and avatars vendored from OpenBot v0.1.11, Apache-2.0).

import { createEffect, createMemo, createResource, createSignal, For, Match, on, onMount, Show, Switch } from "solid-js";
import { type AgentInfo, api, applyEvent, type CapabilityInfo, type Item, itemsFromMessages, runAgent, type ThreadInfo } from "./agui-client.ts";
import { AgentMark, type BotAvatarShape } from "./vendor/openbot-v0.1.11/AgentMark.tsx";

const SHAPES: Record<string, BotAvatarShape> = { producer: "cloud", assistant: "blob" };

function remember(key: string, value?: string): string | undefined {
	try {
		if (value === undefined) return localStorage.getItem(key) ?? undefined;
		localStorage.setItem(key, value);
	} catch {
		// Storage can be blocked; selection is a convenience only.
	}
	return value;
}

function Avatar(props: { agent: AgentInfo }) {
	return (
		<span class={`bot-avatar bot-avatar-${props.agent.color}`} aria-hidden="true">
			<AgentMark shape={SHAPES[props.agent.id] ?? "pebble"} />
		</span>
	);
}

type Status = "idle" | "working" | "approval";

export function App() {
	const [agents] = createResource(api.agents);
	const [capabilities] = createResource(api.capabilities);
	const [agentId, setAgentId] = createSignal<string>(remember("aiking.agent") ?? "producer");
	const [threadId, setThreadId] = createSignal<string | undefined>(remember("aiking.thread"));
	const [threads, { refetch: refetchThreads }] = createResource(agentId, api.threads);
	const [items, setItems] = createSignal<Item[]>([]);
	const [status, setStatus] = createSignal<Status>("idle");
	const [draft, setDraft] = createSignal("");
	const [panel, setPanel] = createSignal<"activity" | "skills">("activity");
	let scroller: HTMLDivElement | undefined;

	const agent = createMemo(() => agents()?.find((a) => a.id === agentId()));

	// Load the saved conversation whenever the selected thread changes (also after a restart).
	createEffect(
		on(threadId, async (id) => {
			remember("aiking.thread", id ?? "");
			if (!id) return setItems([]);
			try {
				const [messages, pending] = await Promise.all([api.messages(id), api.pending(id)]);
				const restored = itemsFromMessages(messages);
				// The turn in progress is saved only when it finishes; show its open approvals.
				for (const interrupt of pending.interrupts) restored.push({ kind: "approval", id: interrupt.id, interrupt, status: "pending" });
				setItems(restored);
				setStatus(pending.interrupts.length > 0 ? "approval" : pending.active ? "working" : "idle");
			} catch (error) {
				setItems([{ kind: "error", id: "load", text: (error as Error).message }]);
			}
		}),
	);
	createEffect(() => remember("aiking.agent", agentId()));
	createEffect(
		on(items, () => {
			queueMicrotask(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
		}),
	);

	const stream = async (input: Parameters<typeof runAgent>[1]) => {
		setStatus("working");
		let interrupted = false;
		try {
			await runAgent(agentId(), input, (event) => {
				if (event.type === "RUN_FINISHED" && (event.outcome as { type?: string } | undefined)?.type === "interrupt") interrupted = true;
				setItems((list) => applyEvent(list, event));
			});
		} catch (error) {
			setItems((list) => [...list, { kind: "error", id: crypto.randomUUID(), text: (error as Error).message }]);
		}
		setStatus(interrupted ? "approval" : "idle");
		refetchThreads();
	};

	const send = async (event: Event) => {
		event.preventDefault();
		const text = draft().trim();
		if (!text || status() !== "idle") return;
		let id = threadId();
		if (!id) {
			id = crypto.randomUUID();
			setThreadId(id);
		}
		setDraft("");
		setItems((list) => [...list, { kind: "user", id: crypto.randomUUID(), text }]);
		await stream({ threadId: id, text });
	};

	const answer = async (interruptId: string, approved: boolean) => {
		const id = threadId();
		if (!id) return;
		setItems((list) => list.map((it) => (it.kind === "approval" && it.id === interruptId ? { ...it, status: "sending" } : it)));
		await stream({ threadId: id, resume: [{ interruptId, status: "resolved", payload: { approved } }] });
	};

	const selectAgent = (id: string) => {
		if (status() !== "idle") return;
		setAgentId(id);
		setThreadId(undefined);
	};

	const tools = createMemo(() => items().filter((it): it is Extract<Item, { kind: "tool" }> => it.kind === "tool"));
	const skills = createMemo(() => (capabilities() ?? []).filter((c) => c.kind === "skill"));
	const mcpTools = createMemo(() => (capabilities() ?? []).filter((c) => c.kind === "tool"));

	onMount(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus());

	return (
		<div class="shell">
			<aside class="sidebar shell-sidebar">
				<div class="shell-brand">
					<strong>AIKINGBOT</strong>
					<span class="shell-badge">v0.2 prototype</span>
				</div>
				<div class="shell-section-label">Agents</div>
				<nav class="shell-agents">
					<For each={agents()}>
						{(a) => (
							<button type="button" class={`bot-row ${a.id === agentId() ? "bot-row-active" : ""}`} onClick={() => selectAgent(a.id)}>
								<span class="bot-row-avatar">
									<Avatar agent={a} />
								</span>
								<span class="bot-row-copy">
									<span class="bot-row-heading">
										<strong>{a.name}</strong>
									</span>
									<span class="bot-row-preview">
										{a.id === agentId() && status() === "working"
											? "Working…"
											: a.id === agentId() && status() === "approval"
												? "Waiting for approval"
												: a.description}
									</span>
								</span>
							</button>
						)}
					</For>
				</nav>
				<div class="shell-section-label shell-threads-label">
					<span>Conversations</span>
					<button type="button" class="shell-link" disabled={status() !== "idle"} onClick={() => setThreadId(undefined)}>
						+ New
					</button>
				</div>
				<nav class="shell-threads">
					<For each={threads()} fallback={<div class="shell-empty">No conversations yet</div>}>
						{(t: ThreadInfo) => (
							<button
								type="button"
								class={`shell-thread ${t.id === threadId() ? "shell-thread-active" : ""}`}
								disabled={status() !== "idle"}
								onClick={() => setThreadId(t.id)}
								title={t.title}
							>
								{t.title || "Untitled"}
							</button>
						)}
					</For>
				</nav>
				<div class="shell-footer">
					<span class={`shell-dot shell-dot-${status()}`} />
					Local · offline demo model
				</div>
			</aside>

			<main class="shell-main">
				<header class="shell-header">
					<Show when={agent()}>{(a) => <Avatar agent={a()} />}</Show>
					<div>
						<strong>{agent()?.name ?? "…"}</strong>
						<span class="shell-subtle">{agent()?.description}</span>
					</div>
				</header>
				<div class="shell-messages" ref={scroller}>
					<Show when={items().length === 0}>
						<div class="shell-welcome">
							<p>Start with an idea, for example:</p>
							<button type="button" class="shell-suggestion" onClick={() => setDraft("15-second TikTok ad for our matte black tumbler, queue it for render")}>
								15-second TikTok ad for our matte black tumbler, queue it for render
							</button>
						</div>
					</Show>
					<For each={items()}>
						{(it) => (
							<Switch>
								<Match when={it.kind === "user" && it}>{(u) => <div class="msg msg-user">{u().text}</div>}</Match>
								<Match when={it.kind === "assistant" && it}>
									{(m) => (
										<div class="msg msg-assistant">
											{m().text}
											<Show when={m().streaming}>
												<span class="caret" />
											</Show>
										</div>
									)}
								</Match>
								<Match when={it.kind === "tool" && it}>
									{(t) => (
										<details class={`tool tool-${t().status}`}>
											<summary>
												<span class="tool-state" />
												<span class="tool-name">{t().name}</span>
												<span class="tool-status">{t().status === "awaiting" ? "needs approval" : t().status}</span>
											</summary>
											<pre>{t().args}</pre>
											<Show when={t().result}>
												<pre class="tool-result">{t().result}</pre>
											</Show>
										</details>
									)}
								</Match>
								<Match when={it.kind === "approval" && it}>
									{(a) => (
										<div class={`approval approval-${a().status}`}>
											<div class="approval-title">{a().interrupt.message ?? "Approval needed"}</div>
											<pre>{JSON.stringify((a().interrupt.metadata as { input?: unknown } | undefined)?.input ?? {}, null, 2).slice(0, 600)}</pre>
											<Switch>
												<Match when={a().status === "pending"}>
													<div class="approval-actions">
														<button type="button" class="btn btn-primary" onClick={() => answer(a().id, true)}>
															Approve
														</button>
														<button type="button" class="btn" onClick={() => answer(a().id, false)}>
															Decline
														</button>
													</div>
												</Match>
												<Match when={a().status === "sending"}>
													<div class="shell-subtle">Sending…</div>
												</Match>
												<Match when={true}>
													<div class="shell-subtle">{a().status === "approved" ? "Approved" : "Declined"}</div>
												</Match>
											</Switch>
										</div>
									)}
								</Match>
								<Match when={it.kind === "error" && it}>{(e) => <div class="msg msg-error">{e().text}</div>}</Match>
							</Switch>
						)}
					</For>
				</div>
				<form class="composer" onSubmit={send}>
					<textarea
						rows={2}
						placeholder={status() === "approval" ? "Answer the approval request above first" : `Message ${agent()?.name ?? ""}`}
						value={draft()}
						disabled={status() !== "idle"}
						onInput={(e) => setDraft(e.currentTarget.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) send(e);
						}}
					/>
					<button type="submit" class="btn btn-primary" disabled={status() !== "idle" || !draft().trim()}>
						Send
					</button>
				</form>
			</main>

			<aside class="shell-panel">
				<div class="shell-tabs">
					<button type="button" classList={{ active: panel() === "activity" }} onClick={() => setPanel("activity")}>
						Activity
					</button>
					<button type="button" classList={{ active: panel() === "skills" }} onClick={() => setPanel("skills")}>
						Skills & MCP
					</button>
				</div>
				<Show
					when={panel() === "activity"}
					fallback={
						<div class="shell-catalog">
							<h4>Skills</h4>
							<For each={skills()}>{(c) => <CapabilityCard c={c} />}</For>
							<h4>MCP tools</h4>
							<For each={mcpTools()}>{(c) => <CapabilityCard c={c} />}</For>
						</div>
					}
				>
					<ol class="timeline">
						<For each={tools()} fallback={<li class="shell-empty">No tool activity in this conversation</li>}>
							{(t) => (
								<li class={`timeline-item tool-${t.status}`}>
									<span class="tool-state" />
									<span class="timeline-name">{t.name.replace(/^mcp__(\w+)__/, "$1 · ")}</span>
									<span class="timeline-meta">
										{t.status === "awaiting" ? "needs approval" : t.status}
										{t.finishedAt && t.startedAt ? ` · ${t.finishedAt - t.startedAt} ms` : ""}
									</span>
								</li>
							)}
						</For>
					</ol>
				</Show>
			</aside>
		</div>
	);
}

function CapabilityCard(props: { c: CapabilityInfo }) {
	return (
		<div class="cap">
			<div class="cap-head">
				<strong>{props.c.id.replace(/^mcp__(\w+)__/, "$1 · ")}</strong>
				<span class={`risk risk-${props.c.risk}`}>{props.c.risk.replace("_", " ")}</span>
			</div>
			<div class="cap-summary">{props.c.summary}</div>
			<Show when={props.c.inputs.length + props.c.outputs.length > 0}>
				<div class="cap-io">
					{props.c.inputs.join(", ") || "—"} → {props.c.outputs.join(", ") || "—"}
				</div>
			</Show>
		</div>
	);
}
