// Copyright (c) 2026 AIKING.
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
const path = process.argv[2];
const tools = [{ name: "remember", description: "Save a verification note.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, annotations: { readOnlyHint: false, destructiveHint: false }, _meta: { "aiking/capability": { tasks: ["save a verification note"], makes: ["note"], outputs: ["note"], inputs: ["text"] } } }];
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line); if (request.id === undefined) return;
  let result;
  if (request.method === "initialize") result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "core-verification", version: "1.0.0" } };
  else if (request.method === "tools/list") result = { tools };
  else if (request.method === "tools/call") { writeFileSync(path, String(request.params.arguments.text), { mode: 0o600 }); result = { content: [{ type: "text", text: "Verification note persisted." }] }; }
  else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
});
