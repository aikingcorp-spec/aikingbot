import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sourceRoot } from "./setup.mjs";

if (!existsSync(join(sourceRoot, "node_modules/vite"))) {
  throw new Error("Run node apps/desktop-foundation/setup.mjs first.");
}
const allowed = new Set(["--offline", "--desktop", "--core", "--production"]);
for (const arg of process.argv.slice(2)) if (!allowed.has(arg)) throw new Error(`Unknown option: ${arg}`);
const child = spawn(process.execPath, ["--experimental-strip-types", "aiking/runtime.ts", ...process.argv.slice(2)], {
  cwd: sourceRoot, env: process.env, stdio: ["inherit", "inherit", "inherit", "ipc"],
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { if (child.connected) child.send({ type: "aiking.shutdown" }); else child.kill(signal); });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
