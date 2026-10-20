// Copyright (c) 2026 AIKING.
// Makes the desktop Settings and first-run screens follow the AIKINGBOT journey instead of the original app's
// self-hosting / company-admin flows. Source of truth lives here and in overrides/, never in vendor/.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export const DESKTOP_JOURNEY_PATCHED_FILES = ["src/components/SettingsModal.tsx", "src/components/EnginesSettings.tsx", "src/components/Composer.tsx", "src/components/onboarding/beats/HelloBeat.tsx", "src/components/onboarding/WelcomeFlow.tsx", "server/index.ts", "server/enterprise.ts", "server/cli.ts", "src/components/ConnectedWorkspacesSettings.tsx", "src/components/RemoteComputerSection.tsx", "src/components/AboutDialog.tsx", "src/components/onboarding/reel/scenes/index.ts", "src/components/bot-settings/AccessSection.tsx", "src/components/TeamLibraryPanel.tsx", "src/components/onboarding/WelcomeGate.tsx", "electron/main.mjs", "electron/shared-computer-access.node-test.mjs", "src/pair/PairPage.tsx"];
export function patchDesktopJourney(source) {
  const edit = (path, pairs) => {
    const file = join(source, path); let text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    for (const [before, after] of pairs) {
      if (text.split(before).length !== 2) throw new Error("Desktop journey anchor changed: " + path + ": " + before.slice(0, 70) + " count=" + (text.split(before).length - 1));
      text = text.replace(before, after);
    }
    writeFileSync(file, text);
  };
  edit("src/components/SettingsModal.tsx", [
    // Account page: the AIKING account replaces the company/admin sign-in (which has no AIKING service behind it).
    ['import { OrganizationSettings } from "./OrganizationSettings";', 'import { AikingAccountSettings } from "@/aiking/AikingAccountSettings";'],
    ['import { CloudAccountSettings } from "./CloudAccountSettings";\n', ''],
    ['{ id: "account", labelKey: "settings.group.account", icon: CircleUser, sections: ["cloudAccount", "organization", "people", "activity"] },',
      '{ id: "account", labelKey: "settings.group.account", icon: CircleUser, sections: ["cloudAccount", "people", "activity"] },'],
    ['    .filter((entry) => entry.id !== "organization" || Boolean(window.ogb?.organization))\n', '    .filter((entry) => entry.id !== "organization")\n'],
    ['    .filter((entry) => entry.id !== "cloudAccount" || Boolean(window.ogb?.cloudAccount || (window.ogb?.cloudPlan && state.config?.cloudHome === true)))\n', ''],
    ['      case "organization":\n        return window.ogb?.organization && !remoteActive ? <OrganizationSettings /> : null;\n', '      case "organization":\n        return null;\n'],
    ['      case "cloudAccount":\n        return (window.ogb?.cloudAccount || (window.ogb?.cloudPlan && state.config?.cloudHome === true)) && !remoteActive\n          ? <CloudAccountSettings linkRequest={state.appSettingsCloudLink} cloudHome={state.config?.cloudHome === true}\n            onAddCloud={() => dispatch({ type: "openCloudAdd", source: "app_settings" })} />\n          : null;\n',
      '      case "cloudAccount":\n        return remoteActive ? null : <AikingAccountSettings />;\n'],
    // Computers page: pairing another machine by command line, cloud computers, SSH VPS and local VMs are self-hosting tools;
    // they stay under Advanced. A first-time person only needs the agents' saved logins here.
    ['{ id: "computers", labelKey: "settings.group.computers", icon: Monitor, sections: ["companion", "desktopWorkspaces", "computer", "logins"] },',
      '{ id: "computers", labelKey: "settings.group.computers", icon: Monitor, sections: ["logins"] },'],
  ]);
  // AI page: the product supports four providers. Others that already work stay visible; the rest wait behind a button.
  edit("src/components/EnginesSettings.tsx", [
    ['import { t } from "@/lib/i18n";\n', 'import { t } from "@/lib/i18n";\nimport { useAdvancedMode } from "@/lib/interface-mode";\nimport { at } from "@/aiking/strings";\n'],
    ['  const rows = state.instances.filter((i) => i.readOnly || i.cli !== undefined || i.cliDefault !== undefined || i.snapshot.state === "unavailable" || isApiKeyEngine(i));\n',
      '  const everything = state.instances.filter((i) => i.readOnly || i.cli !== undefined || i.cliDefault !== undefined || i.snapshot.state === "unavailable" || isApiKeyEngine(i));\n' +
      '  const advanced = useAdvancedMode();\n  const [showAll, setShowAll] = useState(false);\n' +
      '  const primary = everything.filter((i) => ["codex", "codexAgent", "claudeAgent", "grokAgent", "antigravityAgent"].includes(String(i.driverKind)) || engineReady(i));\n' +
      '  // Only a long list is trimmed; a short one is shown whole.\n  const trim = !advanced && !showAll && everything.length > 6;\n  const rows = trim ? primary : everything;\n  const hidden = trim || showAll ? everything.length - primary.length : 0;\n'],
    ['      <EngineSections instances={rows} renderEngine={(instance) => <EngineRow instance={instance} />} />\n',
      '      <EngineSections instances={rows} renderEngine={(instance) => <EngineRow instance={instance} />} />\n' +
      '      {!advanced && everything.length > 6 && hidden > 0 && <button type="button" onClick={() => setShowAll((value) => !value)} className="ui-button w-fit self-start">{showAll ? at("engines.showFewer") : at("engines.showAll", { count: hidden })}</button>}\n'],
  ]);
  // First message with no connected model used to do nothing visible (the draft came back into the box). Say why and
  // open the model setup instead.
  edit("src/components/Composer.tsx", [
    ['import { activeLocale, t } from "@/lib/i18n";\n', 'import { activeLocale, t } from "@/lib/i18n";\nimport { at } from "@/aiking/strings";\n'],
    ['    const composed = composeMessage(serializeThreadRefs(effectiveText, threads, currentBotId), attachments);\n    if (!composed) return;\n',
      '    if (!group && bot) {\n' +
      '      const engine = state.instances.find((instance) => instance.instanceId === bot.modelSelection?.instanceId);\n' +
      '      if (engine && (engine.snapshot.state === "unavailable" || (engine.snapshot.state === "available" && engine.snapshot.authenticated === false))) {\n' +
      '        dispatch({ type: "error", message: at("composer.needsModel") });\n' +
      '        dispatch({ type: "toggleAppSettings", open: true, section: "engines" });\n' +
      '        return;\n      }\n    }\n' +
      '    const composed = composeMessage(serializeThreadRefs(effectiveText, threads, currentBotId), attachments);\n    if (!composed) return;\n'],
  ]);
  // First screen on the desktop: signing in with the AIKING account (email one-time code) is the only way forward.
  // No local profile form, no "maybe later", no skip, no Escape. (A browser has no desktop bridge and keeps its own flow.)
  edit("src/components/onboarding/beats/HelloBeat.tsx", [
    ['import { t } from "@/lib/i18n";\n', 'import { t } from "@/lib/i18n";\nimport { at } from "@/aiking/strings";\n'],
    ['  const [failed, setFailed] = useState(false);\n', '  const [failed, setFailed] = useState(false);\n  const [signingIn, setSigningIn] = useState(false);\n  const [signInError, setSignInError] = useState("");\n' +
      '  const startSignIn = async () => {\n    setSigningIn(true); setSignInError("");\n    try { await window.ogb?.workspaces?.connectAiking?.(); } catch { setSignInError(at("account.signInFailed")); }\n    setSigningIn(false);\n  };\n'],
    ['  return (\n    <div className="stagger flex flex-col items-center">\n      <p className="animate-rise mt-1.5 text-center text-[14px] leading-relaxed text-ink-secondary" style={staggerIndex(0)}>\n        {t("onboarding.intro")}\n',
      '  if (window.ogb?.workspaces?.connectAiking) {\n    return (\n      <div className="stagger flex flex-col items-center">\n' +
      '        <p className="animate-rise mt-1.5 text-center text-[14px] leading-relaxed text-ink-secondary" style={staggerIndex(0)}>{at("welcome.signInIntro")}</p>\n' +
      '        {signInError && <p role="alert" className="mt-3 text-[13px] text-danger">{signInError}</p>}\n' +
      '        <PrimaryButton onClick={() => void startSignIn()} disabled={signingIn} className="animate-rise mt-5" style={staggerIndex(1)}>{at("welcome.signIn")}</PrimaryButton>\n      </div>\n    );\n  }\n\n' +
      '  return (\n    <div className="stagger flex flex-col items-center">\n      <p className="animate-rise mt-1.5 text-center text-[14px] leading-relaxed text-ink-secondary" style={staggerIndex(0)}>\n        {t("onboarding.intro")}\n'],
    ['      {window.ogb?.workspaces?.connectAiking && (\n        <button type="button" onClick={() => void window.ogb?.workspaces?.connectAiking?.()} className="animate-rise mt-3 text-[13px] text-ink-secondary underline-offset-2 hover:text-ink hover:underline" style={staggerIndex(4)}>\n          Have an AIKINGBOT account? Sign in to your workspace\n        </button>\n      )}\n', ''],
  ]);
  edit("src/components/onboarding/WelcomeFlow.tsx", [
    ['    if (event.key === "Escape") {\n      event.preventDefault();\n      void finish("skipped");\n      return;\n    }\n',
      '    if (event.key === "Escape") {\n      event.preventDefault();\n      if (!(beat === "hello" && window.ogb?.workspaces?.connectAiking)) void finish("skipped");\n      return;\n    }\n'],
    ['        <QuietButton onClick={() => void finish("skipped")} className="absolute right-4 top-4">\n          {t("onboarding.skipTour")}\n        </QuietButton>\n',
      '        {!(hello && window.ogb?.workspaces?.connectAiking) && (\n          <QuietButton onClick={() => void finish("skipped")} className="absolute right-4 top-4">\n            {t("onboarding.skipTour")}\n          </QuietButton>\n        )}\n'],
  ]);
  // Brand cleanup: nothing a person can read may say OpenMausBot or tell them to run an `openmausbot` command.
  edit("server/index.ts", [
    ["console.log(`openmausbot webhook receiver on http://", "console.log(`AIKINGBOT webhook receiver on http://"],
    ["console.error(`openmausbot webhook receiver unavailable", "console.error(`AIKINGBOT webhook receiver unavailable"],
    ["console.log(`openmausbot server on http://127.0.0.1:${PORT}`);", "console.log(`AIKINGBOT server on http://127.0.0.1:${PORT}`);"],
  ]);
  edit("server/enterprise.ts", [["return `openmausbot open-source edition${status.notice", "return `AIKINGBOT standard edition${status.notice"]]);
  edit("server/cli.ts", [["; start one with \\`openmausbot serve\\` or set OMB_PORT`", "; start AIKINGBOT first or set OMB_PORT`"]]);
  edit("src/components/ConnectedWorkspacesSettings.tsx", [
    ['        <details className="text-[12px] text-ink-secondary"><summary className="cursor-pointer">Need a pairing code?</summary>\n          <p className="mt-2">Run this on the server and copy the link it prints:</p>\n          <code className="mt-1 block select-all break-words rounded-md bg-inset px-2 py-2 text-ink">npx openmausbot pair --label "My desktop"</code>\n        </details>\n', ''],
  ]);
  edit("src/components/RemoteComputerSection.tsx", [
    ['              <code className="select-all rounded-lg bg-inset px-3 py-2 text-[12px] text-ink">\n                npx openmausbot pair --client\n              </code>\n', ''],
  ]);
  edit("src/components/AboutDialog.tsx", [
    ['          AIKINGBOT desktop foundation. Based on OpenMausBot OSS by Milind Soni and contributors, under Apache 2.0.\n', '          © AIKING. Open-source license texts are included with the app.\n'],
    ['          <AboutLink href={APP_REPOSITORY} label="GitHub" />\n', ''],
    ['  APP_NAME,\n  APP_REPOSITORY,\n  DOCS_URL,', '  APP_NAME,\n  DOCS_URL,'],
  ]);
  edit("src/components/bot-settings/AccessSection.tsx", [
    ['"Not available on this Windows machine yet: install the browser engine with `openmausbot browser install`."', '"Not available on this Windows machine yet."'],
  ]);
  // The "Community repo" button opens the original app's template repository, which is not AIKINGBOT content.
  edit("src/components/TeamLibraryPanel.tsx", [
    ['            {!pending && (\n              <button\n                onClick={() => void openExternal(catalog?.repositoryUrl ?? COMMUNITY_TEAMS_REPOSITORY)}', '            {false && !pending && (\n              <button\n                onClick={() => void openExternal(catalog?.repositoryUrl ?? COMMUNITY_TEAMS_REPOSITORY)}'],
  ]);
  edit("src/components/onboarding/reel/scenes/index.ts", [
    ['export const REEL = ["agents", "hands", "setup", "channels", "automations", "terminal"] as const;', 'export const REEL = ["agents", "hands", "setup", "channels", "automations"] as const;'],
  ]);
  // The welcome card used to pop up a few seconds after the main window (the settings had not loaded yet). Hold a plain
  // backdrop for that moment so the first thing a person sees is the welcome card; never longer than 8 seconds.
  edit("src/components/onboarding/WelcomeGate.tsx", [
    ['  const remoteClient = window.ogb?.remoteClient?.active === true;\n  if (!viewer) return null;\n',
      '  const remoteClient = window.ogb?.remoteClient?.active === true;\n  const [patient, setPatient] = useState(true);\n  useEffect(() => { const timer = setTimeout(() => setPatient(false), 8000); return () => clearTimeout(timer); }, []);\n  if (!viewer) return null;\n'],
    ['  if (!state.welcomeOpen && !due) return null;\n', '  if (!state.config && patient && !dismissed && localDesktopPage()) return <div aria-hidden="true" className="fixed inset-0 z-50 bg-app" />;\n  if (!state.welcomeOpen && !due) return null;\n'],
  ]);
  // A failed Server action used to leave no trace (the log had nothing, so the cause could not be found). Record it with
  // its stack; the renderer still gets the same error.
  edit("electron/main.mjs", [
    ['ipcMain.handle("workspaces:server-action", workspaceOnly(actOnServer));',
      'ipcMain.handle("workspaces:server-action", workspaceOnly(async (event, ...args) => {\n  const started = Date.now();\n  slog(`server action ${String(args[0])} started`);\n  const slow = setTimeout(() => slog(`server action ${String(args[0])} still running after 20s`), 20_000);\n  try { const result = await actOnServer(event, ...args); slog(`server action ${String(args[0])} finished in ${Date.now() - started}ms: ${JSON.stringify(result)}`); return result; }\n  catch (error) { slog(`server action ${String(args[0])} failed: ${error?.stack ?? error}`); throw error; }\n  finally { clearTimeout(slow); }\n}));'],
  ]);
  // The original test names the protected folder "openmausbot"; the app's folder is now AIKINGBOT, so its other-case spellings
  // are "aikingbot" and "AikingBot". (This test only runs where the file system ignores case: Windows and macOS.)
  edit("electron/shared-computer-access.node-test.mjs", [
    ['  await assert.rejects(run({ action: "read_file", path: "openmausbot/credentials.bin" }), /Desktop credentials/);\n  await assert.rejects(run({ action: "read_file", path: "OPENMAUSBOT/credentials.bin" }), /Desktop credentials/);\n  await assert.rejects(run({ action: "list_files", path: "openmausbot" }), /Desktop credentials/);\n  await assert.rejects(run({ action: "write_file", path: "openmausbot/computer-sharing.json", content: "{}" }), /sharing settings/);\n',
      '  await assert.rejects(run({ action: "read_file", path: "aikingbot/credentials.bin" }), /Desktop credentials/);\n  await assert.rejects(run({ action: "read_file", path: "AikingBot/credentials.bin" }), /Desktop credentials/);\n  await assert.rejects(run({ action: "list_files", path: "aikingbot" }), /Desktop credentials/);\n  await assert.rejects(run({ action: "write_file", path: "aikingbot/computer-sharing.json", content: "{}" }), /sharing settings/);\n'],
  ]);
  // The sign-in page is the first thing a new person sees. It must not announce the server's version and operating system
  // ("0.3.0-rc.2 on linux") or offer pairing by code, which is the original app's self-hosting path.
  edit("src/pair/PairPage.tsx", [
    ['          {environment && !cloudHome ? `${at("pair.version", { version: environment.version, platform: environment.platform })} ` : ""}\n', ''],
    ['            <button type="button" onClick={() => switchMode("code")} className="mt-3 w-full text-[13px] text-ink-secondary underline">\n              {at("pair.advanced")}\n            </button>\n', ''],
  ]);
}

