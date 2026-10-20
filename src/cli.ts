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
import type { ToolPolicy } from "./runtime/tools.ts";

interface FileConfig {
	skillsDir?: string;
	mcpServers?: Record<string, StdioServerConfig>;
	model?: string;
	/** Tool names (exposed names) allowed without asking / allowed to ask at dangerous risk. */
	preapproved?: string[];
	allowDangerous?: string[];
	toolTimeoutMs?: number;
}

const config = JSON.parse(await readFile("aiking.config.json", "utf8").catch(() => "{}")) as FileConfig;
const rl = createInterface({ input: process.stdin, output: process.stdout });
const policy: ToolPolicy = {
	preapproved: config.preapproved,
	allowDangerous: config.allowDangerous,
	timeoutMs: config.toolTimeoutMs,
	// Every side-effect call not preapproved is asked in the terminal; the default answer is no.
	approver: async ({ tool, risk, input }) =>
		(await rl.question(`  ? allow ${risk} tool ${tool} ${JSON.stringify(input)} [y/N] `)).trim().toLowerCase() === "y",
};
const core = await createCore({
	model: new AnthropicModel({ model: config.model }),
	skillsDir: config.skillsDir,
	mcpServers: config.mcpServers,
	transcriptPath: ".aiking/chat.jsonl",
	toolPolicy: policy,
	onEvent: (event) => {
		if (event.type === "tool_call") console.log(`  → ${event.name}`);
		if (event.type === "tool_result" && event.isError) console.log(`  ← error: ${event.content}`);
		if (event.type === "model_fallback") console.log(`  ! model fallback ${event.fallback.from} → ${event.fallback.to} (${event.fallback.reason})`);
	},
	onGuard: (event) => console.log(`  ! ${event.type === "denied" ? `denied ${event.tool}: ${event.reason}` : `timeout ${event.tool}`}`),
});
for (const warning of core.warnings) console.warn(`warning: ${warning}`);

try {
	for (;;) {
		const line = (await rl.question("you> ")).trim();
		if (line === "/exit") break;
		if (!line) continue;
		try {
			const result = await core.chat.send(line);
			console.log(`aiking> ${result.text}${result.status === "completed" ? "" : ` [${result.status}]`}`);
			const { usd, unpricedModels } = result.cost;
			console.log(`  (cost $${usd.toFixed(4)}${unpricedModels.length ? `, unpriced: ${unpricedModels.join(", ")}` : ""})`);
		} catch (error) {
			console.error(`error: ${(error as Error).message}`);
		}
	}
} finally {
	rl.close();
	await core.close();
}
