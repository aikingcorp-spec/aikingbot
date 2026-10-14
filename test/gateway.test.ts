// Copyright (c) 2026 AIKING. All rights reserved.
//
// UI contract: SQLite store, AG-UI adapter (events validated against the
// official @ag-ui/core schemas), approvals through interrupts, and the HTTP
// gateway surviving a restart. Offline model, real MCP stdio server.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BaseEvent, ResumeEntry, RunAgentInput } from "@ag-ui/core";
import { EventSchemas } from "@ag-ui/core/schemas";
import { OfflineProducerModel } from "../demo/offline-producer.ts";
import { AgUiAdapter } from "../src/gateway/ag-ui-adapter.ts";
import { CoreBackend } from "../src/gateway/agent-backend.ts";
import { startGateway } from "../src/gateway/server.ts";
import { MIGRATIONS, SqliteStore } from "../src/store/sqlite-store.ts";

const root = join(import.meta.dir, "..");
const IDEA = "15-second TikTok ad for our matte black tumbler, queue it for render";
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
	for (const c of cleanups.splice(0).reverse()) await c();
});

async function backendAt(dataDir: string) {
	const store = new SqliteStore(join(dataDir, "aiking.db"));
	const backend = await CoreBackend.create({
		store,
		agents: [{ id: "producer", name: "Media Producer", description: "", color: "orange" }],
		core: {
			model: new OfflineProducerModel(0),
			skillsDir: join(root, "demo", "skills"),
			mcpServers: {
				media: {
					command: process.execPath,
					args: [join(root, "demo", "media-tools-server.ts")],
					env: { ...(process.env as Record<string, string>), AIKING_JOBS_DIR: join(dataDir, "jobs") },
				},
			},
		},
	});
	cleanups.push(async () => {
		await backend.close();
		store.close();
	});
	return { store, backend };
}

function collect() {
	const events: (BaseEvent & Record<string, unknown>)[] = [];
	return { events, sink: (e: BaseEvent) => events.push(e as BaseEvent & Record<string, unknown>) };
}
const types = (events: { type: string }[]) => events.map((e) => e.type);
const input = (threadId: string, runId: string, text?: string, resume?: ResumeEntry[]): RunAgentInput => ({
	threadId,
	runId,
	messages: text ? [{ id: `u_${runId}`, role: "user" as const, content: text }] : [],
	tools: [],
	context: [],
	...(resume ? { resume } : {}),
});

describe("SqliteStore", () => {
	test("applies migrations once, records the version, and refuses a newer schema", async () => {
		const path = join(await mkdtemp(join(tmpdir(), "aiking-db-")), "a.db");
		const a = new SqliteStore(path);
		expect(a.schemaVersion()).toBe(MIGRATIONS.length);
		a.close();
		const b = new SqliteStore(path); // reopening does not re-run migrations
		expect(b.schemaVersion()).toBe(MIGRATIONS.length);
		b.close();
		const newer = new SqliteStore(path, [...MIGRATIONS, "CREATE TABLE extra (x INTEGER);"]);
		expect(newer.schemaVersion()).toBe(MIGRATIONS.length + 1);
		newer.close();
		expect(() => new SqliteStore(path)).toThrow(/newer than this app/);
	});

	test("messages round-trip in order", async () => {
		const store = new SqliteStore(":memory:");
		store.upsertAgent({ id: "a", name: "A", description: "", color: "teal" });
		store.createThread("t", "a", "hello");
		store.appendMessages("t", [{ role: "user", content: "hi" }]);
		const turn = [
			{ role: "assistant" as const, content: [{ type: "tool_call" as const, id: "c1", name: "x", input: { a: 1 } }] },
			{ role: "user" as const, content: [{ type: "tool_result" as const, toolCallId: "c1", content: "ok", isError: false }] },
		];
		store.appendMessages("t", turn);
		expect(store.loadMessages("t")).toEqual([{ role: "user", content: "hi" }, ...turn]);
		expect(() => store.createThread("t2", "missing-agent", "x")).toThrow(); // foreign keys are on
		store.close();
	});

	test("run records and crash recovery", async () => {
		const dir = await mkdtemp(join(tmpdir(), "aiking-db-"));
		const store = new SqliteStore(join(dir, "a.db"));
		store.upsertAgent({ id: "a", name: "A", description: "", color: "teal" });
		store.createThread("t", "a", "hello");
		store.appendMessages("t", [{ role: "user", content: "hi" }]);
		store.startRun("r1", "t");
		store.finishRun("t", "r1", { status: "completed", costUsd: 0.5, servedBy: ["m1", "m2"] });
		store.startRun("r2", "t"); // left running, as after a crash
		expect(store.recoverInterruptedRuns()).toBe(1);
		expect(store.listRuns("t").map((r) => [r.id, r.status, r.costUsd, r.servedBy])).toEqual([
			["r1", "completed", 0.5, "m1,m2"],
			["r2", "interrupted", null, null],
		]);
		store.backup(join(dir, "backup", "copy.db"));
		store.close();
		const copy = new SqliteStore(join(dir, "backup", "copy.db"));
		expect(copy.loadMessages("t")).toEqual([{ role: "user", content: "hi" }]);
		copy.close();
	});
});

