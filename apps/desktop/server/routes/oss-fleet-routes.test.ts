import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { json, readBody } from "../harness/http.ts";
import { DEFAULT_INVITE_LIMIT } from "../invite-limit.ts";
import { resetSharedOssFleet } from "../oss-fleet.ts";
import { createStatusRoutes } from "./status.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
  resetSharedOssFleet();
  delete process.env.AIKING_FLEET_ROOT;
  delete process.env.AIKING_FLEET_SOCKET;
  delete process.env.AIKING_FLEET_SPAWN;
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function serve(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "oss-fleet-route-"));
  dirs.push(root);
  process.env.AIKING_FLEET_ROOT = root;
  // Ensure no host socket is picked up.
  process.env.AIKING_FLEET_SOCKET = join(root, "no-such-fleet.sock");
  resetSharedOssFleet();
  const routes = [createStatusRoutes({
    store: { bot: () => null, bots: [], tasks: () => [], groupByThread: () => undefined },
    cfg: {} as never,
    outboundCounts: { today: () => 0 },
    staticDir: null,
    sharedWorkspaceFullAccessEnabled: () => false,
    adminActivityRecording: () => false,
    configStatus: () => ({}) as never,
    broadcast: () => {},
    browserEngineInstall: { get: () => null, set: () => {} },
    browserEngineInstallError: { set: () => {} },
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      const handled = await dispatchRoutes(routes, {
        req, res, url, path: url.pathname, method: req.method ?? "GET",
        auth: { kind: "loopback", scopes: ["admin"] }, json, readBody,
      });
      if (!handled) json(res, 404, { from: "inline routes" });
    } catch (error) {
      json(res, 500, { error: String(error) });
    }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function api(base: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe("open-source fleet routes (container-like, no licence, no systemd)", () => {
  it("lists, creates, invites (limit 5), and isolates servers without an entitlement", async () => {
    const base = await serve();
    const empty = await api(base, "GET", "/api/fleet");
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ mode: "local", workspaces: [] });

    const created = await api(base, "POST", "/api/fleet/workspaces", {
      slug: "acme",
      admins: ["owner@acme.test"],
    });
    expect(created.status).toBe(200);
    expect((created.body as { workspace: { slug: string } }).workspace.slug).toBe("acme");

    const other = await api(base, "POST", "/api/fleet/workspaces", {
      slug: "globex",
      admins: ["owner@globex.test"],
    });
    expect(other.status).toBe(200);

    const listed = await api(base, "GET", "/api/fleet");
    const workspaces = (listed.body as { workspaces: Array<{ slug: string; port: number }> }).workspaces;
    expect(workspaces.map((w) => w.slug).sort()).toEqual(["acme", "globex"]);
    expect(new Set(workspaces.map((w) => w.port)).size).toBe(2);

    const root = process.env.AIKING_FLEET_ROOT!;
    writeFileSync(join(root, "workspaces", "acme", "data", "only-acme.txt"), "a");
    writeFileSync(join(root, "workspaces", "globex", "data", "only-globex.txt"), "g");
    expect(readFileSync(join(root, "workspaces", "acme", "data", "config.json"), "utf8")).toContain("owner@acme.test");
    expect(readFileSync(join(root, "workspaces", "globex", "data", "config.json"), "utf8")).toContain("owner@globex.test");
    expect(() => readFileSync(join(root, "workspaces", "acme", "data", "only-globex.txt"))).toThrow();

    for (let i = 0; i < DEFAULT_INVITE_LIMIT; i++) {
      const invite = await api(base, "POST", "/api/fleet/workspaces/acme/users", {
        action: "add",
        email: `u${i}@acme.test`,
      });
      expect(invite.status).toBe(200);
    }
    const blocked = await api(base, "POST", "/api/fleet/workspaces/acme/users", {
      action: "add",
      email: "overflow@acme.test",
    });
    expect(blocked.status).toBe(400);
    expect(String(blocked.body.error)).toMatch(/invite limit reached \(5\)/);

    const ownerSees = JSON.parse(readFileSync(join(root, "workspaces", "acme", "data", "config.json"), "utf8")) as {
      signIn: { admins: string[]; members: string[] };
    };
    // Default invites are full-access admins (not chat-only members); owner is excluded from the limit.
    expect(ownerSees.signIn.admins[0]).toBe("owner@acme.test");
    expect(ownerSees.signIn.admins).toHaveLength(1 + DEFAULT_INVITE_LIMIT);
    expect(ownerSees.signIn.members).toHaveLength(0);
  });
});
