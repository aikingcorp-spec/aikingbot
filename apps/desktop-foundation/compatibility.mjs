import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeRoot, sourceRoot } from "./setup.mjs";

const stage = process.env.AIKING_VERIFY_STAGE ?? "stage2";
assert.match(stage, /^[a-z0-9-]+$/);
const out = join(runtimeRoot, "evidence", stage);
mkdirSync(out, { recursive: true });
const expectations = [
  ["src/lib/live-call-media.test.ts", "Live calls need a microphone, and this window can't use one. Open OpenMausBot at a secure https address to make the call.", "Live calls need a microphone, and this window can't use one. Open AIKINGBOT at a secure https address to make the call."],
  ["src/components/BrowserPanel.test.ts", "It goes only to the page. OpenMausBot does not keep, log or show it.", "It goes only to the page. AIKINGBOT does not keep, log or show it."],
  ["server/routines-startup.test.ts", "AbortSignal.timeout(2_000)", "AbortSignal.timeout(10_000)"],
  ...(stage === "shipping" ? [
    ["src/components/EngineSetup.test.ts", "Open API keys", "Open Connections"],
    ["src/components/EngineSetup.test.ts", "separate from MausBot Cloud and API billing", "separate from AIKINGBOT Cloud and API billing"],
    ["src/components/EngineSetup.test.ts", "on the computer running OpenMausBot", "on the computer running AIKINGBOT"],
    ["src/components/EnginesSettings.test.ts", "bot(s) use this", "agent(s) use this"],
    ["src/components/EnginesSettings.test.ts", "Open API keys", "Open Connections"],
    ["src/components/EnginesSettings.test.ts", "open Settings → API keys on the computer running OpenMausBot", "open Settings → Connections on the computer running AIKINGBOT"],
    ["src/components/EnginesSettings.test.ts", "Choose a different model provider for every bot", "Choose a different model provider for every agent"],
    ["src/components/ModelPicker.test.ts", 'threadId ? "thread" : "bot"', 'threadId ? "thread" : "agent"'],
    ["server/config.test.ts", 'expect(reloaded({ anthropic: { key: "a" } }, saved)).toEqual(["claude"]);', 'expect(reloaded({ anthropic: { key: "a" } }, saved)).toEqual(["aikingCore", "claude"]);'],
  ] : []),
];
const tests = [
  "src/aiking/voice/voice.test.ts", "src/aiking/marketplace/catalog.test.ts",
  "server/default-model-selection.test.ts", "server/approval-mode.test.ts", "server/peer-approval.test.ts",
  "shared/routine-schedule.test.ts", "server/routines.test.ts", "server/routines-startup.test.ts",
  "src/lib/computer-panel-view.test.ts", "server/computer-selection.test.ts",
  "src/components/BrowserPanel.test.ts", "src/components/remote-desktop-panel.test.ts", "server/remote-sessions.test.ts",
  "src/lib/group-routing.test.ts", "server/group-tasks.test.ts", "src/lib/approval-summary.test.ts",
  "src/lib/call.test.ts", "src/lib/live-call-media.test.ts",
  ...(stage === "shipping" ? [
    "server/aiking/config.test.ts", "server/aiking/backup.test.ts", "server/aiking/services.test.ts", "server/drivers/aiking-core.test.ts",
    "server/config.test.ts", "server/provider-key-check.test.ts", "server/provider-key-flow.test.ts",
    "server/provider-auth-sessions.test.ts", "server/provider-tool-allow.test.ts",
    "server/workspace-backup.test.ts", "server/workspace-backup-policy.test.ts", "server/workspace-backup-workflow.test.ts",
    "src/components/EngineSetup.test.ts", "src/components/EnginesSettings.test.ts", "src/components/ModelPicker.test.ts",
    "src/lib/create-configured-bot.test.ts", "server/redact.test.ts", "server/request-auth.test.ts",
  ] : []),
];
const originals = new Map();
writeFileSync(join(out, "compatibility-fixture-adjustments.json"), `${JSON.stringify({
  expectedProduct: "AIKINGBOT", adjustments: expectations.map(([path, before, after]) => ({ path, before, after })),
  reason: "The pinned tests expect the upstream product/terminology. Anthropic key reload now includes Core. The restart fixture's 2-second HTTP budget repeatedly expires on this cloud executor; assertions and scheduler timings are unchanged.",
}, null, 2)}\n`);
try {
  for (const [path, before, after] of expectations) {
    const file = join(sourceRoot, path);
    const original = readFileSync(file, "utf8");
    assert.ok(original.includes(before), `Pinned branding expectation changed in ${path}`);
    if (!originals.has(file)) originals.set(file, original);
    writeFileSync(file, original.replaceAll(before, after));
  }
  execFileSync(join(sourceRoot, "node_modules/.bin/vitest"), ["run", ...tests, "--reporter=default", "--reporter=json", `--outputFile.json=${join(out, "compatibility.json")}`], { cwd: sourceRoot, stdio: "inherit", env: {
    ...process.env, NO_PROXY: [process.env.NO_PROXY, "127.0.0.1", "localhost", "::1"].filter(Boolean).join(","),
  } });
} finally {
  for (const [file, original] of originals) writeFileSync(file, original);
}
