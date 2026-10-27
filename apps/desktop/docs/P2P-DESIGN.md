# 9.1 WebRTC P2P remote — design note (Leo / rc8)

Built on the remote P2P research and the rc8 spec (§9.1).
Branch target: `codex/leo-rc8-w2`. No fleet-routing changes. No paid TURN.

## Goals

- From the signed-in web app (app.aikingxbot.com / relay), control a paired computer (desktop, Mac mini, or VPS) over **direct WebRTC** whenever the network allows.
- **Stop burning Cloudflare quota** on chat, RPC, files, and screen bytes once P2P is up.
- Cloudflare keeps only: **sign-in, pairing/enrolment, and WebRTC signaling** (SDP + ICE).
- Ordered fallback: **direct (host candidates / STUN) → self-hosted TURN → existing Cloudflare WebSocket relay** (size-capped).
- Reconnect + ICE restart when the peer drops.

## Non-goals (this wave)

- Moving fleet routes into OSS / changing 9.2 licensing.
- Item 2.4 (credential catalog).
- Paying for a commercial TURN (Twilio, Xirsys, Cloudflare Calls, etc.).
- Full headless VPS screen-capture stack in the first slice (Electron hidden window first; headless `werift`/`node-datachannel` later if needed).

## Signaling path

```
Browser (viewer)                     Cloudflare Worker + Host DO              Host computer
     |  HTTP/WS session cookie                |                                      |
     |  POST /__relay/api/ice  -------------> |  (auth) returns STUN (+ TURN REST)   |
     |  signal frames (SDP/ICE) ------------> |  Host DO forwards on host WS -------> |  relay-connector
     |  <------------------------------------ |  <----------------------------------- |  answers / ICE
     |                                        |                                      |
     |========= RTCPeerConnection DataChannels + optional video =====================|
     |   channels: rpc | events | files   (binary frames; same semantic as relay)    |
```

- Reuse the **existing host WebSocket** (`/__relay/connect`) already authenticated with the host bearer token.
- New frame type on that socket (and a matching browser→DO path): `t: "signal"` with `{ role, kind: "offer"|"answer"|"ice"|"bye", sdp?, candidate?, mid? }`.
- The Host DO only **forwards** signal frames; it never interprets SDP. Bytes stay tiny (KB/session).
- Browser reaches the DO either via:
  - `POST /__relay/api/signal` (session cookie + selected host), which enqueues onto the host WS, or
  - a short-lived upgrade path later; first slice uses the POST/poll or host-pushed `signal` mirrored to an owner-only side channel.

First-slice choice: **host WS carries signal both ways**; browser uses `POST /__relay/api/signal` for outbound and receives inbound signal on a small owner WebSocket `GET /__relay/api/signal/ws` (session + host cookie). That keeps signaling off the heavy proxy path.

## STUN / TURN (no paid service)

| Role | Source | Notes |
|------|--------|--------|
| STUN | Public (`stun:stun.l.google.com:19302` and one backup) | Free; for NAT binding discovery |
| TURN | **Self-hosted coturn** on the operator VPS (already present as staging turn container on srv1866690) | UDP 3478 + TLS 443 fallback |
| Creds | **TURN REST (HMAC-SHA1)** time-limited username `expiry:uid`, password = Base64(HMAC(secret, username)) | Issued only after relay session auth; TTL ~5–15 min |
| Config | Worker / desktop env: `AIKING_TURN_SECRET`, `AIKING_TURN_URIS` (comma-separated), optional `AIKING_TURN_TTL_SEC` | Secret never sent to clients; never logged |

If `AIKING_TURN_SECRET` / URIs are unset, ICE servers are STUN-only; TURN path is skipped and the session falls through to the **relay fallback** sooner. That is intentional for local/dev.

## Auth and pairing

Unchanged enrolment:

1. Email OTP via account service → session cookie `rl_session`.
2. Pair computer with one-time code or account-bearer enrol → host id + host token.
3. Host opens `/__relay/connect` with `Authorization: Bearer <host-token>`.

P2P adds:

- ICE credentials only for a **valid session** that owns the selected host.
- Signal frames only host↔owner of that host (same `x-relay-owner` / token checks as proxy).
- DataChannel application traffic still hits the **local loopback server** on the host (same trust model as today’s relay replay); the peer does not widen the attack surface beyond “owner already paired”.

## Fallback to current relay

Transport preference (host + viewer agree via signal hello):

