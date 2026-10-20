// Copyright (c) 2026 AIKING.
// Upstream Cloud account, plan, move and lending bridges exist only when an AIKING Cloud origin is configured;
// organization sign-in and company backups keep the packaged-desktop flag.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const origin = "http://127.0.0.1:48993";
function bridge(argv) {
  let exposed;
  vm.runInNewContext(readFileSync(new URL("./preload.cjs", import.meta.url), "utf8"), {
    process: { platform: "fixture", argv: [`--omb-local-origin=${origin}`, ...argv] },
    location: { origin }, TextEncoder, localStorage: { getItem: () => null },
    require: () => ({ webUtils: {}, contextBridge: { exposeInMainWorld: (_name, value) => { exposed = value; } },
      ipcRenderer: { on() {}, removeListener() {}, send() {}, invoke: () => Promise.resolve(null) } }),
  });
  return exposed;
}
const cloud = ["cloudAccount", "cloudMove", "cloudLending", "cloudPlan"];
test("packaged desktop without an AIKING Cloud origin exposes no upstream Cloud bridges", () => {
  const exposed = bridge(["--omb-company-desktop=1"]);
  for (const name of cloud) assert.equal(exposed[name], undefined, name);
  assert.ok(exposed.organization); assert.ok(exposed.companyBackups);
});
test("a configured AIKING Cloud origin restores the Cloud bridges", () => {
  const exposed = bridge(["--omb-company-desktop=1", "--aiking-cloud=1"]);
  for (const name of cloud) assert.ok(exposed[name], name);
});
test("main passes the Cloud flag only when AIKING_CLOUD_ORIGIN is set", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  assert.ok(main.includes('["--omb-company-desktop=1", ...(process.env.AIKING_CLOUD_ORIGIN ? ["--aiking-cloud=1"] : [])]'));
});
