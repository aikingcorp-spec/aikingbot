import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeRoot, sourceRoot } from "./setup.mjs";
import { existsSync } from "node:fs";
import { renameText, RENAMED_MARKER } from "./rename-trace.mjs";
// Native package fixtures model installed, shareable binaries and require a normal build umask.
process.umask(0o022);

const stage = process.env.AIKING_VERIFY_STAGE ?? "stage2";
assert.match(stage, /^[a-z0-9-]+$/);
const out = join(runtimeRoot, "evidence", stage);
mkdirSync(out, { recursive: true });
const expectations = [
  ["server/data/engine.test.ts", 'toBe("20GB")', 'toBe("512MB")'],
  ["src/lib/live-call-media.test.ts", "Live calls need a microphone, and this window can't use one. Open OpenMausBot at a secure https address to make the call.", "Live calls need a microphone, and this window can't use one. Open AIKINGBOT at a secure https address to make the call."],
  ["src/components/BrowserPanel.test.ts", "It goes only to the page. OpenMausBot does not keep, log or show it.", "It goes only to the page. AIKINGBOT does not keep, log or show it."],
  ["server/routines-startup.test.ts", "AbortSignal.timeout(2_000)", "AbortSignal.timeout(10_000)"],
  ["server/routines.test.ts", 'error: "OpenMausBot restarted while this routine was running"', 'error: "AIKINGBOT restarted while this routine was running"'],
  ...(stage === "shipping" ? [
    ["server/drivers/claude.test.ts", "OpenMausBot: ", "AIKINGBOT: "],
    ["server/mcp-remote-proxy.test.ts", "[OpenMausBot trimmed this tool result", "[AIKINGBOT trimmed this tool result"],
    ["server/drivers/codex.test.ts", "Context from OpenMausBot updated since", "Context from AIKINGBOT updated since"],
    ["server/drivers/codex.test.ts", 'environment: { HTTPS_PROXY: "http://proxy.example.test:3128", NODE_EXTRA_CA_CERTS: "/etc/corp-ca.pem" }', 'environment: { HTTPS_PROXY: "http://proxy.example.test:3128", NODE_EXTRA_CA_CERTS: "/etc/corp-ca.pem", NO_PROXY: "", no_proxy: "" }'],
    ["server/drivers/codex.test.ts", "OpenMausBot tool proxy", "AIKINGBOT tool proxy"],
    ["server/drivers/codex.test.ts", "No OpenMausBot bot-specific instructions remain.", "No AIKINGBOT bot-specific instructions remain."],
    ["src/pair/PairPage.test.ts", "Connecting to this OpenMausBot", "Connecting to this AIKINGBOT"],
    ["src/pair/PairPage.test.ts", "in the OpenMausBot app", "in the AIKINGBOT app"],
    ["src/lib/i18n.test.ts", "Move bots to Research", "Move agents to Research"],
    ["src/lib/i18n.test.ts", "Move 2 bots", "Move 2 agents"],
    ["src/components/EngineSetup.test.ts", "Open API keys", "Open Connections"],
    ["src/components/EngineSetup.test.ts", "separate from MausBot Cloud and API billing", "separate from AIKINGBOT Cloud and API billing"],
    ["src/components/EngineSetup.test.ts", "on the computer running OpenMausBot", "on the computer running AIKINGBOT"],
    ["server/config.test.ts", "toBe(`OpenMaus keeps ${name}", "toBe(`AIKINGBOT keeps ${name}"],
    ["server/config.test.ts", 'it.skipIf(process.platform === "win32")("sees a change of permissions or owner on the next call", () => {\n    writeSettled({ members: ["one@example.test"] });', 'it.skipIf(process.platform === "win32")("sees a change of permissions or owner on the next call", () => {\n    writeSettled({ members: ["one@example.test"] });\n    chmodSync(path, 0o644);'],
    ["src/components/EnginesSettings.test.ts", "bot(s) use this", "agent(s) use this"],
    ["src/components/EnginesSettings.test.ts", "Open API keys", "Open Connections"],
    ["src/components/EnginesSettings.test.ts", "open Settings → API keys on the computer running OpenMausBot", "open Settings → Connections on the computer running AIKINGBOT"],
    ["src/components/EnginesSettings.test.ts", "Choose a different model provider for every bot", "Choose a different model provider for every agent"],
    ["src/components/ModelPicker.test.ts", 'threadId ? "thread" : "bot"', 'threadId ? "thread" : "agent"'],
    ["server/config.test.ts", 'expect(reloaded({ anthropic: { key: "a" } }, saved)).toEqual(["claude"]);', 'expect(reloaded({ anthropic: { key: "a" } }, saved)).toEqual(["aikingCore", "claude"]);'],
    ["server/remote-sessions.test.ts", '".openmausbot"', '".aikingbot"'],
    ["server/remote-sessions.test.ts", 'toBe("openmausbot:")', 'toBe("aikingbot:")'],
    ["server/email-signin.test.ts", '".openmausbot"', '".aikingbot"'],
    ["server/people-invite.test.ts", '".openmausbot"', '".aikingbot"'],
    ["server/email-signin.test.ts", "/not on this server's sign-in list/", "/not a member of this workspace yet/"],
    ["server/mcp-oauth.test.ts", "close this tab and return to OpenMausBot.", "close this tab and return to AIKINGBOT."],
    ["server/mcp-oauth.test.ts", "Invalid sign-in callback. Return to OpenMausBot and try again.", "Invalid sign-in callback. Return to AIKINGBOT and try again."],
    ["scripts/linux-after-install.test.mjs", 'const escaped = path.join(fs.realpathSync(os.tmpdir()), "..", path.relative("/", root));', 'const escaped = path.join("/tmp", "..", path.relative("/", root));'],
    ["scripts/linux-after-install.test.mjs", 'it("reads numeric procfs sysctls without byte-at-a-time shell reads"', 'it.skipIf(!fs.existsSync("/proc/sys/kernel/core_uses_pid"))("reads numeric procfs sysctls without byte-at-a-time shell reads"'],
  ] : []),
];
const tests = [
  "server/aiking/public-assets.test.ts", "src/aiking/session-boundary.test.ts", "src/lib/session.test.ts",
  "src/aiking/workspace-link.test.ts", "src/aiking/workspace-panel.test.ts",
  "server/aiking/security-refinement.test.ts", "server/harness/http.test.ts", "server/data/engine.test.ts",
  "src/aiking/voice/voice.test.ts", "src/aiking/marketplace/catalog.test.ts", "server/browser-engine.test.ts", "src/lib/browser-address.test.ts",
  "server/default-model-selection.test.ts", "server/approval-mode.test.ts", "server/peer-approval.test.ts",
  "shared/routine-schedule.test.ts", "server/routines.test.ts", "server/routines-startup.test.ts",
  "src/lib/computer-panel-view.test.ts", "server/computer-selection.test.ts",
  "src/components/BrowserPanel.test.ts", "src/components/remote-desktop-panel.test.ts", "server/remote-sessions.test.ts",
  "src/lib/group-routing.test.ts", "server/group-tasks.test.ts", "src/lib/approval-summary.test.ts",
  "src/lib/call.test.ts", "src/lib/live-call-media.test.ts",
  "server/plan-updates.test.ts", "server/plan-driver.test.ts", "src/components/TaskChecklist.test.ts", "src/aiking/strings.test.ts",
  ...(stage === "shipping" ? [
    "server/drivers/codex.test.ts", "server/drivers/claude.test.ts", "src/pair/PairPage.test.ts", "src/lib/i18n.test.ts", "src/lib/language-preference.test.ts",
    "server/phone-secret.test.ts", "server/mcp-remote-proxy.test.ts", "server/aiking/strict-service.test.ts", "server/aiking/config.test.ts", "server/aiking/backup.test.ts", "server/aiking/services.test.ts", "server/drivers/aiking-core.test.ts",
    "server/config.test.ts", "server/provider-key-check.test.ts", "server/provider-key-flow.test.ts",
    "server/provider-auth-sessions.test.ts", "server/provider-tool-allow.test.ts",
    "server/workspace-backup.test.ts", "server/workspace-backup-policy.test.ts", "server/workspace-backup-workflow.test.ts",
    "src/components/EngineSetup.test.ts", "src/components/EnginesSettings.test.ts", "src/components/ModelPicker.test.ts",
    "src/lib/create-configured-bot.test.ts", "server/redact.test.ts", "server/request-auth.test.ts",
    "electron/aiking-updater.test.mjs", "electron/secure-credentials.test.mjs", "electron/secure-credential-state.test.mjs",
    "scripts/linux-after-install.test.mjs",
    "src/aiking/provider-onboarding.test.ts",
    "server/drivers/antigravity.test.ts", "server/drivers/antigravity-account.test.ts",
    "server/drivers/antigravity-runtime.test.ts", "server/drivers/antigravity-lifecycle.test.ts",
    "server/drivers/codex-device-auth.test.ts", "server/drivers/claude-login-auth.test.ts",
    "server/drivers/acp/grok-device-auth.test.ts", "server/drivers/acp/gemini-auth.test.ts",
    "server/aiking/account-api.test.ts", "server/aiking/account-workspaces.test.ts", "server/aiking/realtime-voice.test.ts", "server/mcp-oauth.test.ts", "server/mcp-oauth-discovery.test.ts", "src/aiking/marketplace/catalog.test.ts", "src/aiking/voice/realtime-call.test.ts", "src/aiking/account/account-api.test.ts", "server/aiking/binary-engines.test.ts", "server/account-signin.test.ts", "server/email-signin.test.ts", "server/people-invite.test.ts",
  ] : []),
];
const selectedTests = process.env.AIKING_COMPAT_FILES?.split(",") ?? tests;
assert.ok(selectedTests.length && selectedTests.every(file => tests.includes(file)), "AIKING_COMPAT_FILES must select registered compatibility tests.");
// In a tree whose names were removed, the pinned test text was renamed with the same rules, so the expectations are too.
if (existsSync(join(sourceRoot, RENAMED_MARKER))) for (const entry of expectations) { entry[1] = renameText(entry[1]); entry[2] = renameText(entry[2]); }
const originals = new Map();
// Each run owns its fixture logs, including when the previous operator used a different Unix account.
const suiteTemp = mkdtempSync(join(tmpdir(), "aiking-shipping-tests-"));
writeFileSync(join(out, "compatibility-fixture-adjustments.json"), `${JSON.stringify({
  expectedProduct: "AIKINGBOT", tests: selectedTests, adjustments: expectations.map(([path, before, after]) => ({ path, before, after })),
  reason: "Pinned tests expect upstream wording/profile/protocol. Anthropic reload includes Core. Use a standard 022 umask for native fixtures. Skip the procfs-only fixture when this container does not expose its read-only sysctl. The permissions fixture explicitly starts at 0644 before testing a change to 0600: earlier secure config saves can already leave that mode in place. Fixture logs use a fresh per-run temporary root instead of another operator's /tmp directory. The restart HTTP budget is 10 seconds. Allow 60 seconds per test: authenticated backup rejection cases perform multiple real password KDFs and exceeded 20 seconds under cloud CPU contention. Scheduler timings and assertions are unchanged.",
}, null, 2)}\n`);
try {
  for (const [path, before, after] of expectations) {
    const file = join(sourceRoot, path);
    const original = readFileSync(file, "utf8");
    const normalized = original.replaceAll("\r\n", "\n");
    // A source patch (e.g. server management) may already have produced the adjusted wording.
    if (!normalized.includes(before) && normalized.includes(after)) continue;
    assert.ok(normalized.includes(before), `Pinned branding expectation changed in ${path}`);
    if (!originals.has(file)) originals.set(file, original);
    const adjusted = normalized.replaceAll(before, after);
    writeFileSync(file, original.includes("\r\n") ? adjusted.replaceAll("\n", "\r\n") : adjusted);
  }
  execFileSync(process.execPath, [join(sourceRoot, "node_modules/vitest/vitest.mjs"), "run", ...selectedTests, "--testTimeout=60000", "--reporter=default", "--reporter=json", `--outputFile.json=${join(out, "compatibility.json")}`], { cwd: sourceRoot, stdio: "inherit", env: {
    ...process.env, TMPDIR: suiteTemp, TMP: suiteTemp, TEMP: suiteTemp,
    ...(Object.keys(process.env).some(key => /^(https?_proxy)$/i.test(key) && process.env[key])
      ? { NO_PROXY: [process.env.NO_PROXY, "127.0.0.1", "localhost", "::1"].filter(Boolean).join(",") } : {}),
  } });
} finally {
  for (const [file, original] of originals) writeFileSync(file, original);
  rmSync(suiteTemp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