1. `p2p` — RTCPeerConnection connected (`connected`/`completed`), prefer host/srflx.
2. `turn` — same PC but selected candidate pair is relay.
3. `relay` — tear down PC (or never start); keep today’s base64 JSON WebSocket proxy.

Rules:

- Soft timeout (~8–12 s) from offer without `connectionState=connected` → try ICE restart once → then **relay**.
- Relay remains the default until P2P is proven for that session (feature flag `AIKING_REMOTE_P2P=1` on host + worker).
- Cap relay body sizes as today (`MAX_BODY_BYTES`); optional stricter free-tier cap later.

## Host WebRTC runtime

| Host kind | Stack |
|-----------|--------|
| Electron desktop | Hidden `BrowserWindow` (Chromium `RTCPeerConnection`), same as OpenBot |
| Browser-only viewer | Native `RTCPeerConnection` |
| Headless VPS (no Electron) | Later: `werift` or `node-datachannel` + screen capture; **out of first slice** |

## Files to touch

| Area | Path | Role |
|------|------|------|
| Shared protocol | `apps/desktop/shared/remote-p2p.ts` | Frames, ICE builder, TURN REST, caps, VPS decision |
| Peer session | `apps/desktop/shared/remote-p2p-peer.ts` | Offer/answer/ICE, ICE restart once, relay fallback, video track |
| Fallback | `apps/desktop/shared/remote-p2p-fallback.ts` | Prefer-P2P controller; useRelayProxy until path=p2p/turn |
| Tests | `apps/desktop/shared/remote-p2p.test.ts`, `remote-p2p-peer.chrome.mjs` | Unit + Electron two-peer (not headless Chrome) |
| Worker | `apps/web-remote/worker.mjs` | `/api/ice`, signal forward |
| Viewer helper | `apps/web-remote/remote-p2p-client.mjs` | fetchIceServers, prefer-P2P, proxy decision |
| Host connector | `apps/desktop/server/aiking/relay-connector.ts` | Dispatch `signal` frames; hook peer |
| Relay bridge | `apps/desktop/server/aiking/relay.ts` | `/api/aiking/remote/p2p/{status,inbox,outbox,path}` |
| Electron host | `apps/desktop/electron/remote-p2p-host.mjs` + thin `main.mjs` wire | Hidden window when `AIKING_REMOTE_P2P=1` |

## Overlap with Kai (`kai-files.txt`)

- **Avoid:** fleet, catalog, harness, marketplace, most of `server/index.ts` / `config.ts`.
- **Minimal if needed:** `electron/main.mjs` (one import to start hidden P2P host), `server/index.ts` only if a local `/api/remote/p2p-status` is required for the desktop UI.
- **Safe / Leo-owned:** `apps/web-remote/*`, `shared/remote-p2p*.ts`, `server/aiking/relay-connector.ts` (not listed in kai-files).

## Acceptance tests

1. **Unit:** TURN REST username/password round-trip with a fixed secret; ICE list is STUN-only without secret; signal frame parse rejects garbage.
2. **Chrome two-peer (real WebRTC):** one process, two `RTCPeerConnection`s, DataChannel `rpc` ping/pong within 5 s (host candidates / loopback — proves stack).
3. **Signaling (lab):** Miniflare worker — owner posts offer, host connector receives `signal` frame; answer returns to owner socket (extend `relay.lab-test.mjs`).
4. **Fallback (later slice):** force `iceTransportPolicy: "relay"` with no TURN → session selects `relay` and HTTP proxy still works.
5. **Manual:** paired desktop + phone/browser on different NATs; chat bytes do not inflate CF Worker request body once path=`p2p`.

## Implementation slices

| Slice | Deliverable |
|-------|-------------|
| **A** | Design note; shared protocol + TURN REST; peer session helper; Electron two-peer harness (headless Chrome lacks UDP host candidates — see evidence-9.1); worker ICE + signal forward; connector signal hook |
| **B (done)** | Electron hidden host (`remote-p2p-host.mjs`); thin `main.mjs` wire; viewer prefer-P2P helper; relay inbox/outbox/status bridge; fallback controller |
| **C (done)** | `addVideoTrack` + bitrate caps; soft timeout → ICE restart once → relay; `HEADLESS_VPS_P2P_DECISION` = defer werift (VPS stays on relay) |

## Risks

- Symmetric NATs without TURN → always relay (must keep relay).
- Coturn misconfig / missing TLS 443 → mobile networks fail P2P.
- Headless VPS without Electron is a **large** spike (spec risk).
- Signaling bugs can strand sessions; always keep relay reachable.
