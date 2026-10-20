// Copyright (c) 2026 AIKING. All rights reserved.
//
// Starts the local AIKINGBOT gateway: SQLite store + AIKING Core + AG-UI
// adapter + shell UI, on http://127.0.0.1:4317.
//
//   bun run app            offline demo model (no API, no cost)
//   bun run app --live     Claude API (needs credentials; spends API credits)
//
// Environment: AIKING_DATA_DIR (default .aiking/data), AIKING_PORT (default 4317).

import { join } from "node:path";
import { OfflineProducerModel } from "../../demo/offline-producer.ts";
import { AnthropicModel } from "../runtime/anthropic-model.ts";
import { SqliteStore } from "../store/sqlite-store.ts";
import { type AgentProfile, CoreBackend } from "./agent-backend.ts";
import { startGateway } from "./server.ts";

const root = join(import.meta.dir, "..", "..");
const live = process.argv.includes("--live");
const dataDir = process.env.AIKING_DATA_DIR ?? join(root, ".aiking", "data");

export const AGENTS: AgentProfile[] = [
	{
		id: "producer",
		name: "Media Producer",
		description: "Turns ideas into briefs and render jobs",
		color: "orange",
		instructions: "You are the Media Producer agent of AIKINGBOT. You turn content ideas into production briefs and render jobs.",
	},
	{
		id: "assistant",
		name: "Assistant",
		description: "General help",
		color: "teal",
	},
];

const store = new SqliteStore(join(dataDir, "aiking.db"));
const backend = await CoreBackend.create({
	store,
	agents: AGENTS,
	core: {
		model: live ? new AnthropicModel() : new OfflineProducerModel(),
		skillsDir: join(root, "demo", "skills"),
		mcpServers: {
			media: {
				command: process.execPath,
				args: [join(root, "demo", "media-tools-server.ts")],
				env: { ...(process.env as Record<string, string>), AIKING_JOBS_DIR: join(dataDir, "render-jobs") },
			},
		},
		// No approver here: side-effect tools get the per-run approver from the UI (AG-UI interrupt).
		toolPolicy: { timeoutMs: 30_000 },
	},
});
for (const warning of backend.warnings()) console.warn(`warning: ${warning}`);

const server = startGateway({
	backend,
	port: Number(process.env.AIKING_PORT ?? 4317),
	staticDir: join(root, "apps", "shell", "dist"),
});
console.log(`AIKINGBOT ${live ? "(live Claude API)" : "(offline demo model)"} on http://${server.hostname}:${server.port}`);
console.log(`data: ${dataDir}`);

const shutdown = async () => {
	server.stop(true);
	await backend.close();
	store.close();
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
