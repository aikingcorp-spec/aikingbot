// Copyright (c) 2026 AIKING. All rights reserved.

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMediaToolsServer, frameSize } from "../demo/media-tools-server.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpHub, renderToolResult, riskFromAnnotations } from "../src/mcp/mcp-hub.ts";
import { ToolRegistry } from "../src/runtime/tools.ts";

const hubs: McpHub[] = [];
afterEach(async () => {
	await Promise.all(hubs.splice(0).map((h) => h.close()));
});

async function hubWithMediaServer(name = "media"): Promise<McpHub> {
	const hub = new McpHub();
	hubs.push(hub);
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	await createMediaToolsServer().connect(serverSide);
	await hub.connect(name, clientSide);
	return hub;
}

describe("frameSize", () => {
	test("landscape, portrait and rounding to 8", () => {
		expect(frameSize("16:9", 1920)).toEqual({ width: 1920, height: 1080 });
		expect(frameSize("4:5", 1536)).toEqual({ width: 1232, height: 1536 });
		expect(() => frameSize("wide", 100)).toThrow();
	});
});

describe("McpHub", () => {
	test("uses authenticated streamable HTTP without exposing credentials in tool names", async () => {
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), enableJsonResponse: true });
		const mcp = createMediaToolsServer(); await mcp.connect(transport);
		let authenticated = 0;
		const server = createServer((req, res) => {
			if (req.headers.authorization !== "Bearer local-fixture") { res.writeHead(401).end(); return; }
			authenticated++; void transport.handleRequest(req, res);
		});
		await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
		const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture port");
		const hub = new McpHub();
		try {
			await hub.connectRemote("media", { type: "http", url: `http://127.0.0.1:${address.port}/mcp`, headers: { authorization: "Bearer local-fixture" } });
			expect((await hub.call("mcp__media__frame_size", { ratio: "1:1", long_edge: 1024 }))?.content).toBe('{"width":1024,"height":1024}');
			expect(authenticated).toBeGreaterThan(2);
			expect(hub.definitions().every(tool => !tool.name.includes("fixture"))).toBe(true);
		} finally { await hub.close(); await mcp.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
	});
	test("exposes server tools with namespaced names and the server's schema", async () => {
		const hub = await hubWithMediaServer();
		const [tool] = hub.definitions();
		expect(tool?.name).toBe("mcp__media__frame_size");
		expect(tool?.inputSchema.required).toEqual(["ratio", "long_edge"]);
	});

	test("routes a call to the server and returns its text", async () => {
		const hub = await hubWithMediaServer();
		const outcome = await hub.call("mcp__media__frame_size", { ratio: "1:1", long_edge: 1024 });
		expect(outcome).toEqual({ content: '{"width":1024,"height":1024}', isError: false });
	});

	test("a tool-level error stays a tool error, not an exception", async () => {
		const hub = await hubWithMediaServer();
		const outcome = await hub.call("mcp__media__frame_size", { ratio: "0:1", long_edge: 1024 });
		expect(outcome?.isError).toBe(true);
	});

	test("input that fails the server schema comes back as an error", async () => {
		const hub = await hubWithMediaServer();
		const outcome = await hub.call("mcp__media__frame_size", { ratio: "1:1", long_edge: 5 });
		expect(outcome?.isError).toBe(true);
	});

	test("unknown tool names are not claimed", async () => {
		const hub = await hubWithMediaServer();
		expect(await hub.call("mcp__other__x", {})).toBeUndefined();
	});

	test("rejects a duplicate or invalid server name", async () => {
		const hub = await hubWithMediaServer();
		const [a] = InMemoryTransport.createLinkedPair();
		await expect(hub.connect("media", a)).rejects.toThrow(/already connected/);
		await expect(hub.connect("bad name", a)).rejects.toThrow(/invalid MCP server name/);
	});

	test("connects to a real stdio server process", async () => {
		const hub = new McpHub();
		hubs.push(hub);
		const tools = await hub.connectStdio("media", {
			command: process.execPath,
			args: [join(import.meta.dir, "..", "demo", "media-tools-server.ts")],
		});
		expect(tools).toEqual([
			"mcp__media__frame_size",
			"mcp__media__shot_timing",
			"mcp__media__submit_render",
			"mcp__media__purge_renders",
		]);
		const outcome = await hub.call("mcp__media__frame_size", { ratio: "9:16", long_edge: 1920 });
		expect(outcome?.content).toBe('{"width":1080,"height":1920}');
	});
});

describe("tool risk and capability metadata", () => {
	test("risk follows MCP annotation defaults: unannotated tools are dangerous", () => {
		expect(riskFromAnnotations({ readOnlyHint: true })).toBe("read");
		expect(riskFromAnnotations({ readOnlyHint: false, destructiveHint: false })).toBe("side_effect");
		expect(riskFromAnnotations({ readOnlyHint: false })).toBe("dangerous");
		expect(riskFromAnnotations(undefined)).toBe("dangerous");
	});

	test("hub reads risk and capability from the server, and operator overrides win", async () => {
		const hub = new McpHub();
		hubs.push(hub);
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		await createMediaToolsServer().connect(serverSide);
		await hub.connect("media", clientSide, { toolRisk: { shot_timing: "side_effect" } });
		const byName = Object.fromEntries(hub.toolInfo().map((t) => [t.name, t]));
		expect(byName.mcp__media__frame_size?.risk).toBe("read");
		expect(byName.mcp__media__frame_size?.capability?.outputs).toEqual(["frame-spec"]);
		expect(byName.mcp__media__shot_timing?.risk).toBe("side_effect");
		expect(byName.mcp__media__submit_render?.risk).toBe("side_effect");
		expect(byName.mcp__media__purge_renders?.risk).toBe("dangerous");
	});

	test("a slow MCP tool is cut off by the registry timeout", async () => {
		const server = new McpServer({ name: "slow", version: "0" });
		server.registerTool("wait", { annotations: { readOnlyHint: true } }, async () => {
			await Bun.sleep(2_000);
			return { content: [{ type: "text", text: "late" }] };
		});
		const hub = new McpHub();
		hubs.push(hub);
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		await server.connect(serverSide);
		await hub.connect("slow", clientSide);
		const events: string[] = [];
		const registry = new ToolRegistry([hub], { timeoutMs: 50 }, (e) => events.push(e.type));
		const started = Date.now();
		const outcome = await registry.call("mcp__slow__wait", {});
		expect(Date.now() - started).toBeLessThan(1_000);
		expect(outcome).toMatchObject({ isError: true });
		expect(outcome.content).toContain("timed out after 50 ms");
		expect(events).toEqual(["timeout"]);
	});
});

describe("renderToolResult", () => {
	test("keeps text, marks non-text content, and falls back to structured content", () => {
		expect(
			renderToolResult({
				content: [
					{ type: "text", text: "a" },
					{ type: "image", mimeType: "image/png", data: "..." },
				],
			}),
		).toEqual({ content: "a\n[image image/png content omitted]", isError: false });
		expect(renderToolResult({ content: [], structuredContent: { ok: 1 } }).content).toBe('{"ok":1}');
	});
});
