// Copyright (c) 2026 AIKING. All rights reserved.
//
// Demo MCP server (stdio) built with the official MCP TypeScript SDK.
// Tool `frame_size`: pixel size for an aspect ratio and a long edge,
// rounded to a multiple of 8 (a common limit of image models).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

export function frameSize(ratio: string, longEdge: number): { width: number; height: number } {
	const match = /^(\d+):(\d+)$/.exec(ratio.trim());
	if (!match) throw new Error(`ratio must look like "16:9", got "${ratio}"`);
	const w = Number(match[1]);
	const h = Number(match[2]);
	if (w === 0 || h === 0) throw new Error("ratio parts must be greater than 0");
	const round8 = (n: number) => Math.max(8, Math.round(n / 8) * 8);
	return w >= h
		? { width: round8(longEdge), height: round8((longEdge * h) / w) }
		: { width: round8((longEdge * w) / h), height: round8(longEdge) };
}

export function createMediaToolsServer(): McpServer {
	const server = new McpServer({ name: "aiking-media-tools", version: "0.1.0" });
	server.registerTool(
		"frame_size",
		{
			description: "Pixel width and height for an aspect ratio and a long edge, rounded to a multiple of 8.",
			inputSchema: {
				ratio: z.string().describe('Aspect ratio, for example "4:5" or "16:9".'),
				long_edge: z.number().int().min(64).max(8192).describe("Long edge in pixels."),
			},
		},
		async ({ ratio, long_edge }) => {
			try {
				const size = frameSize(ratio, long_edge);
				return { content: [{ type: "text", text: JSON.stringify(size) }] };
			} catch (error) {
				return { content: [{ type: "text", text: (error as Error).message }], isError: true };
			}
		},
	);
	return server;
}

if (import.meta.main) {
	await createMediaToolsServer().connect(new StdioServerTransport());
}
