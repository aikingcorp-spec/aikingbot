// One request over the fleet agent's Unix socket; the socket's permissions are the whole authorisation.
import { existsSync } from "node:fs";
import { request } from "node:http";

export interface FleetReply {
  status: number;
  body: unknown;
}

export function fleetSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.AIKING_FLEET_SOCKET?.trim() || "/run/aikingbot/fleet.sock";
}

export function fleetAvailable(socketPath = fleetSocketPath()): boolean {
  return existsSync(socketPath);
}

export function fleetRequest(socketPath: string, method: string, path: string, body?: unknown, timeoutMs = 15 * 60_000): Promise<FleetReply> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      { socketPath, method, path, headers: { "content-type": "application/json", ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}) }, timeout: timeoutMs },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { if (text.length < 1_000_000) text += chunk; });
        res.on("end", () => {
          let parsed: unknown = null;
          try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { error: "the fleet agent answered something that was not JSON" }; }
          resolve({ status: res.statusCode ?? 502, body: parsed });
        });
      },
    );
    req.on("timeout", () => { req.destroy(new Error("the fleet agent did not answer in time")); });
    req.on("error", (error: NodeJS.ErrnoException) => {
      reject(new Error(error.code === "ENOENT" || error.code === "ECONNREFUSED"
        ? "no fleet agent on this server: run `aikingbot fleet init --domain … --operator <this user>` as root"
        : error.code === "EACCES"
          ? "this workspace's user may not open the fleet socket: re-run `aikingbot fleet init` with --operator set to it"
          : `fleet agent: ${error.message}`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

export interface FleetMembershipRow {
  slug: string;
  host: string;
  status: string;
  signIn: { admins: string[]; members: string[] };
}

/** Read-only membership snapshot from the fleet agent (host only). */
export async function fleetMemberships(socketPath = fleetSocketPath()): Promise<{ domain: string; workspaces: FleetMembershipRow[] }> {
  const reply = await fleetRequest(socketPath, "GET", "/workspaces/memberships", undefined, 15_000);
  if (reply.status !== 200 || !reply.body || typeof reply.body !== "object") {
    throw new Error(typeof (reply.body as { error?: string })?.error === "string"
      ? (reply.body as { error: string }).error
      : "fleet agent could not list workspace memberships");
  }
  const body = reply.body as { domain?: unknown; workspaces?: unknown };
  const workspaces = Array.isArray(body.workspaces) ? body.workspaces : [];
  return {
    domain: typeof body.domain === "string" ? body.domain : "",
    workspaces: workspaces.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const r = row as Record<string, unknown>;
      if (typeof r.slug !== "string" || typeof r.host !== "string") return [];
      const signIn = r.signIn && typeof r.signIn === "object" ? r.signIn as { admins?: unknown; members?: unknown } : {};
      const list = (value: unknown) => (Array.isArray(value) ? value.map((item) => String(item).trim().toLowerCase()).filter(Boolean) : []);
      return [{
        slug: r.slug,
        host: r.host,
        status: typeof r.status === "string" ? r.status : "running",
        signIn: { admins: list(signIn.admins), members: list(signIn.members) },
      }];
    }),
  };
}