describe("AgUiAdapter", () => {
	test("streams valid AG-UI events, suspends on approval, and continues on resume", async () => {
		const dir = await mkdtemp(join(tmpdir(), "aiking-gw-"));
		const { backend, store } = await backendAt(dir);
		const adapter = new AgUiAdapter(backend);

		const first = collect();
		await adapter.run("producer", input("t1", "r1", IDEA), first.sink);
		for (const e of first.events) expect(EventSchemas.safeParse(e).success).toBe(true);
		expect(first.events[0]).toMatchObject({ type: "RUN_STARTED", threadId: "t1", runId: "r1" });
		expect(types(first.events)).toContain("TEXT_MESSAGE_CONTENT");
		const toolNames = first.events.filter((e) => e.type === "TOOL_CALL_START").map((e) => e.toolCallName);
		expect(toolNames).toEqual([
			"plan_capabilities",
			"read_skill",
			"read_skill",
			"read_skill",
			"mcp__media__frame_size",
			"mcp__media__shot_timing",
			"mcp__media__submit_render",
		]);
		const last = first.events.at(-1) as unknown as { type: string; outcome: { type: string; interrupts: { id: string; toolCallId: string; metadata: { tool: string } }[] } };
		expect(last.type).toBe("RUN_FINISHED");
		expect(last.outcome.type).toBe("interrupt");
		const [interrupt] = last.outcome.interrupts;
		expect(interrupt?.metadata.tool).toBe("mcp__media__submit_render");
		const renderCall = first.events.find((e) => e.toolCallName === "mcp__media__submit_render");
		expect(interrupt?.toolCallId).toBe(renderCall?.toolCallId as string);
		// Nothing ran yet and the unfinished turn is not saved.
		expect(await readdir(join(dir, "jobs")).catch(() => [])).toEqual([]);
		expect(adapter.pendingInterrupts("t1").map((i) => i.id)).toEqual([interrupt?.id as string]);
		expect(store.loadMessages("t1")).toEqual([]);

		const second = collect();
		await adapter.run("producer", input("t1", "r2", undefined, [{ interruptId: interrupt?.id as string, status: "resolved", payload: { approved: true } }]), second.sink);
		for (const e of second.events) expect(EventSchemas.safeParse(e).success).toBe(true);
		expect(second.events[0]).toMatchObject({ type: "RUN_STARTED", runId: "r2" });
		expect(second.events.find((e) => e.type === "TOOL_CALL_RESULT")?.content).toContain('"status":"queued"');
		expect(second.events.at(-1)).toMatchObject({ type: "RUN_FINISHED", runId: "r2", outcome: { type: "success" } });
		expect(await readdir(join(dir, "jobs"))).toHaveLength(1);
		expect(store.loadMessages("t1").length).toBeGreaterThan(8);
		expect(store.listRuns("t1").map((r) => r.status)).toEqual(["completed"]);
	});

	test("declining an approval does not run the tool; the agent reports it", async () => {
		const dir = await mkdtemp(join(tmpdir(), "aiking-gw-"));
		const { backend } = await backendAt(dir);
		const adapter = new AgUiAdapter(backend);
		const first = collect();
		await adapter.run("producer", input("t1", "r1", IDEA), first.sink);
		const id = (first.events.at(-1) as unknown as { outcome: { interrupts: { id: string }[] } }).outcome.interrupts[0]?.id;
		const second = collect();
		await adapter.run("producer", input("t1", "r2", undefined, [{ interruptId: id as string, status: "resolved", payload: { approved: false } }]), second.sink);
		const result = second.events.find((e) => e.type === "TOOL_CALL_RESULT");
		expect(result?.content).toContain("Permission denied");
		expect(result?.metadata).toEqual({ "aiking/isError": true });
		expect(await readdir(join(dir, "jobs")).catch(() => [])).toEqual([]);
		expect(second.events.at(-1)).toMatchObject({ type: "RUN_FINISHED", outcome: { type: "success" } });
	});

	test("an unanswered approval expires as declined", async () => {
		const dir = await mkdtemp(join(tmpdir(), "aiking-gw-"));
		const { backend } = await backendAt(dir);
		const adapter = new AgUiAdapter(backend, { approvalTimeoutMs: 50 });
		await adapter.run("producer", input("t1", "r1", IDEA), collect().sink);
		await Bun.sleep(300);
		expect(adapter.isActive("t1")).toBe(false);
		expect(await readdir(join(dir, "jobs")).catch(() => [])).toEqual([]);
		expect(JSON.stringify(await backend.history("t1"))).toContain("approval for");
	});

	test("unknown interrupts, busy threads and empty runs end with RUN_ERROR", async () => {
		const dir = await mkdtemp(join(tmpdir(), "aiking-gw-"));
		const { backend } = await backendAt(dir);
		const adapter = new AgUiAdapter(backend);
		const stale = collect();
		await adapter.run("producer", input("t9", "r1", undefined, [{ interruptId: "int_x", status: "resolved" }]), stale.sink);
		expect(stale.events.at(-1)).toMatchObject({ type: "RUN_ERROR", code: "interrupt_not_found" });

		await adapter.run("producer", input("t1", "r1", IDEA), collect().sink); // suspended on approval
		const busy = collect();
		await adapter.run("producer", input("t1", "r2", "again"), busy.sink);
		expect(busy.events.at(-1)).toMatchObject({ type: "RUN_ERROR", code: "thread_busy" });

		const empty = collect();
		await adapter.run("producer", input("t2", "r1"), empty.sink);
		expect(empty.events.at(-1)).toMatchObject({ type: "RUN_ERROR", code: "no_user_message" });
	});
});

