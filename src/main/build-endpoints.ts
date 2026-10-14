/**
 * Account API and Signal endpoints chosen at build time. A packaged build made with
 * `AIKINGBOT_BUILD_AUTH_API_URL` (and optionally `AIKINGBOT_BUILD_REMOTE_SIGNAL_URL`) signs in to that
 * account service instead of running local-only. Values already in the environment win, so a
 * user can still point one install elsewhere.
 *
 * The main entry point imports this module first, so the values are in place before any other
 * module reads them, and child processes inherit them.
 */

declare const __AIKINGBOT_BUILD_AUTH_API_URL__: string;
declare const __AIKINGBOT_BUILD_REMOTE_SIGNAL_URL__: string;

export function applyBuildEndpoints(env: NodeJS.ProcessEnv, authApiUrl: string, remoteSignalUrl: string): void {
  if (authApiUrl && !env.AIKINGBOT_AUTH_API_URL?.trim()) env.AIKINGBOT_AUTH_API_URL = authApiUrl;
  if (remoteSignalUrl && !env.AIKINGBOT_REMOTE_SIGNAL_URL?.trim()) env.AIKINGBOT_REMOTE_SIGNAL_URL = remoteSignalUrl;
}

applyBuildEndpoints(process.env, __AIKINGBOT_BUILD_AUTH_API_URL__, __AIKINGBOT_BUILD_REMOTE_SIGNAL_URL__);
