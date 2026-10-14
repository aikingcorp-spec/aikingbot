// Copyright (c) 2026 AIKING. All rights reserved.

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMediaToolsServer, frameSize } from "../demo/media-tools-server.ts";
import { McpHub, renderToolResult } from "../src/mcp/mcp-hub.ts";

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
	test("exposes server tools with namespaced names and the server's schema", async () => {
		const hub = await hubWithMediaServer();
		const [tool] = hub.definitions();
		expect(tool?.name).toBe("mcp__media__frame_size");
		expect(tool?.input_schema.required).toEqual(["ratio", "long_edge"]);
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
		expect(tools).toEqual(["mcp__media__frame_size"]);
		const outcome = await hub.call("mcp__media__frame_size", { ratio: "9:16", long_edge: 1920 });
		expect(outcome?.content).toBe('{"width":1080,"height":1920}');
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
