// Copyright (c) 2026 AIKING.
// Prepares a checkout for building: installs both packages, fetches the pinned assets, and builds what the desktop app embeds
// (AIKING Core, the marketplace catalog, the list of third-party licenses).
//   node scripts/prepare.mjs            install + prepare
//   node scripts/prepare.mjs --embed    only rebuild the embedded parts (no install)
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { coreRoot, sourceRoot } from "./paths.mjs";

const PNPM = "pnpm@10.33.0";
const env = { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || "1" };

function install() {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24 or newer is required.");
  const bin = process.env.AIKING_PNPM;
  const windowsNpx = join(process.execPath, "..", "node_modules/npm/bin/npx-cli.js");
  const useNodeNpx = !bin && process.platform === "win32";
  if (useNodeNpx && !existsSync(windowsNpx)) throw new Error("The Windows Node installation must include npm/npx.");
  const useNodeBin = bin && /\.[cm]?js$/i.test(bin);
  const args = bin ? ["install", "--frozen-lockfile"] : ["--yes", PNPM, "install", "--frozen-lockfile"];
  execFileSync(useNodeNpx || useNodeBin ? process.execPath : bin || "npx", [...(useNodeNpx ? [windowsNpx] : useNodeBin ? [bin] : []), ...args], { cwd: sourceRoot, stdio: "inherit", env });
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--ignore-scripts"], { cwd: coreRoot, stdio: "inherit", env, shell: process.platform === "win32" });
  execFileSync(process.execPath, ["aiking/assets.mjs"], { cwd: sourceRoot, stdio: "inherit", env });
}

export async function embed() {
  const { build } = await import(pathToFileURL(join(sourceRoot, "node_modules/esbuild/lib/main.js")).href);
  mkdirSync(join(sourceRoot, "aiking/core"), { recursive: true });
  await build({ entryPoints: [join(coreRoot, "src/desktop.ts")], outfile: join(sourceRoot, "aiking/core/index.mjs"), bundle: true,
    platform: "node", target: "node24", format: "esm", banner: { js: 'import { createRequire as aikingCreateRequire } from "node:module"; const require = aikingCreateRequire(import.meta.url);' } });
  const catalogModule = join(sourceRoot, "aiking/catalog-build.mjs");
  await build({ entryPoints: [join(sourceRoot, "src/aiking/marketplace/aiking-catalog.ts")], outfile: catalogModule, platform: "node", target: "node24", format: "esm", bundle: true });
  const { AIKING_CATALOG } = await import(pathToFileURL(catalogModule).href + "?build=" + Date.now());
  writeFileSync(join(sourceRoot, "aiking/catalog.json"), JSON.stringify(AIKING_CATALOG));
  await build({ stdin: { contents: 'import { catalogDocumentSchema } from "./src/aiking/marketplace/contract.ts"; export const decodeCatalog = value => catalogDocumentSchema.parse(value);', resolveDir: sourceRoot }, outfile: join(sourceRoot, "aiking/catalog-schema.mjs"), platform: "node", target: "node24", format: "esm", bundle: true });
  const packages = JSON.parse(readFileSync(join(coreRoot, "package-lock.json"), "utf8")).packages;
  const licenseRoot = join(sourceRoot, "aiking/licenses"); mkdirSync(licenseRoot, { recursive: true });
  const inventory = [];
  for (const [path, entry] of Object.entries(packages)) {
    if (!path.startsWith("node_modules/") || entry.dev) continue;
    let directory = join(coreRoot, path); if (!existsSync(directory)) continue;
    const metadata = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    let files = readdirSync(directory, { withFileTypes: true }).filter((file) => file.isFile() && /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(file.name)).map((file) => file.name);
    if (!files.length && metadata.name === "standardwebhooks" && metadata.version === "1.1.1") {
      directory = join(sourceRoot, "aiking/third_party");
      files = ["standardwebhooks-LICENSE.txt", "standardwebhooks-NOTICE.txt"];
    }
    if (!files.length) throw new Error("Missing distribution license for " + metadata.name + "; inspect before packaging.");
    const destination = join(licenseRoot, metadata.name.replaceAll("/", "__") + "@" + metadata.version); mkdirSync(destination, { recursive: true });
    for (const file of files) cpSync(join(directory, file), join(destination, file));
    inventory.push({ name: metadata.name, version: metadata.version, license: metadata.license, files });
  }
  writeFileSync(join(licenseRoot, "inventory.json"), JSON.stringify(inventory, null, 2));
}

// Compared as file URLs: on Windows a path (D:\a\x) never equals a URL pathname (/D:/a/x), and the script would quietly do nothing.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (!process.argv.includes("--embed")) install();
  await embed();
}
