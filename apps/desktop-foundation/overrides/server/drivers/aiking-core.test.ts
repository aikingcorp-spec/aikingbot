import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { DATA_DIR } from "../config.ts";
import { AikingCoreDriver } from "./aiking-core.ts";
import type { ProviderInstance, RuntimeEvent, SendTurnInput } from "../contracts.ts";

const instance = () => AikingCoreDriver.create({ instanceId: "core-verification", enabled: true, displayName: "Offline Core", config: { mode: "offline", model: "aiking-offline" }, environment: {} });
async function simpleTurn(provider: ProviderInstance, input: SendTurnInput) {
  const events: RuntimeEvent[] = []; let resolve!: () => void;
  const completed = new Promise<void>(done => { resolve = done; });
  const off = provider.adapter.onEvent(event => { events.push(event); if (event.type === "turn.completed") resolve(); });
  try { await provider.adapter.sendTurn(input); await completed; return events; } finally { off(); }
}
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
  it("seeds reset from the selected branch and rebuilds a missing native transcript only from recovery text", async () => {
    const provider = await instance(); const root = join(DATA_DIR, "aiking-core", createHash("sha256").update("core-verification").digest("hex"));
    const id = (bot: string, thread: string) => createHash("sha256").update(JSON.stringify(["core-verification", bot, thread])).digest("hex");
    try {
      await simpleTurn(provider, { botId: "reset-agent", threadId: "reset-thread", text: "Continue.", sessionReset: true, resumeCursor: "retired-cursor", transcript: [{ role: "user", text: "Selected branch context" }, { role: "assistant", text: "Selected answer" }] });
      const mapping = JSON.parse(readFileSync(join(root, `${id("reset-agent", "reset-thread")}.mapping.json`), "utf8"));
      const history = readFileSync(join(root, `${id("reset-agent", "reset-thread")}-${mapping.generation}.jsonl`), "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(history.slice(0, 2)).toEqual([{ role: "user", content: "Selected branch context" }, { role: "assistant", content: "Selected answer" }]);
      const input = { botId: "lost-agent", threadId: "lost-thread", text: "Latest request only", resumeCursor: id("lost-agent", "lost-thread") };
      await expect(provider.adapter.sendTurn(input)).rejects.toThrow(/transcript is missing/);
      const events = await simpleTurn(provider, { ...input, recoveryText: "Recovered host context and latest request." });
      expect(events.find(event => event.type === "session.started")).toMatchObject({ rebuilt: true });
      const restored = JSON.parse(readFileSync(join(root, `${id("lost-agent", "lost-thread")}.jsonl`), "utf8").split("\n")[0]!);
      expect(restored.content).toBe("Recovered host context and latest request.");
    } finally { await provider.dispose(); }
  });
  it("accepts the next room member synchronously from completion without leaking the previous run", async () => {
    const provider = await instance(); const events: RuntimeEvent[] = []; let done!: () => void; let reject!: (error: unknown) => void;
    const completed = new Promise<void>((resolve, fail) => { done = resolve; reject = fail; });
    const off = provider.adapter.onEvent(event => {
      events.push(event);
      if (event.type !== "turn.completed") return;
      if (events.filter(event => event.type === "turn.completed").length === 2) done();
      else void provider.adapter.sendTurn({ botId: "second-room-member", threadId: "shared-room", text: "Continue the room." }).catch(reject);
    });
    try {
      await provider.adapter.sendTurn({ botId: "first-room-member", threadId: "shared-room", text: "Start the room." }); await completed;
      expect(events.filter(event => event.type === "session.started").map(event => event.sessionId)).toHaveLength(2);
      expect(new Set(events.filter(event => event.type === "session.started").map(event => event.sessionId)).size).toBe(2);
      expect(events.some(event => event.type === "runtime.error")).toBe(false);
    } finally { off(); await provider.dispose(); }
  });
  it("marks crash leftovers interrupted without replaying a pending approval", async () => {
    const root = join(DATA_DIR, "aiking-core", createHash("sha256").update("core-verification").digest("hex")); mkdirSync(root, { recursive: true });
    const state = join(root, `${"a".repeat(64)}.state.json`); writeFileSync(state, JSON.stringify({ status: "approval-pending", requestId: "stale" }));
    const provider = await instance();
    try { const recovered = JSON.parse(readFileSync(state, "utf8")); expect(recovered.status).toBe("interrupted"); expect(recovered.requestId).toBeUndefined(); expect(await provider.adapter.respondToRequest("thread", "stale", { behavior: "allow" })).toBe("unavailable"); }
    finally { await provider.dispose(); }
  });
  it("streams, executes guarded MCP after approval, and restores stable session IDs", async () => {
    const root = mkdtempSync(join(tmpdir(), "core-adapter-")); const output = join(root, "note.txt");
    const first = await instance(); let second: ProviderInstance | undefined;
    try {
      const events = await turn(first, "persistent-thread", output, "allow");
      expect(events.some(event => event.type === "content.delta")).toBe(true);
      expect(events.some(event => event.type === "request.opened")).toBe(true);
      expect(readFileSync(output, "utf8")).toContain("Core approved");
      const session = events.find(event => event.type === "session.started"); await first.dispose();
      second = await instance(); expect(second.adapter.hasSession("persistent-thread")).toBe(true); const restored = await turn(second, "persistent-thread", output, "deny");
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
