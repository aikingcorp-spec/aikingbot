// Copyright (c) 2026 AIKING.
// The release gate: runs the test files listed in tests/manifest.json (or the ones named on the command line).
//   node scripts/run-tests.mjs [file ...]
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryRoot, runtimeRoot, sourceRoot } from "./paths.mjs";

process.umask(0o022); // native package fixtures need a normal build umask
const manifest = JSON.parse(readFileSync(join(repositoryRoot, "tests/manifest.json"), "utf8"));
const files = process.argv.length > 2 ? process.argv.slice(2) : manifest.desktop;
const out = join(runtimeRoot, "evidence/tests"); mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "aiking-tests-"));
try {
  execFileSync(process.execPath, [join(sourceRoot, "node_modules/vitest/vitest.mjs"), "run", ...files, "--testTimeout=60000", "--reporter=default", "--reporter=json", "--outputFile.json=" + join(out, "result.json")], {
    cwd: sourceRoot, stdio: "inherit", env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch,
      ...(Object.keys(process.env).some((key) => /^(https?_proxy)$/i.test(key) && process.env[key]) ? { NO_PROXY: [process.env.NO_PROXY, "127.0.0.1", "localhost", "::1"].filter(Boolean).join(",") } : {}) } });
} finally { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
