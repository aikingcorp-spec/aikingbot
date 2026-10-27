// Copyright (c) 2026 AIKING.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sourceRoot, repositoryRoot, runtimeRoot, coreRoot } from "./paths.mjs";

const options = new Set(process.argv.slice(2));
// The pinned native release validator requires distributable manifests to be 0644.
process.umask(0o022);
for (const option of options) if (!["--dir", "--reuse-native", "--package-only"].includes(option)) throw new Error(`Unknown build option: ${option}`);
if (!existsSync(join(sourceRoot, "node_modules/electron-builder/cli.js"))) throw new Error("Run node scripts/prepare.mjs first.");
const run = (entry, args = [], cwd = sourceRoot) => {
  console.log(`Build: ${entry}`);
  const result = spawnSync(process.execPath, [entry, ...args], { cwd, stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || "1", CSC_IDENTITY_AUTO_DISCOVERY: "false" } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${entry} failed (${result.status ?? result.signal}).`);
};
if (!options.has("--package-only")) {
  // catalog.json / core / licenses are git-ignored build outputs; regenerate so a fresh clone builds.
  run("scripts/prepare-embedded.mjs");
  run("node_modules/typescript/bin/tsc", ["--noEmit"], coreRoot);
  run("aiking/assets.mjs");
  run("node_modules/typescript/bin/tsc", ["-b"]);
  run("node_modules/vite/bin/vite.js", ["build"]);
  run("node_modules/typescript/bin/tsc", ["-p", "tsconfig.server.build.json"]);
  run("scripts/bundle-server.mjs");
  run("node_modules/typescript/bin/tsc", ["-p", "tsconfig.companion.build.json"]);
  run("scripts/mark-module-scope.mjs", ["dist-companion"]);
  run("scripts/bundle-updater.mjs");
  if (!options.has("--reuse-native")) {
    for (const entry of ["prepare-android-tools.mjs", "prepare-cloudflared.mjs", "prepare-browser.mjs", "prepare-duckdb.mjs"]) run(`scripts/${entry}`);
    if (process.platform === "linux") run("scripts/prepare-cua-linux.mjs");
    else if (process.platform === "win32") run("scripts/prepare-cua-win.mjs");
    else if (process.platform === "darwin") { run("electron/build-speech-helper.mjs"); run("scripts/prepare-cua.mjs"); }
    else throw new Error(`No desktop package target for ${process.platform}`);
  }
}
if (process.platform === "win32") run(join(repositoryRoot, "scripts/prepare-provider-runtime.mjs"));
const platform = { win32: "--win", linux: "--linux", darwin: "--mac" }[process.platform];
if (!platform) throw new Error("Unsupported desktop platform");
run("node_modules/electron-builder/cli.js", ["--config", "electron-builder.aiking.cjs", platform, ...(options.has("--dir") ? ["dir"] : []), "--x64", "--publish", "never"]);
const release = join(sourceRoot, "release");
// An installed app without app-update.yml finds updates but cannot download them (rc.2 shipped like that).
const unpacked = readdirSync(release).filter(name => name.endsWith("-unpacked"));
if (!unpacked.length) throw new Error("No unpacked app directory found to verify updater configuration");
for (const name of unpacked) {
  const file = join(release, name, "resources/app-update.yml");
  if (!existsSync(file) || !/^provider: generic$/m.test(readFileSync(file, "utf8")) || !/^updaterCacheDirName: \S+$/m.test(readFileSync(file, "utf8"))) throw new Error(`${name} is missing a usable resources/app-update.yml`);
}
const artifacts = readdirSync(release).filter(name => /\.(?:exe|zip|deb|AppImage|dmg)$/.test(name)).map(name => {
  const path = join(release, name); return { name, bytes: statSync(path).size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
});
mkdirSync(join(runtimeRoot, "evidence/shipping"), { recursive: true });
writeFileSync(join(runtimeRoot, "evidence/shipping/build-artifacts.json"), JSON.stringify({ builtAt: new Date().toISOString(), commit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).stdout.trim(), platform: process.platform, architecture: process.arch, version: JSON.parse(readFileSync(join(sourceRoot, "package.json"))).version, artifacts }, null, 2));
console.log(JSON.stringify({ release, artifacts }, null, 2));
