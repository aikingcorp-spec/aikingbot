// Generates the git-ignored embedded inputs (aiking/core/index.mjs, aiking/catalog.json,
// aiking/catalog-schema.mjs, aiking/licenses/) so `pnpm package:*` works from a fresh clone
// without first running the repository-level `node scripts/prepare.mjs`.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { coreRoot, repositoryRoot } from "../../../scripts/paths.mjs";

if (!existsSync(join(coreRoot, "node_modules"))) {
  console.log("prepare-embedded: installing packages/core (npm ci --ignore-scripts)");
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--ignore-scripts"], {
    cwd: coreRoot, stdio: "inherit", shell: process.platform === "win32",
  });
}
const { embed } = await import(pathToFileURL(join(repositoryRoot, "scripts/prepare.mjs")).href);
await embed();
console.log("prepare-embedded: aiking/core, catalog.json, catalog-schema.mjs, licenses generated");
