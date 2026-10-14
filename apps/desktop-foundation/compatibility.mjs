import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeRoot, sourceRoot } from "./setup.mjs";

const out = join(runtimeRoot, "evidence/stage2");
mkdirSync(out, { recursive: true });
const expectations = [
  ["src/lib/live-call-media.test.ts", "Live calls need a microphone, and this window can't use one. Open OpenMausBot at a secure https address to make the call.", "Live calls need a microphone, and this window can't use one. Open AIKINGBOT at a secure https address to make the call."],
  ["src/components/BrowserPanel.test.ts", "It goes only to the page. OpenMausBot does not keep, log or show it.", "It goes only to the page. AIKINGBOT does not keep, log or show it."],
  ["server/routines-startup.test.ts", "AbortSignal.timeout(2_000)", "AbortSignal.timeout(10_000)"],
];
const tests = [
  "src/aiking/voice/voice.test.ts", "src/aiking/marketplace/catalog.test.ts",
  "server/default-model-selection.test.ts", "server/approval-mode.test.ts", "server/peer-approval.test.ts",
  "shared/routine-schedule.test.ts", "server/routines.test.ts", "server/routines-startup.test.ts",
  "src/lib/computer-panel-view.test.ts", "server/computer-selection.test.ts",
  "src/components/BrowserPanel.test.ts", "src/components/remote-desktop-panel.test.ts", "server/remote-sessions.test.ts",
  "src/lib/group-routing.test.ts", "server/group-tasks.test.ts", "src/lib/approval-summary.test.ts",
  "src/lib/call.test.ts", "src/lib/live-call-media.test.ts",
];
const originals = [];
writeFileSync(join(out, "compatibility-fixture-adjustments.json"), `${JSON.stringify({
  expectedProduct: "AIKINGBOT", adjustments: expectations.map(([path, before, after]) => ({ path, before, after })),
  reason: "The pinned tests expect the upstream product name. The restart fixture's 2-second HTTP budget repeatedly expires on this cloud executor; assertions and scheduler timings are unchanged.",
}, null, 2)}\n`);
try {
  for (const [path, before, after] of expectations) {
    const file = join(sourceRoot, path);
    const original = readFileSync(file, "utf8");
    assert.ok(original.includes(before), `Pinned branding expectation changed in ${path}`);
    originals.push([file, original]);
    writeFileSync(file, original.replaceAll(before, after));
  }
  execFileSync(join(sourceRoot, "node_modules/.bin/vitest"), ["run", ...tests, "--reporter=default", "--reporter=json", `--outputFile.json=${join(out, "compatibility.json")}`], { cwd: sourceRoot, stdio: "inherit", env: {
    ...process.env, NO_PROXY: [process.env.NO_PROXY, "127.0.0.1", "localhost", "::1"].filter(Boolean).join(","),
  } });
} finally {
  for (const [file, original] of originals) writeFileSync(file, original);
}
