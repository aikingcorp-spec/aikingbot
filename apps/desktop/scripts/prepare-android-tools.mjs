// Stage Google's official Android Platform Tools beside the packaged app so
// USB phone support works on a clean machine without Homebrew or an SDK.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractZip } from "./extract-zip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const platformNames = { darwin: "darwin", linux: "linux", win32: "win32" };
const archiveNames = { darwin: "darwin", linux: "linux", win32: "windows" };
const platform = platformNames[process.platform];
const archive = archiveNames[process.platform];
if (!platform || !archive) throw new Error(`Android Platform Tools are unsupported on ${process.platform}`);

const finalDir = join(root, "dist-native", "android-platform-tools", platform);
const override = process.env.AIKING_ANDROID_PLATFORM_TOOLS_SOURCE;
const temporary = mkdtempSync(join(tmpdir(), "aiking-android-tools-"));
const staged = join(temporary, platform);

try {
  if (override) {
    if (!existsSync(join(override, process.platform === "win32" ? "adb.exe" : "adb"))) {
      throw new Error(`AIKING_ANDROID_PLATFORM_TOOLS_SOURCE has no adb: ${override}`);
    }
    cpSync(override, staged, { recursive: true });
  } else {
    const url = `https://dl.google.com/android/repository/platform-tools-latest-${archive}.zip`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`could not download Android Platform Tools: HTTP ${response.status}`);
    const zip = join(temporary, basename(new URL(url).pathname));
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
    const extraction = join(temporary, "extracted");
    mkdirSync(extraction);
    // Built-in extractor: no system unzip/tar needed on any OS.
    extractZip(zip, extraction);
    cpSync(join(extraction, "platform-tools"), staged, { recursive: true });
  }

  const adb = join(staged, process.platform === "win32" ? "adb.exe" : "adb");
  if (!existsSync(adb)) throw new Error("Downloaded Android Platform Tools do not contain adb");
  mkdirSync(dirname(finalDir), { recursive: true });
  rmSync(finalDir, { recursive: true, force: true });
  cpSync(staged, finalDir, { recursive: true });
  console.log(`staged Android Platform Tools at ${finalDir}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
