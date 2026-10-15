import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { patchIntegration } from "./integration-patches.mjs";
import { patchShipping } from "./shipping-patches.mjs";

export const foundationRoot = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(foundationRoot, "../..");
export const runtimeRoot = join(repositoryRoot, ".aikingbot-foundation");
export const sourceRoot = join(runtimeRoot, "source");
const vendorRoot = join(repositoryRoot, "vendor/openmausbot");
const lock = JSON.parse(readFileSync(join(foundationRoot, "source.lock.json"), "utf8"));

export function prepareSource() {
  if (Number(process.versions.node.split(".")[0]) < lock.nodeMajor) {
    throw new Error(`Node.js ${lock.nodeMajor} or newer is required.`);
  }
  if (!existsSync(join(vendorRoot, "package.json"))) {
    execFileSync("git", ["submodule", "update", "--init", "vendor/openmausbot"], {
      cwd: repositoryRoot, stdio: "inherit",
    });
  }
  const actual = execFileSync("git", ["rev-parse", "HEAD"], { cwd: vendorRoot, encoding: "utf8" }).trim();
  if (actual !== lock.commit) throw new Error(`Source pin mismatch: expected ${lock.commit}, found ${actual}.`);
  mkdirSync(sourceRoot, { recursive: true });
  if (existsSync(join(sourceRoot, "enterprise"))) {
    throw new Error("The runtime source contains enterprise/. Use a new runtime directory; setup will not delete it.");
  }
  const archive = join(runtimeRoot, "source.tar");
  execFileSync("git", ["archive", "--format=tar", `--output=${archive}`, lock.commit, ".", ...lock.excludedPaths.map((p) => `:(exclude)${p}`)], { cwd: vendorRoot });
  execFileSync("tar", ["-xf", archive, "-C", sourceRoot]);
  cpSync(join(foundationRoot, "overrides"), sourceRoot, { recursive: true });
  patchIntegration(sourceRoot);
  const pkgPath = join(sourceRoot, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = "aikingbot-foundation";
  pkg.productName = "AIKINGBOT";
  pkg.description = "AIKINGBOT desktop with Core, voice and agent teams, based on the Apache-2.0 OpenMausBot edition.";
  patchShipping(sourceRoot, pkg);
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(join(runtimeRoot, "source-manifest.json"), `${JSON.stringify({ ...lock, branding: "AIKINGBOT", edition: "oss", coreIntegrated: true }, null, 2)}\n`);
  console.log(`Prepared AIKINGBOT from ${lock.repository} @ ${actual}; enterprise/ excluded.`);
}

export async function prepareCore() {
  const { build } = await import(pathToFileURL(join(sourceRoot, "node_modules/esbuild/lib/main.js")).href);
  await build({ entryPoints: [join(repositoryRoot, "src/desktop.ts")], outfile: join(sourceRoot, "aiking/core/index.mjs"), bundle: true,
    platform: "node", target: "node24", format: "esm", banner: { js: 'import { createRequire as aikingCreateRequire } from "node:module"; const require = aikingCreateRequire(import.meta.url);' } });
  const catalogModule = join(sourceRoot, "aiking/catalog-build.mjs");
  await build({ entryPoints: [join(foundationRoot, "overrides/src/aiking/marketplace/aiking-catalog.ts")], outfile: catalogModule, platform: "node", target: "node24", format: "esm", bundle: true });
  const { AIKING_CATALOG } = await import(`${pathToFileURL(catalogModule).href}?build=${Date.now()}`);
  writeFileSync(join(sourceRoot, "aiking/catalog.json"), JSON.stringify(AIKING_CATALOG));
  await build({ stdin: { contents: 'import { catalogDocumentSchema } from "./src/aiking/marketplace/contract.ts"; export const decodeCatalog = value => catalogDocumentSchema.parse(value);', resolveDir: sourceRoot }, outfile: join(sourceRoot, "aiking/catalog-schema.mjs"), platform: "node", target: "node24", format: "esm", bundle: true });
  const packages = JSON.parse(readFileSync(join(repositoryRoot, "package-lock.json"))).packages;
  const licenseRoot = join(sourceRoot, "aiking/licenses"); mkdirSync(licenseRoot, { recursive: true });
  const inventory = [];
  for (const [path, entry] of Object.entries(packages)) {
    if (!path.startsWith("node_modules/") || entry.dev) continue;
    let directory = join(repositoryRoot, path); if (!existsSync(directory)) continue;
    const metadata = JSON.parse(readFileSync(join(directory, "package.json")));
    let files = readdirSync(directory, { withFileTypes: true }).filter(file => file.isFile() && /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(file.name)).map(file => file.name);
    if (!files.length && metadata.name === "standardwebhooks" && metadata.version === "1.1.1") {
      directory = join(foundationRoot, "overrides/aiking/third_party");
      files = ["standardwebhooks-LICENSE.txt", "standardwebhooks-NOTICE.txt"];
    }
    if (!files.length) throw new Error(`Missing distribution license for ${metadata.name}; inspect before packaging.`);
    const destination = join(licenseRoot, `${metadata.name.replaceAll("/", "__")}@${metadata.version}`); mkdirSync(destination, { recursive: true });
    for (const file of files) cpSync(join(directory, file), join(destination, file));
    inventory.push({ name: metadata.name, version: metadata.version, license: metadata.license, files });
  }
  writeFileSync(join(licenseRoot, "inventory.json"), JSON.stringify(inventory, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  prepareSource();
  if (!process.argv.includes("--source-only")) {
    const bin = process.env.AIKING_PNPM;
    const windowsNpx = join(dirname(process.execPath), "node_modules/npm/bin/npx-cli.js");
    const useNodeNpx = !bin && process.platform === "win32";
    if (useNodeNpx && !existsSync(windowsNpx)) throw new Error("The Windows Node installation must include npm/npx.");
    if (bin && process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) throw new Error("AIKING_PNPM on Windows must name an executable or JavaScript entry point.");
    const useNodeBin = bin && /\.[cm]?js$/i.test(bin);
    const args = bin
      ? ["install", "--frozen-lockfile", "--filter", "aikingbot-foundation"]
      : ["--yes", lock.packageManager, "install", "--frozen-lockfile", "--filter", "aikingbot-foundation"];
    execFileSync(useNodeNpx || useNodeBin ? process.execPath : bin || "npx", [...(useNodeNpx ? [windowsNpx] : useNodeBin ? [bin] : []), ...args], {
      cwd: sourceRoot, stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || "1" },
    });
    execFileSync(process.execPath, ["aiking/assets.mjs"], { cwd: sourceRoot, stdio: "inherit" });
  }
  await prepareCore();
}
