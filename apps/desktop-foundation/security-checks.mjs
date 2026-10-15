// Copyright (c) 2026 AIKING.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { runtimeRoot, sourceRoot } from "./setup.mjs";

const out = join(runtimeRoot, "evidence/shipping"); mkdirSync(out, { recursive: true });
const tests = ["aiking-service-config", "save-file", "desktop-server-auth", "app-permissions", "local-origin", "preload", "desktop-viewer-permissions", "remote-microphone-permission", "data-dir-lease", "server-supervisor"];
execFileSync(process.execPath, ["--test", "--test-reporter=spec", "--test-reporter=junit", "--test-reporter-destination=stdout", `--test-reporter-destination=${join(out, "desktop-security.xml")}`, ...tests.map(test => `electron/${test}.node-test.mjs`)], { cwd: sourceRoot, stdio: "inherit" });
