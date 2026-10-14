// Copyright (c) 2026 AIKING. All rights reserved.
//
// Terminal chat. Reads `aiking.config.json` from the working directory:
// { "skillsDir": "skills", "mcpServers": { "<name>": { "command": "...", "args": [] } } }
// The transcript is kept in .aiking/chat.jsonl.

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { createCore } from "./core.ts";
import { AnthropicModel } from "./runtime/anthropic-model.ts";
import type { StdioServerConfig } from "./mcp/mcp-hub.ts";

interface FileConfig {
	skillsDir?: string;
	mcpServers?: Record<string, StdioServerConfig>;
	model?: string;
}

const config = JSON.parse(await readFile("aiking.config.json", "utf8").catch(() => "{}")) as FileConfig;
const core = await createCore({
	model: new AnthropicModel({ model: config.model }),
	skillsDir: config.skillsDir,
	mcpServers: config.mcpServers,
	transcriptPath: ".aiking/chat.jsonl",
	onEvent: (event) => {
		if (event.type === "tool_call") console.log(`  → ${event.name}`);
		if (event.type === "tool_result" && event.isError) console.log(`  ← error: ${event.content}`);
	},
});
for (const warning of core.warnings) console.warn(`warning: ${warning}`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
	for (;;) {
		const line = (await rl.question("you> ")).trim();
		if (line === "/exit") break;
		if (!line) continue;
		try {
			const result = await core.chat.send(line);
			console.log(`aiking> ${result.text}${result.status === "completed" ? "" : ` [${result.status}]`}`);
		} catch (error) {
			console.error(`error: ${(error as Error).message}`);
		}
	}
} finally {
	rl.close();
	await core.close();
}
