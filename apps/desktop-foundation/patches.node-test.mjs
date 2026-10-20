// Copyright (c) 2026 AIKING.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "node:test";
import { foundationRoot, repositoryRoot } from "./setup.mjs";
import { patchIntegration } from "./integration-patches.mjs";
import { patchShipping } from "./shipping-patches.mjs";
import { patchProviderOnboarding } from "./provider-onboarding-patches.mjs";
import { patchProduct, PRODUCT_PATCHED_FILES } from "./product-patches.mjs";
import { patchAccountWorkspaces, ACCOUNT_WORKSPACE_PATCHED_FILES } from "./account-workspace-patches.mjs";
import { patchRealtimeVoice } from "./realtime-voice-patches.mjs";
import { patchConnectors, CONNECTOR_PATCHED_FILES } from "./connector-patches.mjs";
import { patchAccounts, ACCOUNT_PATCHED_FILES } from "./account-patches.mjs";
import { patchBrowser, BROWSER_PATCHED_FILES } from "./browser-patches.mjs";
import { patchTasksChecklist, TASKS_CHECKLIST_PATCHED_FILES } from "./tasks-checklist-patches.mjs";
import { patchVietnamese, VIETNAMESE_PATCHED_FILES } from "./vietnamese-patches.mjs";

import { patchAvailability, AVAILABILITY_PATCHED_FILES } from "./availability-patches.mjs";

