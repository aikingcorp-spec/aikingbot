import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  const pkgPath = join(sourceRoot, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = "aikingbot-foundation";
  pkg.productName = "AIKINGBOT";
  pkg.description = "AIKINGBOT stage 1 desktop foundation, based on the Apache-2.0 OpenMausBot edition.";
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(join(runtimeRoot, "source-manifest.json"), `${JSON.stringify({ ...lock, branding: "AIKINGBOT", edition: "oss", coreIntegrated: false }, null, 2)}\n`);
  console.log(`Prepared AIKINGBOT from ${lock.repository} @ ${actual}; enterprise/ excluded.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  prepareSource();
  if (!process.argv.includes("--source-only")) {
    const bin = process.env.AIKING_PNPM;
    execFileSync(bin || (process.platform === "win32" ? "npx.cmd" : "npx"), bin
      ? ["install", "--frozen-lockfile", "--filter", "aikingbot-foundation"]
      : ["--yes", lock.packageManager, "install", "--frozen-lockfile", "--filter", "aikingbot-foundation"], {
      cwd: sourceRoot, stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || "1" },
    });
    execFileSync(process.execPath, ["aiking/assets.mjs"], { cwd: sourceRoot, stdio: "inherit" });
  }
}
