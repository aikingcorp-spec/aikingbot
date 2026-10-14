// Prepares an unsigned Windows x64 build of AIKINGBOT that runs in local-only mode.
//
// The release build pins a prebuilt remote desktop runtime. AIKINGBOT has none yet: the upstream
// artifacts were built from the upstream recipe, and remote desktop needs the hosted services that
// local-only mode turns off. The installer therefore ships an empty runtime directory, and the app
// reports remote desktop as unavailable. The provider control artifacts come from their vendors.
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";

await mkdir("build/remote-desktop-runtime", { recursive: true });
for (const provider of ["codex", "claude", "grok"]) {
  execFileSync("bun", [`scripts/install-${provider}-runtime.ts`, "win32", "x64"], { stdio: "inherit" });
}
