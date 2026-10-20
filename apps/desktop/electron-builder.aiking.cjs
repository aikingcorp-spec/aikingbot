// Copyright (c) 2026 AIKING.
const fs = require("node:fs");
const path = require("node:path");
const config = require("yaml").parse(fs.readFileSync(path.join(__dirname, "electron-builder.yml"), "utf8"));
config.appId = "com.aikingcorp.aikingbot";
config.productName = "AIKINGBOT";
config.artifactName = "AIKINGBOT-${version}-${arch}.${ext}";
config.copyright = "Copyright © 2026 AIKING";
// The packaged app must carry app-update.yml: electron-updater reads it (updaterCacheDirName) before every download,
// and electron-builder only writes it when a publish provider is configured. `--publish never` still keeps uploads off.
config.publish = [{ provider: "generic", url: process.env.AIKING_UPDATE_FEED_BUILD || "https://aikingbot.srv1866690.hstgr.cloud/updates/windows/" }];
config.files.push("!electron/**/*.node-test.*");
config.protocols = [{ name: "AIKINGBOT links", schemes: ["aikingbot"] }];
config.extraResources.push({ from: "aiking/NOTICE.txt", to: "licenses/AIKINGBOT-NOTICE.txt" });
config.extraResources.push({ from: "aiking/licenses", to: "licenses/AIKING-Core-dependencies" });
// Redistribute Node.js/npm (with their license texts) on Windows only, not provider CLIs.
// The app installs each provider on demand with explicit user consent and OAuth.
if (process.platform === "win32") {
  config.extraResources.push({ from: "aiking/provider-runtime/bin", to: "provider-runtime/bin" });
  const originalAfterPack = config.afterPack;
  config.afterPack = async (context) => {
    const { pathToFileURL } = require("node:url");
    await (await import(pathToFileURL(path.resolve(__dirname, originalAfterPack)).href)).default(context);
    const resources = context.packager.getResourcesDir(context.appOutDir);
    require("./aiking/packaged-provider-runtime.cjs").installPackagedProviderRuntime(path.join(__dirname, "aiking/provider-runtime/bin"), resources);
  };
}

config.mac.extendInfo.NSMicrophoneUsageDescription = "AIKINGBOT uses the microphone for voice calls and dictation.";
config.mac.extendInfo.NSSpeechRecognitionUsageDescription = "AIKINGBOT transcribes speech using your selected speech service.";
config.mac.extendInfo.NSAccessibilityUsageDescription = "AIKINGBOT uses Accessibility when you let an agent control this Mac.";
config.mac.extendInfo.NSScreenCaptureUsageDescription = "AIKINGBOT uses Screen Recording when you allow agents to see this Mac.";
config.dmg.artifactName = "AIKINGBOT-${version}-${arch}.dmg";
config.nsis.shortcutName = "AIKINGBOT";
config.nsis.artifactName = "AIKINGBOT-${version}-setup.${ext}";
config.linux.executableName = "aikingbot";
config.linux.icon = "build/icons";
config.linux.vendor = "AIKING";
config.linux.maintainer = "AIKING <aiking.corp@gmail.com>";
config.linux.synopsis = "Desktop AI agents, voice and collaboration";
config.linux.desktop.entry.Name = "AIKINGBOT";
config.linux.desktop.entry.Comment = "Desktop AI agents, voice and collaboration";
config.linux.extraResources = config.linux.extraResources.map(resource => resource.to === "aikingbot-browser.apparmor" ? { ...resource, to: "aikingbot-browser.apparmor" } : resource);
module.exports = config;
