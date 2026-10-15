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

const files = ["package.json", "src/styles.css", "server/routes/desktop-viewer.ts", "server/config.ts", "server/contracts.ts", "server/index.ts", "server/skills.ts", "scripts/control-omb.ts", "electron/main.mjs", "electron/save-file.mjs", "electron/environments.cjs", "electron/startup-screen.mjs", "electron/cua.mjs", "electron/cua-linux-runtime.cjs", "electron/resources/speech-helper-Info.plist", "electron/companion-account-service.mjs", "electron/cloud-account.mjs", "electron/updater.mjs", "build/linux-after-install.sh", "build/linux-after-remove.sh", "build/linux-openmausbot-browser.apparmor", "scripts/after-pack.mjs", "scripts/bundle-server.mjs", "electron/save-file.node-test.mjs", "electron/server-supervisor.node-test.mjs", "scripts/linux-after-install.test.mjs"];
files.push("src/lib/notices.ts");
const pin = JSON.parse(readFileSync(join(foundationRoot, "source.lock.json"))).commit;
for (const ending of ["LF", "CRLF"]) it(`applies all pinned integration/shipping patches to ${ending} input`, () => {
  const target = mkdtempSync(join(tmpdir(), "aiking-patches-"));
  try {
    for (const dir of ["aiking", "shared"]) mkdirSync(join(target, dir));
    for (const path of files) {
      const override = join(foundationRoot, "overrides", path);
      let text = existsSync(override) ? readFileSync(override, "utf8") : execFileSync("git", ["show", `${pin}:${path}`], { cwd: join(repositoryRoot, "vendor/openmausbot"), encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
      text = text.replaceAll("\r\n", "\n"); if (ending === "CRLF") text = text.replaceAll("\n", "\r\n");
      const destination = join(target, path); mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, text);
    }
    patchIntegration(target); const pkg = JSON.parse(readFileSync(join(target, "package.json"))); patchShipping(target, pkg);
    assert.equal(pkg.version, "0.3.0-rc.1");
    const config = readFileSync(join(target, "server/config.ts"), "utf8");
    assert.match(config, /aikingCore: \{ driver: "aiking-core"/); assert.ok(config.includes('join(homedir(), ".aikingbot")'));
    const main = readFileSync(join(target, "electron/main.mjs"), "utf8");
    assert.ok(!main.includes('".opengrokbot"')); assert.ok(!main.includes("openmausbot-composio.milindsoni201.workers.dev"));
    assert.match(readFileSync(join(target, "scripts/bundle-server.mjs"), "utf8"), /aikingPackageRequire/);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
