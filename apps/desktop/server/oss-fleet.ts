// Open-source local/container fleet: create, list, and invite team servers with
// no licence, no systemd, no Caddy, and no Unix useradd. Isolation is a
// per-server data directory (and optional child process + port inside the same
// container). Clean-room against the WorkspacesSection / fleet-client API
// shapes; does not import or bypass the enterprise layer.
import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { signInFromConfigText } from "./aiking/fleet-account-workspaces.ts";
import { writeFileAtomic } from "./atomic.ts";
import {
  allocatePort,
  applySignIn,
  assertEmailOrDomain,
  assertInviteLimitAllows,
  assertSlug,
  emptyRegistry,
  FLEET_FIRST_PORT,
  initialConfig,
  parseRegistry,
  type FleetRegistry,
  type FleetWorkspace,
} from "./fleet.ts";
import { SERVER_ROOT } from "./proxy-paths.ts";

export interface OssFleetWorkspaceView extends FleetWorkspace {
  live: string;
  usage: { month: string; turns: number | null; costUsd: number | null; billableUsd: number | null; unavailable?: boolean };
}

export interface OssFleetList {
  domain: string;
  operator: string | null;
  mode: "local";
  root: string;
  workspaces: OssFleetWorkspaceView[];
}

export interface OssFleetMembershipRow {
  slug: string;
  host: string;
  status: string;
  signIn: { admins: string[]; members: string[] };
}

export interface OssFleetOptions {
  root: string;
  domain?: string;
  /** When true, spawn a child `aikingbot serve` per workspace (same container, own port + data dir). */
  spawnChildren?: boolean;
  nodePath?: string;
  scriptPath?: string;
  now?: () => Date;
}

export interface OssFleet {
  root: string;
  domain: string;
  list(): OssFleetList;
  memberships(): { domain: string; workspaces: OssFleetMembershipRow[] };
  create(input: {
    slug: string;
    admins: string[];
    members?: string[];
    cap?: number;
    anthropicKey?: string;
    anthropicUrl?: string;
  }): { status: number; body: { log: string[]; workspace: OssFleetWorkspaceView } | { error: string } };
  users(input: {
    slug: string;
    action: "add" | "remove";
    email: string;
    chatOnly?: boolean;
  }): { status: number; body: { log: string[] } | { error: string } };
  suspend(slug: string): { status: number; body: { log: string[] } | { error: string } };
  resume(slug: string): { status: number; body: { log: string[] } | { error: string } };
  remove(slug: string, keepData: boolean): { status: number; body: { log: string[] } | { error: string } };
  upgrade(): { status: number; body: { log: string[] } };
  workspaceDataDir(slug: string): string;
  stopAll(): void;
}

/** Directory that holds fleet.json and per-server data dirs. */
export function ossFleetRoot(env: NodeJS.ProcessEnv = process.env, dataDir?: string): string {
  const fromEnv = env.AIKING_FLEET_ROOT?.trim();
  if (fromEnv) return fromEnv;
  const data = dataDir?.trim() || env.AIKING_DATA_DIR?.trim() || join(homedir(), ".aikingbot");
  return join(data, "fleet");
}

export function ossFleetDomain(env: NodeJS.ProcessEnv = process.env, fallback = "local"): string {
  const named = env.AIKING_FLEET_DOMAIN?.trim().toLowerCase();
  if (named) return named;
  const publicUrl = env.AIKING_PUBLIC_URL?.trim();
  if (publicUrl) {
    try {
      const host = new URL(publicUrl).hostname.toLowerCase();
      if (host && host !== "localhost" && host !== "127.0.0.1") return host;
    } catch {
      // ignore malformed public URL
    }
  }
  return fallback;
}