describe("HTTP gateway", () => {
	test("serves AG-UI over SSE and restores the conversation after a restart", async () => {
		const dir = await mkdtemp(join(tmpdir(), "aiking-http-"));
		const runOnce = async () => {
			const { backend, store } = await backendAt(dir);
			const server = startGateway({ backend, port: 0 });
			return { server, store, base: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
		};
		const sse = async (url: string, body: unknown) => {
			const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
			expect(res.headers.get("content-type")).toBe("text/event-stream");
			return (await res.text())
				.split("\n\n")
				.filter((f) => f.startsWith("data: "))
				.map((f) => JSON.parse(f.slice(6)) as Record<string, unknown>);
		};

		const a = await runOnce();
		expect((await (await fetch(`${a.base}/api/agents`)).json()).agents[0].id).toBe("producer");
		const caps = (await (await fetch(`${a.base}/api/capabilities`)).json()).capabilities as { id: string; risk: string }[];
		expect(caps.find((c) => c.id === "mcp__media__submit_render")?.risk).toBe("side_effect");
		const bad = await fetch(`${a.base}/api/agents/producer/run`, { method: "POST", body: "{}" });
		expect(bad.status).toBe(400);

		const first = await sse(`${a.base}/api/agents/producer/run`, input("t1", "r1", IDEA));
		const interruptId = (first.at(-1) as { outcome: { interrupts: { id: string }[] } }).outcome.interrupts[0]?.id;
		const pending = await (await fetch(`${a.base}/api/threads/t1/pending`)).json();
		expect(pending).toMatchObject({ active: true, interrupts: [{ id: interruptId }] });
		const second = await sse(`${a.base}/api/agents/producer/run`, input("t1", "r2", undefined, [{ interruptId: interruptId as string, status: "resolved", payload: { approved: true } }]));
		expect(second.at(-1)).toMatchObject({ type: "RUN_FINISHED", outcome: { type: "success" } });
		const before = (await (await fetch(`${a.base}/api/threads/t1/messages`)).json()).messages;
		a.stop();
		await cleanups.splice(0).reverse().reduce((p, c) => p.then(c), Promise.resolve());

		const b = await runOnce();
		expect((await (await fetch(`${b.base}/api/agents/producer/threads`)).json()).threads.map((t: { id: string }) => t.id)).toEqual(["t1"]);
		const after = (await (await fetch(`${b.base}/api/threads/t1/messages`)).json()).messages;
		expect(after).toEqual(before);
		expect(after[0]).toMatchObject({ role: "user", content: IDEA });
		expect(after.some((m: { role: string; toolCalls?: { function: { name: string } }[] }) => m.toolCalls?.some((c) => c.function.name === "mcp__media__submit_render"))).toBe(true);
		b.stop();
	});
});
