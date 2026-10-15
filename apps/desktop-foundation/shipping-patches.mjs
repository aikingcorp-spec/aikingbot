// Copyright (c) 2026 AIKING.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function patchShipping(source, pkg) {
  const changes = [];
  const edit = (path, change) => {
    const file = join(source, path); const before = readFileSync(file, "utf8").replaceAll("\r\n", "\n"); const after = change(before);
    if (after === before) throw new Error(`Shipping patch anchor changed: ${path}`);
    writeFileSync(file, after); changes.push(path);
  };
  edit("server/config.ts", text => text.replace('join(homedir(), ".openmausbot")', 'join(homedir(), ".aikingbot")').replace('join(homedir(), ".opengrokbot")', 'join(homedir(), ".aikingbot-legacy")'));
  edit("electron/main.mjs", text => text
    .replaceAll("OpenMausBot", "AIKINGBOT").replaceAll("AIKINGBOT Speech.app", "OpenMausBot Speech.app")
    .replaceAll('".openmausbot', '".aikingbot').replaceAll('`.openmausbot', '`.aikingbot')
    .replaceAll('".opengrokbot"', '".aikingbot-legacy"')
    .replace('const DEFAULT_COMPOSIO_BROKER_URL = "https://openmausbot-composio.milindsoni201.workers.dev";', 'const DEFAULT_COMPOSIO_BROKER_URL = "";')
    .replace('if (app.isPackaged && !desktopRemoteAccess) {\n    cloudAccountRestoring = true;', 'if (process.env.AIKING_CLOUD_ORIGIN && app.isPackaged && !desktopRemoteAccess) {\n    cloudAccountRestoring = true;')
    .replace('() => ensureCloudAccount()[method]()', '() => { if (!process.env.AIKING_CLOUD_ORIGIN) { if (method === "state") return { status: "signed-out", message: "Cloud server is not configured." }; if (method === "offer") return null; if (!["cancel", "signOut"].includes(method)) throw new Error("Configure the AIKING Cloud server before signing in."); } return ensureCloudAccount()[method](); }')
    .replace('return app.isPackaged && !desktopRemoteAccess && brandedBuild === false;', 'return Boolean(process.env.AIKING_CLOUD_ORIGIN) && app.isPackaged && !desktopRemoteAccess && brandedBuild === false;')
    .replace('app.setDesktopName("com.openmausbot.app.desktop")', 'app.setDesktopName("com.aikingcorp.aikingbot.desktop")')
    .replace('app.setAsDefaultProtocolClient("openmausbot")', 'app.setAsDefaultProtocolClient("aikingbot")'));
  edit("electron/save-file.mjs", text => text.replace('path.join(home, ".openmausbot")', 'path.join(home, ".aikingbot")'));
  edit("electron/environments.cjs", text => text.replaceAll("OpenMausBot", "AIKINGBOT"));
  edit("electron/startup-screen.mjs", text => text.replaceAll("OpenMaus Bot", "AIKINGBOT"));
  edit("src/lib/notices.ts", text => text.replace("Date.UTC(2026, 10, 1)", "0"));
  for (const path of ["electron/cua.mjs", "electron/cua-linux-runtime.cjs", "electron/resources/speech-helper-Info.plist"]) edit(path, text => text.replaceAll("com.openmausbot.app", "com.aikingcorp.aikingbot"));
  edit("electron/companion-account-service.mjs", text => text.replace('"https://accounts.openmausbot.com"', '""'));
  edit("electron/cloud-account.mjs", text => 'import { serviceOrigin } from "./aiking-service-config.mjs";\n' + text.replace('"https://cloud.openmausbot.com"', 'serviceOrigin(process.env.AIKING_CLOUD_ORIGIN) || "https://cloud.aikingbot.invalid"'));
  edit("electron/updater.mjs", text => text.replace('if (!app.isPackaged) {', 'if (!app.isPackaged || !process.env.AIKING_UPDATE_FEED) {')
    .replace('  autoUpdater.autoDownload = false;', '  let feed;\n  try { feed = new URL(process.env.AIKING_UPDATE_FEED); } catch { setState({ status: "error", message: "Invalid AIKING update feed." }); return; }\n  if (feed.protocol !== "https:" || feed.username || feed.password) { setState({ status: "error", message: "AIKING_UPDATE_FEED requires an HTTPS release feed." }); return; }\n  autoUpdater.setFeedURL({ provider: "generic", url: feed.href });\n  autoUpdater.autoDownload = false;'));
  for (const path of ["build/linux-after-install.sh", "build/linux-after-remove.sh", "build/linux-openmausbot-browser.apparmor"]) {
    edit(path, text => text.replaceAll("/opt/OpenMausBot", "/opt/AIKINGBOT").replaceAll("openmausbot-browser", "aikingbot-browser")
      .replaceAll("--remove openmausbot", "--remove aikingbot").replaceAll("/usr/bin/openmausbot", "/usr/bin/aikingbot").replaceAll("/AIKINGBOT/openmausbot", "/AIKINGBOT/aikingbot"));
  }
  edit("scripts/after-pack.mjs", text => text.replace('"OpenMausBot.app"', '"AIKINGBOT.app"'));
  edit("scripts/bundle-server.mjs", text => text.replace('  format: "esm",', '  format: "esm",\n  banner: { js: \'import { createRequire as aikingPackageRequire } from "node:module"; const require = aikingPackageRequire(import.meta.url);\' },'));
  const visit = (directory) => {
    for (const entry of readdirSync(join(source, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "vendor") visit(path); continue; }
      if (!/\.(?:ts|tsx|mjs|cjs)$/.test(entry.name)) continue;
      const file = join(source, path); const before = readFileSync(file, "utf8");
      const after = before.replaceAll("openmausbot://", "aikingbot://");
      if (after !== before) { writeFileSync(file, after); changes.push(path); }
    }
  };
  for (const directory of ["electron", "src", "shared", "server"]) visit(directory);
  edit("electron/save-file.node-test.mjs", text => text.replaceAll('".openmausbot"', '".aikingbot"'));
  edit("electron/server-supervisor.node-test.mjs", text => text.replaceAll(".openmausbot", ".aikingbot"));
  edit("scripts/linux-after-install.test.mjs", text => text.replaceAll("/opt/OpenMausBot", "/opt/AIKINGBOT").replaceAll("openmausbot-browser", "aikingbot-browser").replace('"linux-aikingbot-browser.apparmor"', '"linux-openmausbot-browser.apparmor"'));
  pkg.version = "0.3.0-rc.1";
  pkg.productName = "AIKINGBOT";
  pkg.homepage = "https://github.com/aikingcorp-spec/AIKINGX_Bot";
  pkg.repository = { type: "git", url: "https://github.com/aikingcorp-spec/AIKINGX_Bot.git" };
  pkg.desktopName = "com.aikingcorp.aikingbot.desktop";
  for (const [key, value] of Object.entries(pkg.scripts)) if (key.startsWith("package") && value.includes("electron-builder")) pkg.scripts[key] = value.replaceAll("electron-builder ", "electron-builder --config electron-builder.aiking.cjs ");
  writeFileSync(join(source, "aiking/shipping-patch-manifest.json"), JSON.stringify({ appId: "com.aikingcorp.aikingbot", dataRoot: ".aikingbot", protocol: "aikingbot", updaterDefault: "disabled", changes }, null, 2));
}
