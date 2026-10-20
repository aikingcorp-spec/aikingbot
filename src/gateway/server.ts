// Copyright (c) 2026 AIKING. All rights reserved.
//
// Local HTTP gateway for the shell UI. Binds to 127.0.0.1 only.
//
//   GET  /api/agents                      agents (sidebar)
//   GET  /api/agents/:id/threads          threads of an agent
//   GET  /api/threads/:id/messages        history as AG-UI messages
//   GET  /api/threads/:id/pending         interrupts waiting for approval, and whether a run is active
//   GET  /api/skills                      skill catalog
//   GET  /api/capabilities                skills + tools with risk, inputs, outputs
//   POST /api/agents/:id/run              AG-UI RunAgentInput -> SSE stream of AG-UI events
//   GET  /*                               built shell UI (when `staticDir` is set)

import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import { join, normalize } from "node:path";
import { AgUiAdapter, toAgUiMessages } from "./ag-ui-adapter.ts";
import type { AgentBackend } from "./agent-backend.ts";

export interface GatewayOptions {
	backend: AgentBackend;
	port?: number;
	hostname?: string;
	staticDir?: string;
	approvalTimeoutMs?: number;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function startGateway(options: GatewayOptions) {
	const { backend } = options;
	const adapter = new AgUiAdapter(backend, { approvalTimeoutMs: options.approvalTimeoutMs });

	const runStream = (agentId: string, input: Parameters<AgUiAdapter["run"]>[1]) => {
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				let open = true;
				adapter
					.run(agentId, input, (event) => {
						if (open) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
					})
					.finally(() => {
						open = false;
						controller.close();
					});
			},
		});
		return new Response(stream, {
			headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
		});
	};

	const serveStatic = async (pathname: string) => {
		if (!options.staticDir) return new Response("Not found", { status: 404 });
		const root = normalize(options.staticDir);
		const target = normalize(join(root, pathname === "/" ? "index.html" : pathname));
		if (!target.startsWith(root)) return new Response("Not found", { status: 404 });
		const file = Bun.file(target);
		if (await file.exists()) return new Response(file);
		return new Response(Bun.file(join(root, "index.html"))); // single-page app fallback
	};

	return Bun.serve({
		hostname: options.hostname ?? "127.0.0.1",
		port: options.port ?? 4317,
		idleTimeout: 0, // SSE streams stay open while the agent works
		async fetch(request) {
			const url = new URL(request.url);
			const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
			try {
				if (parts[0] !== "api") return serveStatic(url.pathname);
				const [, resource, id, sub] = parts;
				if (request.method === "GET") {
					if (resource === "agents" && !id) return json({ agents: backend.listAgents() });
					if (resource === "agents" && id && sub === "threads") return json({ threads: backend.listThreads(id) });
					if (resource === "threads" && id && sub === "messages") {
						return json({ messages: toAgUiMessages(id, await backend.history(id)) });
					}
					if (resource === "threads" && id && sub === "pending") {
						return json({ active: adapter.isActive(id), interrupts: adapter.pendingInterrupts(id) });
					}
					if (resource === "skills") return json({ skills: backend.skills() });
					if (resource === "capabilities") return json({ capabilities: backend.capabilities() });
				}
				if (request.method === "POST" && resource === "agents" && id && sub === "run") {
					const parsed = RunAgentInputSchema.safeParse(await request.json());
					if (!parsed.success) return json({ error: "invalid RunAgentInput", issues: parsed.error.issues }, 400);
					return runStream(id, parsed.data);
				}
				return json({ error: "not found" }, 404);
			} catch (error) {
				return json({ error: (error as Error).message }, 500);
			}
		},
	});
}
