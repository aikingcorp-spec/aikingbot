import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const config = require("../electron-builder.aiking.cjs");
const pkg = require("../package.json");
const { windowsVersion } = require("../aiking/windows-version.cjs");

test("Windows ProductVersion follows the package prerelease (rc.7 -> 0.3.0.7)", () => {
  assert.equal(windowsVersion("0.3.0-rc.7"), "0.3.0.7");
  assert.equal(windowsVersion("1.2.3"), "1.2.3.0");
  assert.equal(windowsVersion("1.2.3-beta.12"), "1.2.3.12");
  assert.equal(config.extraMetadata.shortVersionWindows, windowsVersion(pkg.version));
  assert.equal(pkg.version, "0.3.0-rc.7");
  assert.equal(config.extraMetadata.shortVersionWindows, "0.3.0.7");
});
