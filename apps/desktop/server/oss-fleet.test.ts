import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fleetAccountWorkspaces } from "./aiking/fleet-account-workspaces.ts";
import { diagnoseFleet } from "./fleet-doctor.ts";
import { DEFAULT_INVITE_LIMIT } from "./invite-limit.ts";
import { createOssFleet, ossFleetReady, ossFleetRoot, type OssFleet } from "./oss-fleet.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const fleet of fleets) fleet.stopAll();
  fleets.length = 0;
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const fleets: OssFleet[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "oss-fleet-"));
  dirs.push(root);
  return root;
}

function fleet(root = tempRoot()): OssFleet {
  // Container-like: no systemd, no spawn — isolation is per-server data dirs + ports.
  const created = createOssFleet({ root, domain: "example.test", spawnChildren: false });
  fleets.push(created);
  return created;
}

describe("oss fleet (container-like, no systemd)", () => {
  it("resolves a writable root under AIKING_FLEET_ROOT or DATA_DIR/fleet", () => {
    const root = tempRoot();
    expect(ossFleetRoot({ AIKING_FLEET_ROOT: root })).toBe(root);
    expect(ossFleetRoot({ AIKING_DATA_DIR: root })).toBe(join(root, "fleet"));
    expect(ossFleetReady(root)).toBe(true);
  });

  it("creates a server with its own data directory and port", () => {
    const f = fleet();
    const created = f.create({ slug: "acme", admins: ["owner@acme.test"], members: ["m@acme.test"] });
    expect(created.status).toBe(200);
    if ("error" in created.body) throw new Error(created.body.error);
    expect(created.body.workspace).toMatchObject({
      slug: "acme",
      host: "acme.example.test",
      status: "running",
      port: expect.any(Number),
    });
    const dataDir = f.workspaceDataDir("acme");
    const config = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")) as {
      signIn: { admins: string[]; members: string[] };
    };
    expect(config.signIn.admins).toEqual(["owner@acme.test"]);
    expect(config.signIn.members).toEqual(["m@acme.test"]);
    const listed = f.list();
    expect(listed.mode).toBe("local");
    expect(listed.workspaces.map((w) => w.slug)).toEqual(["acme"]);
  });

  it("lets the owner see every server they administer; invitees see only invited ones", () => {
    const f = fleet();
    expect(f.create({ slug: "alpha", admins: ["owner@x.test"] }).status).toBe(200);
    expect(f.create({ slug: "beta", admins: ["owner@x.test"], members: ["invitee@y.test"] }).status).toBe(200);
    expect(f.create({ slug: "gamma", admins: ["other@z.test"] }).status).toBe(200);
    const rows = f.memberships().workspaces;
    expect(fleetAccountWorkspaces("owner@x.test", rows, { currentId: "alpha" }).map((w) => w.id).sort()).toEqual([
      "alpha",
      "beta",
    ]);
    expect(fleetAccountWorkspaces("invitee@y.test", rows, { currentId: "alpha" }).map((w) => w.id)).toEqual(["beta"]);
    expect(fleetAccountWorkspaces("stranger@n.test", rows, { currentId: "alpha" })).toEqual([]);
  });

  it(`enforces the invite limit of ${DEFAULT_INVITE_LIMIT} (owner excluded)`, () => {
    const f = fleet();
    expect(f.create({ slug: "shop", admins: ["owner@shop.test"] }).status).toBe(200);
    for (let i = 0; i < DEFAULT_INVITE_LIMIT; i++) {
      const result = f.users({ slug: "shop", action: "add", email: `u${i}@shop.test` });
      expect(result.status).toBe(200);
    }
    const blocked = f.users({ slug: "shop", action: "add", email: "one-more@shop.test" });
    expect(blocked.status).toBe(400);
    if (!("error" in blocked.body)) throw new Error("expected error");
    expect(blocked.body.error).toMatch(/invite limit reached \(5\)/);
  });

  it(`enforces the invite limit of ${DEFAULT_INVITE_LIMIT} on create({ members }) via shared assertInviteLimitAllows`, () => {
    const f = fleet();
    const members = Array.from({ length: DEFAULT_INVITE_LIMIT + 1 }, (_, i) => `u${i}@shop.test`);
    const blocked = f.create({ slug: "shop", admins: ["owner@shop.test"], members });
    expect(blocked.status).toBe(400);
    if (!("error" in blocked.body)) throw new Error("expected error");
    expect(blocked.body.error).toMatch(/invite limit reached \(5\)/);
    expect(f.list().workspaces).toEqual([]);
    const okMembers = members.slice(0, DEFAULT_INVITE_LIMIT);
    expect(f.create({ slug: "shop", admins: ["owner@shop.test"], members: okMembers }).status).toBe(200);
  });

  it("isolates servers: writing one data dir does not appear in another", () => {
    const f = fleet();
    expect(f.create({ slug: "one", admins: ["a@one.test"] }).status).toBe(200);
    expect(f.create({ slug: "two", admins: ["a@two.test"] }).status).toBe(200);
    const oneDir = f.workspaceDataDir("one");
    const twoDir = f.workspaceDataDir("two");
    expect(oneDir).not.toBe(twoDir);
    writeFileSync(join(oneDir, "secret-one.txt"), "only-one");
    writeFileSync(join(twoDir, "secret-two.txt"), "only-two");
    expect(() => readFileSync(join(oneDir, "secret-two.txt"))).toThrow();
    expect(() => readFileSync(join(twoDir, "secret-one.txt"))).toThrow();
    const oneConfig = JSON.parse(readFileSync(join(oneDir, "config.json"), "utf8")) as {
      signIn: { admins: string[] };
    };
    const twoConfig = JSON.parse(readFileSync(join(twoDir, "config.json"), "utf8")) as {
      signIn: { admins: string[] };
    };
    expect(oneConfig.signIn.admins).toEqual(["a@one.test"]);
    expect(twoConfig.signIn.admins).toEqual(["a@two.test"]);
    const ports = f.list().workspaces.map((w) => w.port);
    expect(new Set(ports).size).toBe(2);
  });

  it("rejects a pre-planted workspaces/<slug> symlink that escapes the fleet root", () => {
    const root = tempRoot();
    const outside = mkdtempSync(join(tmpdir(), "oss-fleet-outside-"));
    dirs.push(outside);
    mkdirSync(join(root, "workspaces"), { recursive: true, mode: 0o700 });
    symlinkSync(outside, join(root, "workspaces", "evil"));
    const f = fleet(root);
    const result = f.create({ slug: "evil", admins: ["owner@evil.test"] });
    expect(result.status).toBe(400);
    if (!("error" in result.body)) throw new Error("expected error");
    expect(result.body.error).toMatch(/symbolic link|escaped/i);
    expect(existsSync(join(outside, "config.json"))).toBe(false);
    expect(existsSync(join(outside, "data"))).toBe(false);
    expect(f.list().workspaces.map((w) => w.slug)).not.toContain("evil");
  });

  it("marks fleet available in a container probe when the local root is ready", () => {
    const root = tempRoot();
    const d = diagnoseFleet({
      features: [],
      socketPath: "/run/aikingbot/fleet.sock",
      registryFile: "/etc/aikingbot/fleet.json",
      exists: () => false,
      canOpen: () => false,
      which: () => false,
      inContainer: () => true,
      localFleet: { ready: ossFleetReady(root), root },
    });
    expect(d.available).toBe(true);
    expect(d.reason).toBeUndefined();
  });
});
