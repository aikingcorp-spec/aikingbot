// Why team servers cannot be created on this host, as one named reason plus the command that fixes it.
// Read-only: it looks at files, PATH and the edition; it never runs a fleet step.
// Open-source builds use a local/container fleet (per-server data dirs); no licence is required.
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fleetLayout } from "./fleet.ts";
import { ossFleetReady, ossFleetRoot } from "./oss-fleet.ts";

export type FleetBlocker = "no-entitlement" | "container" | "not-initialized" | "no-agent" | "socket-denied" | "missing-tools";

export interface FleetCheck { id: string; ok: boolean; detail: string; fix?: string }

export interface FleetDiagnosis {
  available: boolean;
  /** The first failing check, in the order an operator must fix them. */
  reason?: FleetBlocker;
  fix?: string;
  checks: FleetCheck[];
}

export interface FleetProbe {
  features: readonly string[];
  socketPath: string;
  registryFile: string;
  exists(path: string): boolean;
  /** Whether this process may connect to the socket (read+write). */
  canOpen(path: string): boolean;
  which(command: string): boolean;
  inContainer(): boolean;
  /** Open-source local fleet root; when ready, no host socket/tools are required. */
  localFleet?: { ready: boolean; root: string };
}

/** Host tools the host-isolation fleet plan runs (fleet.ts): useradd, systemctl, nft, caddy. */
export const FLEET_TOOLS = ["systemctl", "useradd", "nft", "caddy"] as const;

export function diagnoseFleet(probe: FleetProbe): FleetDiagnosis {
  const checks: FleetCheck[] = [];
  const entitled = probe.features.includes("admin");
  // Entitlement is never a blocker: OSS ships its own local/container fleet.
  checks.push(entitled
    ? { id: "entitlement", ok: true, detail: "enterprise layer loaded with the admin feature" }
    : { id: "entitlement", ok: true, detail: "open-source fleet: no licence required" });

  const socket = probe.exists(probe.socketPath);
  const registry = probe.exists(probe.registryFile);
  const localReady = probe.localFleet?.ready === true;
  const localRoot = probe.localFleet?.root;

  if (socket) {
    const open = probe.canOpen(probe.socketPath);
    checks.push(open
      ? { id: "agent", ok: true, detail: `fleet agent socket ${probe.socketPath}` }
      : { id: "agent", ok: false, detail: `this server's user may not open ${probe.socketPath}`, fix: "re-run `aikingbot fleet init --domain … --operator <this server's Unix user> --yes` as root on the host" });
  } else if (localReady) {
    checks.push({
      id: "agent",
      ok: true,
      detail: `open-source local fleet at ${localRoot} (per-server data directory; no systemd)`,
    });
  } else if (probe.inContainer()) {
    checks.push({
      id: "agent",
      ok: false,
      detail: "this server runs inside a container with no local fleet root and no host fleet socket",
      fix: "set AIKING_FLEET_ROOT to a writable directory inside the container (per-server data dirs), or run `aikingbot fleet init --domain … --operator <user>` as root on the VPS host and mount its socket (AIKING_FLEET_SOCKET)",
    });
  } else if (!registry) {
    checks.push({
      id: "agent",
      ok: false,
      detail: "no fleet on this host yet (no fleet.json) and local fleet root is not writable",
      fix: "set AIKING_FLEET_ROOT (or AIKING_DATA_DIR) to a writable path, or run `aikingbot fleet init --domain your.domain --operator <user>` as root for host isolation",
    });
  } else {
    checks.push({ id: "agent", ok: false, detail: `the fleet is set up but its agent is not running (${probe.socketPath} missing)`, fix: "run `systemctl enable --now aikingbot-fleet.service` as root" });
  }

  const missing = FLEET_TOOLS.filter((tool) => !probe.which(tool));
  if (socket || localReady) {
    // Host tools are advisory once a usable fleet path exists (socket or local).
    checks.push(missing.length
      ? {
          id: "tools",
          ok: true,
          detail: `host tools not required for ${localReady && !socket ? "local" : "socket"} fleet; missing for host isolation: ${missing.join(", ")}`,
          fix: `for true host isolation (systemd units, Unix users, Caddy, nft fence): install ${missing.join(", ")} as root on the host, then run \`aikingbot fleet init\``,
        }
      : { id: "tools", ok: true, detail: `found ${FLEET_TOOLS.join(", ")}` });
  } else {
    checks.push(missing.length
      ? { id: "tools", ok: false, detail: `missing on this host: ${missing.join(", ")}`, fix: `install ${missing.join(", ")} on the host that runs the fleet agent` }
      : { id: "tools", ok: true, detail: `found ${FLEET_TOOLS.join(", ")}` });
  }

  const reason: FleetBlocker | undefined = socket
    ? (probe.canOpen(probe.socketPath) ? undefined : "socket-denied")
    : localReady ? undefined
      : probe.inContainer() ? "container"
        : !registry ? "not-initialized"
          : "no-agent";
  // The agent / local fleet runs without host tools, so tool checks only block when neither path works.
  const blocking = reason ?? (!socket && !localReady && missing.length ? "missing-tools" : undefined);
  const first = checks.find((check) => !check.ok);
  return blocking ? { available: false, reason: blocking, ...(first?.fix ? { fix: first.fix } : {}), checks } : { available: true, checks };
}

function onPath(command: string, env: NodeJS.ProcessEnv): boolean {
  return (env.PATH ?? "").split(delimiter).filter(Boolean).some((dir) => {
    try { accessSync(join(dir, command), constants.X_OK); return true; } catch { return false; }
  });
}

function containerized(): boolean {
  if (existsSync("/.dockerenv") || existsSync("/run/.containerenv")) return true;
  try { return /docker|containerd|kubepods|libpod/.test(readFileSync("/proc/1/cgroup", "utf8")); } catch { return false; }
}

export function hostFleetProbe(features: readonly string[], socketPath: string, env: NodeJS.ProcessEnv = process.env): FleetProbe {
  const root = ossFleetRoot(env);
  return {
    features, socketPath, registryFile: fleetLayout().registryFile,
    exists: existsSync,
    canOpen: (path) => { try { accessSync(path, constants.R_OK | constants.W_OK); return true; } catch { return false; } },
    which: (command) => onPath(command, env),
    inContainer: containerized,
    localFleet: { ready: ossFleetReady(root), root },
  };
}

export function formatFleetDiagnosis(diagnosis: FleetDiagnosis): string[] {
  const lines = diagnosis.checks.map((check) => `${check.ok ? "ok  " : "FAIL"} ${check.id.padEnd(12)} ${check.detail}${check.ok || !check.fix ? "" : `\n     fix: ${check.fix}`}`);
  lines.push(diagnosis.available ? "team servers can be created on this host" : `team servers cannot be created here: ${diagnosis.reason}`);
  return lines;
}
