/**
 * Local-only mode for AIKINGBOT.
 *
 * The code inherited from OpenBot reaches a family of hosted services: the account API, Signal,
 * hosted sites, the marketplace, product analytics and the invitation pages. AIKINGBOT does not run
 * any of them yet, and their origins (`*.aikingbot.aikingx.com`, `*.aikingbot-sites.aikingx.com`)
 * are placeholders for a future AIKING-managed deployment. Until it exists, every request to one of
 * those origins fails at once with `HostedServiceDisabledError` instead of leaving the process to
 * resolve a name that has no server behind it. Local agents, chats, skills, tools and storage never
 * use these origins and keep working.
 *
 * A self-hosted account API set through `AIKINGBOT_AUTH_API_URL` is not one of these origins and is
 * never blocked. `AIKINGBOT_HOSTED_SERVICES=1` lifts the guard once the hosted services are live.
 */

import type { CentralAuthUser } from "@aikingbot/contracts/ipc";
import { app, type Session, session } from "electron";

/** The registrable hosts of the AIKING hosted services, each also covering its subdomains. */
export const HOSTED_SERVICE_HOSTS = ["aikingbot.aikingx.com", "aikingbot-sites.aikingx.com"] as const;

export class HostedServiceDisabledError extends Error {
  constructor(readonly url: string) {
    super(
      `AIKINGBOT runs in local-only mode, so it does not contact the hosted service at ${new URL(url).origin}. Set AIKINGBOT_HOSTED_SERVICES=1 once that service is deployed.`,
    );
    this.name = "HostedServiceDisabledError";
  }
}

export function hostedServicesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AIKINGBOT_HOSTED_SERVICES === "1";
}

/**
 * Local-only mode: no hosted services and no self-hosted account API. The app then signs in as
 * `LOCAL_ACCOUNT` without a network round trip, and the features that need an account service
 * (cloud sign-in, teams, remote pairing, hosted servers and sites) stay unavailable.
 */
export function localOnlyMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return !hostedServicesEnabled(env) && !env.AIKINGBOT_AUTH_API_URL?.trim();
}

/** The one user of a local-only app. The ID is a fixed version 4 UUID, as account IDs are. */
export const LOCAL_ACCOUNT: CentralAuthUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "local@aikingbot.localhost",
  name: "Local user",
  avatarUrl: null,
};

export function isHostedServiceUrl(value: string | URL): boolean {
  let hostname: string;
  try {
    hostname = (typeof value === "string" ? new URL(value) : value).hostname.toLowerCase();
  } catch {
    return false;
  }
  return HOSTED_SERVICE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Wraps a `fetch` so that it rejects every request to a hosted service without sending it. */
export function guardFetch(fetchImpl: typeof fetch): typeof fetch {
  const guarded = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = requestUrl(input);
    if (isHostedServiceUrl(url)) return Promise.reject(new HostedServiceDisabledError(url));
    return fetchImpl(input, init);
  };
  return Object.assign(guarded, fetchImpl);
}

/** The `webRequest` URL patterns of every hosted origin, for HTTP and for WebSocket. */
export function hostedServiceUrlPatterns(): string[] {
  return HOSTED_SERVICE_HOSTS.flatMap((host) =>
    ["http", "https", "ws", "wss"].flatMap((scheme) => [`${scheme}://${host}/*`, `${scheme}://*.${host}/*`]),
  );
}

function guardSession(target: Session): void {
  target.webRequest.onBeforeRequest({ urls: hostedServiceUrlPatterns() }, (_details, callback) =>
    callback({ cancel: true }),
  );
}

/**
 * Installs the guard on the main process `fetch` and on every Electron session: the default one,
 * which covers the renderer and `net`, and each partition created later, such as the agent browser
 * and previews. A WebSocket from the main process only ever opens to a Signal address that the
 * account service hands out, so with no account service it has nothing to connect to. Call it inside
 * `app.whenReady()`, before any service starts.
 */
export function installHostedServiceGuard(env: NodeJS.ProcessEnv = process.env): boolean {
  if (hostedServicesEnabled(env)) return false;
  globalThis.fetch = guardFetch(globalThis.fetch);
  guardSession(session.defaultSession);
  app.on("session-created", guardSession);
  return true;
}
