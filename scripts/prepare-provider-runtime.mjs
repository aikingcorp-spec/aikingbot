// AIKINGBOT — portable provider runtime for packaged Windows (no Node/npm prerequisite).
// Copied from the Node.js 24 installation selected by CI; never bundles proprietary provider CLIs.
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { sourceRoot } from "./paths.mjs";

if (process.platform !== "win32") {
  console.log("Portable provider runtime: skipped on non-Windows.");
  process.exit(0);
}
const selected = dirname(process.execPath);
const target = join(sourceRoot, "aiking/provider-runtime/bin");
const required = ["node.exe", "npm.cmd", "node_modules/npm/bin/npm-cli.js", "node_modules/npm/LICENSE", "LICENSE"];
for (const name of required) {
  if (!existsSync(join(selected, name))) throw new Error("Missing Node.js distribution file required for portable provider runtime: " + name);
}
if (!process.versions.node.startsWith("24.")) throw new Error("Windows provider runtime requires Node.js 24 for reproducible packaging.");
rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, "node_modules"), { recursive: true });
for (const name of ["node.exe", "npm.cmd", "LICENSE"]) copyFileSync(join(selected, name), join(target, name));
cpSync(join(selected, "node_modules/npm"), join(target, "node_modules/npm"), { recursive: true });
console.log("Portable provider runtime prepared:", process.version, "node.exe", statSync(join(target, "node.exe")).size, "bytes. Providers install only after the user clicks Connect.");