/** Locale text: remove every `openmausbot` command from what people read. Other languages use the English wording until translated. */
export function patchLocaleBrand(source) {
  const ENGLISH = {
    "cloudMove.error.ownerNeeded": "This app isn't signed in to {server} as its owner. Sign in again as the owner, then copy.",
    "settings.experimental.browserWindows": "Not available on this Windows machine yet.",
    "browser.notInstalled": "The browser engine is not installed yet. Turn on the browser switches in Settings → Computers and in the agent's Access settings, then open the agent's computer → Browser to install it.",
    "remote.serverPairing.chatOnly": "This device is connected with chat and approvals only, so it cannot pair others. Ask the Server owner for a full-access link.",
    "remote.client.server.hint": "Paste the pairing link the Server owner sent you, including its 12-character code.",
    "onboarding.reel.terminal.body": "Use AIKINGBOT in the desktop app or on the web, with the same account.",
  };
  const VIETNAMESE = {
    "cloudMove.error.ownerNeeded": "Ứng dụng này chưa đăng nhập vào {server} với tư cách chủ sở hữu. Hãy đăng nhập lại bằng tài khoản chủ sở hữu rồi sao chép.",
    "settings.experimental.browserWindows": "Chưa khả dụng trên máy Windows này.",
    "browser.notInstalled": "Công cụ trình duyệt chưa được cài. Hãy bật các công tắc trình duyệt trong Cài đặt → Máy tính và trong phần Truy cập của agent, rồi mở Máy tính của agent → Trình duyệt để cài.",
    "remote.serverPairing.chatOnly": "Thiết bị này chỉ có quyền trò chuyện và phê duyệt nên không ghép nối được thiết bị khác. Hãy xin chủ Server liên kết toàn quyền.",
    "remote.client.server.hint": "Dán liên kết ghép nối mà chủ Server gửi cho bạn, gồm cả mã 12 ký tự.",
    "onboarding.reel.terminal.body": "Dùng AIKINGBOT trên ứng dụng máy tính hoặc trên web, cùng một tài khoản.",
  };
  const directory = join(source, "src/locales");
  const englishData = JSON.parse(readFileSync(join(directory, "en.json"), "utf8"));
  for (const name of readdirSync(directory).filter(file => file.endsWith(".json"))) {
    const file = join(directory, name);
    const text = readFileSync(file, "utf8");
    const data = JSON.parse(text);
    const words = name === "vi.json" ? VIETNAMESE : ENGLISH;
    let changed = false;
    for (const [key, value] of Object.entries(words)) if (key in data && data[key] !== value) { data[key] = value; changed = true; }
    for (const [key, value] of Object.entries(data)) {
      if (!/open[ -]?maus/i.test(String(value)) || key in words) continue;
      const english = englishData[key];
      data[key] = typeof english === "string" && !/open[ -]?maus/i.test(english) ? english : String(value).replace(/npx openmausbot[^`"]*/gi, "").replace(/`?openmausbot[^`.]*`?/gi, "AIKINGBOT").replace(/OpenMausBot/gi, "AIKINGBOT");
      changed = true;
    }
    if (changed) writeFileSync(file, JSON.stringify(data, null, 2) + (text.endsWith("\n") ? "\n" : ""));
  }
}