import { patchSecurityRefinement, SECURITY_REFINEMENT_PATCHED_FILES } from "./security-refinement-patches.mjs";
import { patchWorkspaceRefinement, WORKSPACE_REFINEMENT_PATCHED_FILES } from "./workspace-refinement-patches.mjs";
import { patchServerManagement, SERVER_MANAGEMENT_PATCHED_FILES } from "./server-management-patches.mjs";
import { patchPlatform, PLATFORM_PATCHED_FILES } from "./platform-patches.mjs";
import { patchDesktopJourney, DESKTOP_JOURNEY_PATCHED_FILES } from "./desktop-journey-patches.mjs";
const files = ["src/components/EngineSetup.tsx", "src/components/DeviceSignIn.tsx", "src/components/ClaudeSignIn.tsx", "package.json", "src/styles.css", "server/routes/desktop-viewer.ts", "server/config.ts", "server/contracts.ts", "server/index.ts", "server/skills.ts", "scripts/control-omb.ts", "electron/main.mjs", "electron/save-file.mjs", "electron/environments.cjs", "electron/startup-screen.mjs", "electron/cua.mjs", "electron/cua-linux-runtime.cjs", "electron/resources/speech-helper-Info.plist", "electron/companion-account-service.mjs", "electron/cloud-account.mjs", "electron/updater.mjs", "build/linux-after-install.sh", "build/linux-after-remove.sh", "build/linux-openmausbot-browser.apparmor", "scripts/after-pack.mjs", "scripts/bundle-server.mjs", "electron/save-file.node-test.mjs", "electron/server-supervisor.node-test.mjs", "scripts/linux-after-install.test.mjs"];
files.push("src/lib/notices.ts", "server/routes/instances.ts", ...PRODUCT_PATCHED_FILES.filter((path) => !files.includes(path)));
files.push(...ACCOUNT_WORKSPACE_PATCHED_FILES.filter((path) => !files.includes(path)));
files.push(...CONNECTOR_PATCHED_FILES.filter((path) => !files.includes(path)));
files.push(...ACCOUNT_PATCHED_FILES.filter((path) => !files.includes(path)));
files.push(...BROWSER_PATCHED_FILES.filter((path) => !files.includes(path)));
files.push(...TASKS_CHECKLIST_PATCHED_FILES.filter((path) => !files.includes(path)));
files.push(...VIETNAMESE_PATCHED_FILES.filter((path) => !files.includes(path)));
files.push(...AVAILABILITY_PATCHED_FILES.filter((path) => !files.includes(path)));
files.push(...SECURITY_REFINEMENT_PATCHED_FILES.filter((path) => !files.includes(path)));
files.push(...WORKSPACE_REFINEMENT_PATCHED_FILES.filter((path) => !files.includes(path)));
files.push(...SERVER_MANAGEMENT_PATCHED_FILES.filter(path=>!files.includes(path)));
files.push(...PLATFORM_PATCHED_FILES.filter(path=>!files.includes(path)));
files.push(...DESKTOP_JOURNEY_PATCHED_FILES.filter(path=>!files.includes(path)));
const pin = JSON.parse(readFileSync(join(foundationRoot, "source.lock.json"))).commit;
for (const ending of ["LF", "CRLF"]) it(`applies all pinned integration/shipping patches to ${ending} input`, async () => {
  const target = mkdtempSync(join(tmpdir(), "aiking-patches-"));
  try {
    for (const dir of ["aiking", "shared"]) mkdirSync(join(target, dir));
    for (const path of files) {
      const override = join(foundationRoot, "overrides", path);
      let text = existsSync(override) ? readFileSync(override, "utf8") : execFileSync("git", ["show", `${pin}:${path}`], { cwd: join(repositoryRoot, "vendor/openmausbot"), encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
      text = text.replaceAll("\r\n", "\n"); if (ending === "CRLF") text = text.replaceAll("\n", "\r\n");
      const destination = join(target, path); mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, text);
    }
    patchIntegration(target); const pkg = JSON.parse(readFileSync(join(target, "package.json"))); patchShipping(target, pkg); patchProduct(target); patchProviderOnboarding(target); patchAccountWorkspaces(target); patchRealtimeVoice(target); patchConnectors(target); patchAccounts(target); patchBrowser(target); patchTasksChecklist(target);
    // Setup rebrands before the Vietnamese patch, which edits the sign-in page's already rebranded text.
    { const { rebrand } = await import("./branding-patches.mjs"); const page = join(target, "src/pair/PairPage.tsx"); writeFileSync(page, rebrand(readFileSync(page, "utf8"))); }
    patchVietnamese(target);
    patchAvailability(target);
    patchSecurityRefinement(target);
    patchWorkspaceRefinement(target);
    patchServerManagement(target);
    patchPlatform(target);
    patchDesktopJourney(target);
    assert.equal(pkg.version, "0.3.0-rc.3");
    // Settings follow the AIKINGBOT journey: the AIKING account replaces the company/admin sign-in, and the
    // command-line pairing of another machine is not offered on the simple Computers page.
    const settings = readFileSync(join(target, "src/components/SettingsModal.tsx"), "utf8");
    assert.ok(settings.includes("AikingAccountSettings") && !settings.includes("<OrganizationSettings"));
    assert.match(settings, /id: "computers", labelKey: "settings\.group\.computers", icon: Monitor, sections: \["logins"\]/);
    assert.match(settings, /id: "account", labelKey: "settings\.group\.account", icon: CircleUser, sections: \["cloudAccount", "people", "activity"\]/);

    const config = readFileSync(join(target, "server/config.ts"), "utf8");
    assert.match(config, /aikingCore: \{ driver: "aiking-core"/); assert.ok(config.includes('join(homedir(), ".aikingbot")'));
    const main = readFileSync(join(target, "electron/main.mjs"), "utf8");
    assert.match(main, /provider-runtime.*bin/);
    assert.ok(!main.includes('".opengrokbot"')); assert.ok(!main.includes("openmausbot-composio.milindsoni201.workers.dev"));
    assert.match(readFileSync(join(target, "scripts/bundle-server.mjs"), "utf8"), /aikingPackageRequire/);
    const server = readFileSync(join(target, "server/index.ts"), "utf8");
    const accountAt = server.indexOf("accountRoutes.handle("); assert.ok(accountAt > 0 && accountAt < server.indexOf("const gate = resolveRequestAuth(req, {"));
    assert.match(readFileSync(join(target, "server/account-signin.ts"), "utf8"), /openIdentity \? \{ ok: true/);
    const oauth = readFileSync(join(target, "server/mcp-oauth.ts"), "utf8");
    assert.match(oauth, /registered && starting\.browser\.remote/); assert.match(oauth, /access_type", "offline"/);
    const realtimeAt = server.indexOf("realtimeVoice.handle("); assert.ok(realtimeAt > 0 && realtimeAt < server.indexOf("aikingServices.handle("));
  } finally { rmSync(target, { recursive: true, force: true }); }
});
it("keeps wire identifiers while rebranding prose", async () => {
  const { rebrand } = await import("./branding-patches.mjs");
  assert.equal(rebrand('const H = "X-OpenMausBot-Desktop-Owner";'), 'const H = "X-OpenMausBot-Desktop-Owner";');
  assert.equal(rebrand('"Welcome to OpenMausBot"'), '"Welcome to AIKINGBOT"');
  assert.equal(rebrand('export const PHONE_SECRET_INFO = "OpenMausBot phone credential v1";'), 'export const PHONE_SECRET_INFO = "OpenMausBot phone credential v1";');
  assert.equal(rebrand('"user-agent": "OpenMausBot-skills"'), '"user-agent": "AIKINGBOT-skills"');
});
