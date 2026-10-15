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
    // The packaged Windows utility server inherits a portable Node/npm runtime.
    // It is used only for explicit in-app provider installation, never globally installed.
    .replace('    OMB_RESOURCES_PATH: process.resourcesPath,', '    OMB_RESOURCES_PATH: process.resourcesPath,\n    ...(process.platform === "win32" && app.isPackaged ? { OMB_EXTRA_PATH: [process.env.OMB_EXTRA_PATH, path.join(process.resourcesPath, "provider-runtime", "bin")].filter(Boolean).join(path.delimiter) } : {}),')
    .replace('app.setAsDefaultProtocolClient("openmausbot")', 'app.setAsDefaultProtocolClient("aikingbot")'));
  // Product onboarding: one Connect click installs the official engine and starts
  // its existing provider-controlled authorization flow, without a terminal.
  edit("src/components/EngineSetup.tsx", text => text
    .replace('function ServerEngineInstall({ instance, mode, command }: { instance: InstanceInfo; mode: "install" | "update"; command: string | null }) {',
      'function ServerEngineInstall({ instance, mode, command, onInstalled }: { instance: InstanceInfo; mode: "install" | "update"; command: string | null; onInstalled?: () => void }) {')
    .replace('      setDone(true);\n      await refreshModels(instance.instanceId).catch(() => {});',
      '      setDone(true);\n      if (installed?.snapshot.authenticated === false) onInstalled?.();\n      await refreshModels(instance.instanceId).catch(() => {});')
    .replace('  const { state } = useStore();\n  const cloudHome = state.config?.cloudHome === true;',
      '  const { state } = useStore();\n  const [connectAfterInstall, setConnectAfterInstall] = useState(false);\n  const cloudHome = state.config?.cloudHome === true;')
    .replace('<DeviceSignIn key={instance.instanceId} instanceId={instance.instanceId} browserPkce={browserSignIn} provider={provider} />',
      '<DeviceSignIn key={instance.instanceId} instanceId={instance.instanceId} browserPkce={browserSignIn} provider={provider} autoStart={connectAfterInstall} />')
    .replace('<ClaudeSignIn key={instance.instanceId} instanceId={instance.instanceId} />',
      '<ClaudeSignIn key={instance.instanceId} instanceId={instance.instanceId} autoStart={connectAfterInstall} />')
    .replace('<ServerEngineInstall instance={instance} mode="install" command={installCommand} />',
      '<ServerEngineInstall instance={instance} mode="install" command={installCommand} onInstalled={() => setConnectAfterInstall(true)} />'));
  edit("src/components/DeviceSignIn.tsx", text => text
    .replace('export function DeviceSignIn({ instanceId, browserPkce = false, provider = "codex" }: { instanceId: string; browserPkce?: boolean; provider?: DeviceSignInProvider }) {',
      'export function DeviceSignIn({ instanceId, browserPkce = false, provider = "codex", autoStart = false }: { instanceId: string; browserPkce?: boolean; provider?: DeviceSignInProvider; autoStart?: boolean }) {')
    .replace('  const cancel = async () => {', '  useEffect(() => { if (autoStart) void start(); }, [autoStart]);\n\n  const cancel = async () => {'));
  edit("src/components/ClaudeSignIn.tsx", text => text
    .replace('export function ClaudeSignIn({ instanceId }: { instanceId: string }) {',
      'export function ClaudeSignIn({ instanceId, autoStart = false }: { instanceId: string; autoStart?: boolean }) {')
    .replace('  const finish = async () => {',
      '  useEffect(() => { if (autoStart) void start(); }, [autoStart]);\n\n  const finish = async () => {'));
  edit("electron/save-file.mjs", text => text.replace('path.join(home, ".openmausbot")', 'path.join(home, ".aikingbot")'));
  edit("electron/environments.cjs", text => text.replaceAll("OpenMausBot", "AIKINGBOT"));
  edit("electron/startup-screen.mjs", text => text.replaceAll("OpenMaus Bot", "AIKINGBOT"));
  edit("src/lib/notices.ts", text => text.replace("Date.UTC(2026, 10, 1)", "0"));
  for (const path of ["electron/cua.mjs", "electron/cua-linux-runtime.cjs", "electron/resources/speech-helper-Info.plist"]) edit(path, text => text.replaceAll("com.openmausbot.app", "com.aikingcorp.aikingbot"));
  edit("electron/companion-account-service.mjs", text => text.replace('"https://accounts.openmausbot.com"', '""'));
  edit("electron/cloud-account.mjs", text => 'import { serviceOrigin } from "./aiking-service-config.mjs";\n' + text.replace('"https://cloud.openmausbot.com"', 'serviceOrigin(process.env.AIKING_CLOUD_ORIGIN) || "https://cloud.aikingbot.invalid"'));
  edit("electron/updater.mjs", text => text.replace('if (!app.isPackaged) {', 'if (!app.isPackaged || process.env.AIKING_UPDATE_FEED === "off" || (process.platform !== "win32" && !process.env.AIKING_UPDATE_FEED)) {')
    .replace('  autoUpdater.autoDownload = false;', '  let feed;\n  try { feed = new URL(process.env.AIKING_UPDATE_FEED || "https://aikingbot.srv1866690.hstgr.cloud/updates/windows/"); } catch { setState({ status: "error", message: "Invalid AIKING update feed." }); return; }\n  if (feed.protocol !== "https:" || feed.username || feed.password) { setState({ status: "error", message: "AIKING_UPDATE_FEED requires an HTTPS release feed." }); return; }\n  autoUpdater.setFeedURL({ provider: "generic", url: feed.href });\n  autoUpdater.autoDownload = false;'));
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
  pkg.version = "0.3.0-rc.2";
  pkg.productName = "AIKINGBOT";
  pkg.homepage = "https://github.com/aikingcorp-spec/AIKINGX_Bot";
  pkg.repository = { type: "git", url: "https://github.com/aikingcorp-spec/AIKINGX_Bot.git" };
  pkg.desktopName = "com.aikingcorp.aikingbot.desktop";
  for (const [key, value] of Object.entries(pkg.scripts)) if (key.startsWith("package") && value.includes("electron-builder")) pkg.scripts[key] = value.replaceAll("electron-builder ", "electron-builder --config electron-builder.aiking.cjs ");
  writeFileSync(join(source, "aiking/shipping-patch-manifest.json"), JSON.stringify({ appId: "com.aikingcorp.aikingbot", dataRoot: ".aikingbot", protocol: "aikingbot", updaterDefault: "windows-self-hosted", changes }, null, 2));
}
