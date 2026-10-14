import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { AikingCoreDriver } from "./aiking-core.ts";
import type { ProviderInstance, RuntimeEvent } from "../contracts.ts";

const instance = () => AikingCoreDriver.create({ instanceId: "core-verification", enabled: true, displayName: "Offline Core", config: { mode: "offline", model: "aiking-offline" }, environment: {} });
async function turn(provider: ProviderInstance, thread: string, output: string, decision: "allow" | "deny", scope?: { deny: string[] }) {
  const events: RuntimeEvent[] = [];
  let resolve!: () => void;
  const completed = new Promise<void>(done => { resolve = done; });
  const off = provider.adapter.onEvent(event => {
    events.push(event);
    if (event.type === "request.opened") void provider.adapter.respondToRequest(thread, event.requestId!, { behavior: decision });
    if (event.type === "turn.completed") resolve();
  });
  try {
    await provider.adapter.sendTurn({ botId: "verification-agent", threadId: thread, text: "Save a verification note.", approvalMode: "ask", toolScope: scope, integrations: { custom: { verify: { command: process.execPath, args: [fileURLToPath(new URL("../../../../apps/desktop-foundation/fixtures/core-tools.mjs", import.meta.url)), output], env: {} } } } });
    await completed; return events;
  } finally { off(); }
}

describe("AIKING Core provider integration", () => {
  it("streams, executes guarded MCP after approval, and restores stable session IDs", async () => {
    const root = mkdtempSync(join(tmpdir(), "core-adapter-")); const output = join(root, "note.txt");
    const first = await instance(); let second: ProviderInstance | undefined;
    try {
      const events = await turn(first, "persistent-thread", output, "allow");
      expect(events.some(event => event.type === "content.delta")).toBe(true);
      expect(events.some(event => event.type === "request.opened")).toBe(true);
      expect(readFileSync(output, "utf8")).toContain("Core approved");
      const session = events.find(event => event.type === "session.started"); await first.dispose();
      second = await instance(); const restored = await turn(second, "persistent-thread", output, "deny");
      expect(restored.find(event => event.type === "session.started")).toMatchObject({ sessionId: session?.type === "session.started" ? session.sessionId : undefined });
      expect(restored.some(event => event.type === "request.resolved" && event.behavior === "deny")).toBe(true);
    } finally { await first.dispose(); await second?.dispose(); rmSync(root, { recursive: true, force: true }); }
  });
  it("denies side effects and honors tool scope without executing the tool", async () => {
    const root = mkdtempSync(join(tmpdir(), "core-denial-")); const output = join(root, "note.txt"); const provider = await instance();
    try {
      await turn(provider, "denied-thread", output, "deny"); expect(existsSync(output)).toBe(false);
      const scoped = await turn(provider, "scoped-thread", output, "allow", { deny: ["mcp:verify:remember"] });
      expect(scoped.some(event => event.type === "request.opened")).toBe(false); expect(existsSync(output)).toBe(false);
      expect(await provider.adapter.respondToRequest("another-thread", "missing", { behavior: "allow" })).toBe("unavailable");
    } finally { await provider.dispose(); rmSync(root, { recursive: true, force: true }); }
  });
  it("cancels waiting approvals and never persists or executes a cancelled turn", async () => {
    const provider = await instance(); const root = mkdtempSync(join(tmpdir(), "core-cancel-")); const output = join(root, "note.txt");
    let opened!: () => void; const asked = new Promise<void>(resolve => { opened = resolve; });
    const events: RuntimeEvent[] = []; const off = provider.adapter.onEvent(event => { events.push(event); if (event.type === "request.opened") opened(); });
    try {
      await provider.adapter.sendTurn({ botId: "cancel-agent", threadId: "cancel-thread", text: "Save a verification note.", integrations: { custom: { verify: { command: process.execPath, args: [fileURLToPath(new URL("../../../../apps/desktop-foundation/fixtures/core-tools.mjs", import.meta.url)), output], env: {} } } } });
      await asked; await provider.adapter.interruptTurn("cancel-thread");
      expect(existsSync(output)).toBe(false); expect(events.filter(event => event.type === "turn.completed")).toHaveLength(1);
    } finally { off(); await provider.dispose(); rmSync(root, { recursive: true, force: true }); }
  });
});
