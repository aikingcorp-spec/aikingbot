// Copyright (c) 2026 AIKING.
// Builds the standalone AIKINGBOT server bundle for a Linux x64 VPS from the
// prepared source (run setup.mjs first). One bundle backs both deployment
// modes in deploy/aikingbot-server: the Docker image and the systemd service.
//   node apps/desktop-foundation/server-bundle.mjs [--skip-build]
// Output: .aikingbot-foundation/server-bundle/aikingbot-server-<version>-linux-x64.tar.gz
// plus SHA256SUMS and bundle-manifest.json (commit, file hashes).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { repositoryRoot, runtimeRoot, sourceRoot } from "./setup.mjs";

if (process.platform !== "linux" || process.arch !== "x64") throw new Error("The server bundle targets Linux x64; build it on a Linux x64 host or CI runner.");
const pkg = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8"));
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: repositoryRoot, encoding: "utf8" }).trim() !== "";
const node = (args, cwd = sourceRoot) => execFileSync(process.execPath, args, { cwd, stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || "1" } });

if (!process.argv.includes("--skip-build")) {
  node(["node_modules/typescript/bin/tsc", "-p", "tsconfig.server.build.json"]);
  node(["scripts/bundle-server.mjs"]);
  node(["node_modules/vite/bin/vite.js", "build"]);
  node(["scripts/prepare-duckdb.mjs"]);
}
for (const required of ["dist-server/index.js", "dist-server/server-launcher.js", "dist/index.html", "dist-native/duckdb/linux-x64"]) {
  if (!existsSync(join(sourceRoot, required))) throw new Error(`Missing ${required}; run without --skip-build.`);
}

const name = `aikingbot-server-${pkg.version}-linux-x64`;
const outRoot = join(runtimeRoot, "server-bundle"); const stage = join(outRoot, name);
rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true });
cpSync(join(sourceRoot, "dist-server"), join(stage, "dist-server"), { recursive: true });
cpSync(join(sourceRoot, "dist"), join(stage, "dist"), { recursive: true });
cpSync(join(sourceRoot, "dist-native/duckdb/linux-x64"), join(stage, "duckdb"), { recursive: true });
mkdirSync(join(stage, "licenses"), { recursive: true });
for (const file of ["LICENSE", "NOTICE"]) cpSync(join(sourceRoot, file), join(stage, "licenses", `OpenMausBot-${file}`));
cpSync(join(sourceRoot, "aiking/NOTICE.txt"), join(stage, "licenses/AIKINGBOT-NOTICE.txt"));
cpSync(join(sourceRoot, "aiking/licenses"), join(stage, "licenses/AIKING-Core-dependencies"), { recursive: true });
cpSync(join(repositoryRoot, "deploy/aikingbot-server"), join(stage, "deploy"), { recursive: true });

const files = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) files.push({ path: relative(stage, path), bytes: statSync(path).size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
  }
};
walk(stage);
const manifest = { product: "AIKINGBOT server", version: pkg.version, commit, dirty, node: ">=24", builtAt: new Date().toISOString(), entry: "dist-server/server-launcher.js", files };
writeFileSync(join(stage, "bundle-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const archive = join(outRoot, `${name}.tar.gz`);
execFileSync("tar", ["--sort=name", "--owner=0", "--group=0", "--numeric-owner", "-czf", archive, "-C", outRoot, name]);
const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(join(outRoot, "SHA256SUMS"), `${digest}  ${name}.tar.gz\n`);
console.log(JSON.stringify({ archive, sha256: digest, commit, dirty, files: files.length }, null, 2));