/** True when this process can create the local fleet root (container-friendly). */
export function ossFleetReady(root: string): boolean {
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    accessSync(root, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}


function assertNotSymlink(path: string, label: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function containedIn(rootReal: string, candidateReal: string): boolean {
  const prefix = rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`;
  return candidateReal === rootReal || candidateReal.startsWith(prefix);
}

/** Refuse symlink escape: lstat + realpath containment before mkdir/write; O_NOFOLLOW on existing files. */
function ensureSafeWorkspaceDataDir(root: string, slug: string): string {
  const rootReal = realpathSync(root);
  const workspaces = join(root, "workspaces");
  mkdirSync(workspaces, { recursive: true, mode: 0o700 });
  assertNotSymlink(workspaces, "fleet workspaces directory");
  const workspacesReal = realpathSync(workspaces);
  if (!containedIn(rootReal, workspacesReal) || workspacesReal !== join(rootReal, "workspaces")) {
    throw new Error("fleet workspaces directory escaped the fleet root");
  }
  const slugDir = join(workspaces, slug);
  assertNotSymlink(slugDir, `workspace "${slug}" path`);
  mkdirSync(slugDir, { recursive: true, mode: 0o700 });
  assertNotSymlink(slugDir, `workspace "${slug}" path`);
  const slugReal = realpathSync(slugDir);
  const expectedSlug = join(workspacesReal, slug);
  if (slugReal !== expectedSlug) throw new Error(`workspace "${slug}" path escaped the fleet root`);
  const dataDir = join(slugDir, "data");
  assertNotSymlink(dataDir, `workspace "${slug}" data path`);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  assertNotSymlink(dataDir, `workspace "${slug}" data path`);
  const dataReal = realpathSync(dataDir);
  if (dataReal !== join(expectedSlug, "data")) throw new Error(`workspace "${slug}" data path escaped the fleet root`);
  return dataDir;
}

function writeWorkspaceConfig(root: string, slug: string, content: string): void {
  const dataDir = ensureSafeWorkspaceDataDir(root, slug);
  const configPath = join(dataDir, "config.json");
  assertNotSymlink(configPath, `workspace "${slug}" config`);
  if (existsSync(configPath) && process.platform !== "win32") {
    let fd: number | undefined;
    try {
      fd = openSync(configPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  writeFileAtomic(configPath, content, { mode: 0o600, durable: false });
}

function workspaceDir(root: string, slug: string): string {
  return join(root, "workspaces", slug);
}

function registryPath(root: string): string {
  return join(root, "fleet.json");
}

function emptyUsage(now: Date): OssFleetWorkspaceView["usage"] {
  return {
    month: now.toISOString().slice(0, 7),
    turns: 0,
    costUsd: null,
    billableUsd: null,
    unavailable: true,
  };
}

function normalizeEmails(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
}

export function createOssFleet(options: OssFleetOptions): OssFleet {
  const root = options.root;
  const domain = (options.domain ?? "local").toLowerCase();
  const spawnChildren = options.spawnChildren === true;
  const nodePath = options.nodePath ?? process.execPath;
  const scriptPath = options.scriptPath ?? join(SERVER_ROOT, "aikingbot.ts");
  const now = options.now ?? (() => new Date());
  const children = new Map<string, ChildProcess>();

  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(join(root, "workspaces"), { recursive: true, mode: 0o700 });

  const load = (): FleetRegistry => {
    const path = registryPath(root);
    if (!existsSync(path)) {
      const registry = emptyRegistry(domain);
      writeFileAtomic(path, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600, durable: false });
      return registry;
    }
    const registry = parseRegistry(readFileSync(path, "utf8"));
    if (!registry.domain) registry.domain = domain;
    return registry;
  };

  const save = (registry: FleetRegistry): void => {
    writeFileAtomic(registryPath(root), `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600, durable: false });
  };

  const viewOf = (workspace: FleetWorkspace): OssFleetWorkspaceView => {
    const child = children.get(workspace.slug);
    const live = workspace.status === "running"
      ? (child && child.exitCode === null && !child.killed ? "active" : spawnChildren ? "inactive" : "local")
      : workspace.status;
    return { ...workspace, live, usage: emptyUsage(now()) };
  };

  const stopChild = (slug: string): void => {
    const child = children.get(slug);
    if (!child) return;
    children.delete(slug);
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  };

  const startChild = (workspace: FleetWorkspace): void => {
    if (!spawnChildren) return;
    stopChild(workspace.slug);
    const dataDir = ensureSafeWorkspaceDataDir(root, workspace.slug);
    const args = scriptPath.endsWith(".ts")
      ? ["--experimental-strip-types", scriptPath, "serve", "--port", String(workspace.port), "--data-dir", dataDir, "--no-pair"]
      : [scriptPath, "serve", "--port", String(workspace.port), "--data-dir", dataDir, "--no-pair"];
    const child = spawn(nodePath, args, {
      stdio: "ignore",
      env: {
        ...process.env,
        AIKING_DATA_DIR: dataDir,
        AIKING_PORT: String(workspace.port),
        AIKING_PUBLIC_URL: `http://127.0.0.1:${workspace.port}`,
        // Never pass a licence into tenant children from the OSS fleet path.
        AIKING_LICENSE_KEY: "",
      },
      detached: false,
    });
    child.on("exit", () => {
      if (children.get(workspace.slug) === child) children.delete(workspace.slug);
    });
    children.set(workspace.slug, child);
  };

  return {
    root,
    domain,
    workspaceDataDir: (slug) => ensureSafeWorkspaceDataDir(root, slug),
    stopAll: () => {
      for (const slug of children.keys()) stopChild(slug);
    },
    list: () => {
      const registry = load();
      const workspaces = Object.values(registry.workspaces)
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map(viewOf);
      return { domain: registry.domain, operator: registry.operator ?? null, mode: "local", root, workspaces };
    },
    memberships: () => {
      const registry = load();
      const workspaces: OssFleetMembershipRow[] = [];
      for (const workspace of Object.values(registry.workspaces).sort((a, b) => a.slug.localeCompare(b.slug))) {
        let signIn = { admins: [] as string[], members: [] as string[] };
        try {
          const dataDir = ensureSafeWorkspaceDataDir(root, workspace.slug);
          const configPath = join(dataDir, "config.json");
          assertNotSymlink(configPath, `workspace "${workspace.slug}" config`);
          if (existsSync(configPath)) {
            if (process.platform !== "win32") {
              let fd: number | undefined;
              try {
                fd = openSync(configPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                signIn = signInFromConfigText(readFileSync(fd).toString("utf8"));
              } finally {
                if (fd !== undefined) closeSync(fd);
              }
            } else {
              signIn = signInFromConfigText(readFileSync(configPath, "utf8"));
            }
          }
        } catch {
          signIn = { admins: [], members: [] };
        }
        workspaces.push({ slug: workspace.slug, host: workspace.host, status: workspace.status, signIn });
      }
      return { domain: registry.domain, workspaces };
    },
    create: (input) => {
      try {
        assertSlug(input.slug);
        const admins = normalizeEmails(input.admins);
        const members = normalizeEmails(input.members ?? []);
        if (!admins.length) return { status: 400, body: { error: "admins must include at least one email" } };
        for (const entry of [...admins, ...members]) assertEmailOrDomain(entry);
        // Same seat accounting as users-add / People config PUT (owner excluded; default limit 5).
        assertInviteLimitAllows({ admins: [], members: [] }, { admins, members });
        const registry = load();
        if (registry.workspaces[input.slug]) {
          return { status: 409, body: { error: `workspace "${input.slug}" already exists` } };
        }
        const { port, next } = allocatePort(registry);
        const workspace: FleetWorkspace = {
          slug: input.slug,
          host: `${input.slug}.${registry.domain}`,
          port,
          webhookPort: port + 1,
          status: "running",
          createdAt: now().toISOString(),
        };
        const dataDir = ensureSafeWorkspaceDataDir(root, input.slug);
        const config = initialConfig({
          admins,
          members,
          ...(input.anthropicKey ? { anthropicKey: input.anthropicKey } : {}),
          ...(input.anthropicUrl ? { anthropicUrl: input.anthropicUrl } : {}),
          ...(input.cap !== undefined ? { monthlyCapUsd: input.cap } : {}),
        });
        writeWorkspaceConfig(root, input.slug, config);
        registry.workspaces[input.slug] = workspace;
        registry.nextPort = next;
        save(registry);
        startChild(workspace);
        const log = [
          `created local workspace ${input.slug} at ${dataDir}`,
          `port ${workspace.port} (isolation: per-server data directory${spawnChildren ? " + child process" : ""})`,
          `admins: ${admins.join(", ")}`,
        ];
        return { status: 200, body: { log, workspace: viewOf(workspace) } };
      } catch (error) {
        return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
      }
    },
    users: (input) => {
      try {
        assertSlug(input.slug);
        const registry = load();
        const workspace = registry.workspaces[input.slug];
        if (!workspace) return { status: 404, body: { error: `no workspace "${input.slug}"` } };
        const dataDir = ensureSafeWorkspaceDataDir(root, input.slug);
        const configPath = join(dataDir, "config.json");
        assertNotSymlink(configPath, `workspace "${input.slug}" config`);
        const previous = existsSync(configPath) ? readFileSync(configPath, "utf8") : "{}";
        const { config, summary } = applySignIn(previous, input.action, input.email, input.chatOnly === true);
        writeWorkspaceConfig(root, input.slug, config);
        return { status: 200, body: { log: [summary] } };
      } catch (error) {
        return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
      }
    },
    suspend: (slug) => {
      try {
        assertSlug(slug);
        const registry = load();
        const workspace = registry.workspaces[slug];
        if (!workspace) return { status: 404, body: { error: `no workspace "${slug}"` } };
        if (workspace.status === "suspended") return { status: 200, body: { log: [`${slug} already suspended`] } };
        stopChild(slug);
        workspace.status = "suspended";
        save(registry);
        return { status: 200, body: { log: [`suspended ${slug}`] } };
      } catch (error) {
        return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
      }
    },
    resume: (slug) => {
      try {
        assertSlug(slug);
        const registry = load();
        const workspace = registry.workspaces[slug];
        if (!workspace) return { status: 404, body: { error: `no workspace "${slug}"` } };
        workspace.status = "running";
        save(registry);
        startChild(workspace);
        return { status: 200, body: { log: [`resumed ${slug}`] } };
      } catch (error) {
        return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
      }
    },
    remove: (slug, keepData) => {
      try {
        assertSlug(slug);
        const registry = load();
        if (!registry.workspaces[slug]) return { status: 404, body: { error: `no workspace "${slug}"` } };
        stopChild(slug);
        delete registry.workspaces[slug];
        save(registry);
        if (!keepData) {
          rmSync(workspaceDir(root, slug), { recursive: true, force: true });
        }
        return { status: 200, body: { log: [`deleted ${slug}${keepData ? " (data kept)" : ""}`] } };
      } catch (error) {
        return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
      }
    },
    upgrade: () => ({
      status: 200,
      body: {
        log: [
          "local fleet has no separate package upgrade step; restart this server (or its container) on the release you want every workspace to share",
        ],
      },
    }),
  };
}

/** Shared singleton for the running server process (lazy). */
let shared: OssFleet | null = null;

export function sharedOssFleet(env: NodeJS.ProcessEnv = process.env, dataDir?: string): OssFleet | null {
  const root = ossFleetRoot(env, dataDir);
  if (!ossFleetReady(root)) return null;
  if (shared && shared.root === root) return shared;
  shared?.stopAll();
  shared = createOssFleet({
    root,
    domain: ossFleetDomain(env),
    spawnChildren: env.AIKING_FLEET_SPAWN === "1",
  });
  return shared;
}

/** Test helper: drop the process singleton. */
export function resetSharedOssFleet(): void {
  shared?.stopAll();
  shared = null;
}

/** Unused port helper kept for callers that want FLEET_FIRST_PORT without importing fleet.ts. */
export const OSS_FLEET_FIRST_PORT = FLEET_FIRST_PORT;
