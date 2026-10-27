// 1.18: the release gate (tests/manifest.json) names only files that exist, and carries the rc8 tests.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const desktop = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(desktop, "../../tests/manifest.json"), "utf8")) as { desktop: string[] };

export const RC8_GATE = [
  "server/request-connect.test.ts",
  "server/marketplace-search.test.ts",
  "server/routes/mcp-api-key.test.ts",
  "src/lib/mcp-connect.test.ts",
  "server/usage-cache-ratio.test.ts",
  "server/release-gate-manifest.test.ts",
  "src/components/LocalComputerSection.test.ts",
  "src/components/PanelBoundary.test.ts",
  "server/harness/harness-policies.test.ts",
  "server/usage-sources.test.ts",
  "server/recall-vi.test.ts",
  "server/skill-map.test.ts",
  "server/connect-gaps.test.ts",
  "server/engine-capabilities.test.ts",
  "server/runtime/subagent-contract.test.ts",
  "src/components/mode-parity.test.ts",
];

describe("release gate manifest", () => {
  it("lists only test files that exist, once each", () => {
    expect(manifest.desktop.filter((file) => !existsSync(join(desktop, file)))).toEqual([]);
    expect(new Set(manifest.desktop).size).toBe(manifest.desktop.length);
  });
  it("includes every rc8 test", () => {
    expect(RC8_GATE.filter((file) => !manifest.desktop.includes(file))).toEqual([]);
  });
});
