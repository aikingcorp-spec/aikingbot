/**
 * WebRTC P2P remote protocol helpers (rc8 §9.1).
 * Signaling frames, ICE server lists, and TURN REST (HMAC) credentials.
 * No paid TURN: public STUN + optional self-hosted coturn via AIKING_TURN_*.
 */

export const REMOTE_P2P_CHANNELS = ["rpc", "events", "files"] as const;
export type RemoteP2pChannel = (typeof REMOTE_P2P_CHANNELS)[number];

export type RemoteTransportPath = "p2p" | "turn" | "relay";

export type SignalKind = "hello" | "offer" | "answer" | "ice" | "bye" | "path";

/** Frame carried on the host WebSocket / owner signal channel (JSON). */
export type RemoteSignalFrame = {
  t: "signal";
  /** Session correlation id for this P2P attempt. */
  sid: string;
  kind: SignalKind;
  /** Viewer or host. */
  from: "viewer" | "host";
  sdp?: string;
  candidate?: RTCIceCandidateInit | null;
  /** Negotiated or reported transport. */
  path?: RemoteTransportPath;
  /** Feature / version handshake. */
  v?: number;
};

export type IceServersConfig = {
  /** Comma-separated turn:/turns: URIs. Empty → STUN only. */
  turnUris?: string;
  turnSecret?: string;
  /** Username subject (usually account uid or email). */
  username?: string;
  ttlSec?: number;
  /** Injected clock for tests. */
  nowSec?: number;
};

export const DEFAULT_STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export const DEFAULT_TURN_TTL_SEC = 600;

const SIGNAL_KINDS = new Set<SignalKind>(["hello", "offer", "answer", "ice", "bye", "path"]);

export function isRemoteSignalFrame(value: unknown): value is RemoteSignalFrame {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const frame = value as Record<string, unknown>;
  if (frame.t !== "signal") return false;
  if (typeof frame.sid !== "string" || frame.sid.length < 4 || frame.sid.length > 128) return false;
  if (typeof frame.kind !== "string" || !SIGNAL_KINDS.has(frame.kind as SignalKind)) return false;
  if (frame.from !== "viewer" && frame.from !== "host") return false;
  if (frame.sdp !== undefined && typeof frame.sdp !== "string") return false;
  if (frame.path !== undefined && frame.path !== "p2p" && frame.path !== "turn" && frame.path !== "relay") return false;
  return true;
}

export function parseRemoteSignalFrame(raw: string): RemoteSignalFrame | null {
  try {
    const value = JSON.parse(raw) as unknown;
    return isRemoteSignalFrame(value) ? value : null;
  } catch {
    return null;
  }
}

/** coturn TURN REST: username = `${expiry}:${user}`, credential = base64(hmac-sha1(secret, username)). */
export async function mintTurnRestCredential(
  secret: string,
  username: string,
  ttlSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<{ username: string; credential: string; expiresAt: number }> {
  const safeUser = username.trim().replace(/[^A-Za-z0-9_@.-]/g, "").slice(0, 120) || "anon";
  const expiresAt = nowSec + Math.max(60, Math.min(ttlSec, 86_400));
  const turnUser = `${expiresAt}:${safeUser}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(turnUser));
  const credential = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return { username: turnUser, credential, expiresAt };
}

export async function buildIceServers(config: IceServersConfig = {}): Promise<{ iceServers: RTCIceServer[]; turn: boolean; expiresAt?: number }> {
  const iceServers: RTCIceServer[] = [...DEFAULT_STUN_SERVERS];
  const uris = (config.turnUris ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  const secret = config.turnSecret?.trim();
  if (!uris.length || !secret) return { iceServers, turn: false };
  const minted = await mintTurnRestCredential(secret, config.username ?? "viewer", config.ttlSec ?? DEFAULT_TURN_TTL_SEC, config.nowSec);
  iceServers.push({ urls: uris, username: minted.username, credential: minted.credential });
  return { iceServers, turn: true, expiresAt: minted.expiresAt };
}

/** Soft timeout before falling back to the Cloudflare relay. */
export const P2P_CONNECT_TIMEOUT_MS = 12_000;

export function chooseTransportPath(input: {
  peerConnected: boolean;
  selectedCandidateType?: string | null;
  turnConfigured: boolean;
  timedOut: boolean;
}): RemoteTransportPath {
  if (!input.peerConnected || input.timedOut) return "relay";
  if (input.selectedCandidateType === "relay") return "turn";
  return "p2p";
}

/** Feature flag (host + worker). Default off so relay stays the path until proven. */
export function isRemoteP2pEnabled(env: Record<string, string | undefined> | NodeJS.ProcessEnv = process.env): boolean {
  const value = env.AIKING_REMOTE_P2P;
  return value === "1" || value === "true";
}

/** Soft bitrate caps for screen/video + optional audio (slice C). */
export const REMOTE_P2P_MAX_BITRATE = {
  video: 1_500_000,
  audio: 64_000,
} as const;

export type RemoteP2pBitrateCaps = { video?: number; audio?: number };

/** Apply maxBitrate on every sender encoding. No-op when the PC has no senders. */
export async function applySenderBitrateCaps(
  pc: RTCPeerConnection,
  caps: RemoteP2pBitrateCaps = REMOTE_P2P_MAX_BITRATE,
): Promise<void> {
  for (const sender of pc.getSenders()) {
    const kind = sender.track?.kind;
    if (kind !== "video" && kind !== "audio") continue;
    const maxBitrate = kind === "video" ? caps.video : caps.audio;
    if (maxBitrate === undefined) continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      for (const encoding of params.encodings) encoding.maxBitrate = maxBitrate;
      await sender.setParameters(params);
    } catch {
      /* setParameters unsupported or negotiation mid-flight */
    }
  }
}

/**
 * Headless VPS path decision (slice C): first wave keeps Electron hidden BrowserWindow only.
 * Pure Node (werift / node-datachannel + capture) is deferred — no Electron on a typical VPS,
 * and screen capture there is a separate spike. Until then, VPS hosts stay on the Cloudflare
 * WebSocket relay (AIKING_REMOTE_P2P may still mint ICE for viewers pairing to an Electron host).
 */
export const HEADLESS_VPS_P2P_DECISION =
  "defer-werift: Electron hidden window first; headless VPS remains on relay until a later spike";

/**
 * Viewer-side preference: when the worker ICE payload says p2p:true, try WebRTC first and keep
 * the existing relay WebSocket as the fallback transport for RPC/events/files bytes.
 */
export function viewerShouldPreferP2p(ice: { p2p?: boolean } | null | undefined): boolean {
  return ice?.p2p === true;
}
