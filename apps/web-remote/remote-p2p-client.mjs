/**
 * Browser viewer helpers for rc8 §9.1 P2P (slice B/C).
 * Prefer WebRTC when /__relay/api/ice returns p2p:true; keep the relay WS for fallback.
 */
export function viewerShouldPreferP2p(ice) {
  return ice?.p2p === true;
}

/**
 * Fetch ICE servers for the selected host. Returns { p2p, iceServers, turn, ... }.
 * On failure or flag-off, callers keep the Cloudflare relay path.
 */
export async function fetchIceServers(relayOrigin = "", init = {}) {
  const response = await fetch(`${relayOrigin}/__relay/api/ice`, {
    credentials: "include",
    ...init,
  });
  if (!response.ok) return { p2p: false, iceServers: [], turn: false, error: response.status };
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object") return { p2p: false, iceServers: [], turn: false };
  return body;
}

/** POST a signal frame to the host via the worker. */
export async function postSignal(frame, relayOrigin = "", init = {}) {
  const response = await fetch(`${relayOrigin}/__relay/api/signal`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    body: JSON.stringify({ t: "signal", from: "viewer", ...frame }),
    ...init,
  });
  return response.ok;
}

/**
 * Decide whether app bytes should still ride the Cloudflare proxy.
 * useRelayProxy stays true until path is p2p or turn.
 */
export function useRelayProxyForPath(path, preferP2p) {
  if (!preferP2p) return true;
  return path !== "p2p" && path !== "turn";
}
