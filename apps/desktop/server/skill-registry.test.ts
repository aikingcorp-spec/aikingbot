import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { installLibrarySkill, librarySkillDirectory, setLibrarySkillReviewState } from "./skill-library.ts";
import { listRegistry, lookupRegistry } from "./skill-registry.ts";

const MD = (n: string) => `---\nname: ${n}\ndescription: Does ${n}.\ncompatibility: needs the browser capability\n---\n\nBody of ${n}.\n`;
const roots: string[] = [];
const fresh = () => { const r = mkdtempSync(join(tmpdir(), "reg-")); roots.push(r); return r; };
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const put = (root: string, name: string, extra: object = {}) =>
  installLibrarySkill({ name, instructions: MD(name), source: "https://example.invalid/x", root, reviewState: "approved", license: "MIT", compatibility: "needs the browser capability", ...extra });

describe("skill registry", () => {
  it("lists metadata without opening any SKILL.md", () => {
    const root = fresh(); put(root, "alpha"); put(root, "beta");
    const list = listRegistry({ root });
    expect(list.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(list[0]).toMatchObject({ trust: "reviewed", prerequisites: "needs the browser capability", version: null });
    expect(JSON.stringify(list)).not.toContain("Body of");
  });
  it("future timestamps quarantine and license policy is enforced", () => {
    const root = fresh(); put(root, "future", { importedAt: new Date(Date.now() + 86_400_000).toISOString(), source: "local-import" });
    const r = lookupRegistry("future", { root, now: new Date(0) })!;
    expect(r.metadata.ttl.ageDays).toBeNull();
    expect(r.metadata.warnings.join(" ")).toMatch(/future/);
    expect(r.metadata.trust).toBe("disabled");
    expect(r.metadata.trust).toBe("disabled");
    expect(r.body).toBeNull();
  });
  it("approved local and marketplace sources remain reviewable, but unapproved HTTPS is disabled", () => {
    const root = fresh();
    put(root, "local", { source: "local-import", license: "MIT" });
    put(root, "market", { source: "marketplace:demo", license: "MIT" });
    put(root, "unapproved", { source: "https://example.invalid/x", license: "MIT", reviewState: "disabled" });
    expect(lookupRegistry("local", { root })!.metadata.trust).toBe("reviewed");
    expect(lookupRegistry("market", { root })!.metadata.trust).toBe("reviewed");
    expect(lookupRegistry("unapproved", { root })!.metadata.trust).toBe("disabled");
  });
  it("UNKNOWN and forbidden licenses quarantine", () => {
    const root = fresh(); put(root, "unknown", { license: "UNKNOWN" }); put(root, "forbid", { license: "forbidden" });
    expect(lookupRegistry("unknown", { root })!.body).toBeNull();
    expect(lookupRegistry("forbid", { root })!.body).toBeNull();
  });
  it("TTL is advisory: stale is flagged, body still served", () => {
    const root = fresh(); put(root, "alpha");
    const later = new Date(Date.now() + 200 * 86_400_000);
    const r = lookupRegistry("alpha", { root, now: later, ttlDays: 90 })!;
    expect(r.metadata.ttl.stale).toBe(true);
    expect(r.body).toBeNull();
    expect(r.integrity).toBe("not-checked");
    expect(lookupRegistry("alpha", { root })!.metadata.ttl.stale).toBe(false);
  });
  it("integrity: a tampered body is withheld", () => {
    const root = fresh(); put(root, "alpha", { license: "MIT" });
    writeFileSync(join(librarySkillDirectory(root, "alpha"), "SKILL.md"), "tampered");
    const r = lookupRegistry("alpha", { root })!;
    expect(r.integrity).toBe("failed");
    expect(r.body).toBeNull();
  });
  it("trust: a disabled skill returns metadata and no body; unknown name is null", () => {
    const root = fresh(); put(root, "alpha");
    setLibrarySkillReviewState("alpha", "disabled", root);
    const r = lookupRegistry("alpha", { root })!;
    expect(r.metadata.trust).toBe("disabled");
    expect(r.body).toBeNull();
    expect(lookupRegistry("nope", { root })).toBeNull();
    expect(lookupRegistry("../etc", { root })).toBeNull();
  });
});
