/**
 * One side of a remote P2P session (viewer or host).
 * Inject createPeerConnection for tests; browsers/Electron use global RTCPeerConnection.
 *
 * Slice C: one ICE restart on soft timeout, then path=relay; optional video track + bitrate caps.
 */
import {
  REMOTE_P2P_CHANNELS,
  REMOTE_P2P_MAX_BITRATE,
  type RemoteP2pBitrateCaps,
  type RemoteP2pChannel,
  type RemoteSignalFrame,
  type RemoteTransportPath,
  applySenderBitrateCaps,
  chooseTransportPath,
  P2P_CONNECT_TIMEOUT_MS,
} from "./remote-p2p.ts";

export type PeerRole = "viewer" | "host";

export type RemotePeerHooks = {
  sendSignal: (frame: Omit<RemoteSignalFrame, "t" | "from"> & { kind: RemoteSignalFrame["kind"] }) => void;
  onPath?: (path: RemoteTransportPath) => void;
  onChannel?: (name: RemoteP2pChannel, channel: RTCDataChannel) => void;
  onMessage?: (name: RemoteP2pChannel, data: string | ArrayBuffer) => void;
  /** Fired once when the session gives up on WebRTC and expects the Cloudflare relay. */
  onFallbackToRelay?: () => void;
  now?: () => number;
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
};

export type RemotePeerOptions = {
  sid: string;
  role: PeerRole;
  iceServers: RTCIceServer[];
  turnConfigured?: boolean;
  connectTimeoutMs?: number;
  /** iceTransportPolicy; "relay" forces TURN-only (tests / strict NAT). */
  iceTransportPolicy?: RTCIceTransportPolicy;
  bitrateCaps?: RemoteP2pBitrateCaps;
};

export class RemotePeerSession {
  readonly sid: string;
  readonly role: PeerRole;
  private readonly hooks: RemotePeerHooks;
  private readonly turnConfigured: boolean;
  private readonly timeoutMs: number;
  private readonly bitrateCaps: RemoteP2pBitrateCaps;
  private readonly pc: RTCPeerConnection;
  private readonly channels = new Map<RemoteP2pChannel, RTCDataChannel>();
  private path: RemoteTransportPath = "relay";
  private startedAt: number;
  private closed = false;
  private fellBack = false;
  private iceRestarted = false;
  private restarting = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private selectedCandidateType: string | null = null;
  /** Outbound accepted by send() after fallback; drained once onto the relay. */
  private pendingForRelay: Array<{ name: RemoteP2pChannel; data: string | ArrayBuffer }> = [];

  constructor(options: RemotePeerOptions, hooks: RemotePeerHooks) {
    this.sid = options.sid;
    this.role = options.role;
    this.hooks = hooks;
    this.turnConfigured = options.turnConfigured === true;
    this.timeoutMs = options.connectTimeoutMs ?? P2P_CONNECT_TIMEOUT_MS;
    this.bitrateCaps = options.bitrateCaps ?? REMOTE_P2P_MAX_BITRATE;
    this.startedAt = (hooks.now ?? Date.now)();
    const create = hooks.createPeerConnection ?? ((config) => new RTCPeerConnection(config));
    this.pc = create({
      iceServers: options.iceServers,
      iceTransportPolicy: options.iceTransportPolicy,
    });
    this.pc.onicecandidate = (event) => {
      if (this.closed || this.fellBack) return;
      this.hooks.sendSignal({
        sid: this.sid,
        kind: "ice",
        candidate: event.candidate ? event.candidate.toJSON() : null,
      });
    };
    this.pc.onconnectionstatechange = () => {
      void this.refreshSelectedCandidateType().then(() => this.recomputePath());
    };
    this.pc.ondatachannel = (event) => {
      const name = event.channel.label as RemoteP2pChannel;
      if ((REMOTE_P2P_CHANNELS as readonly string[]).includes(name)) this.bindChannel(name, event.channel);
    };
    this.timer = setTimeout(() => void this.onConnectTimeout(), this.timeoutMs);
  }

  pathLabel(): RemoteTransportPath {
    return this.path;
  }

  peer(): RTCPeerConnection {
    return this.pc;
  }

  iceRestartAttempted(): boolean {
    return this.iceRestarted;
  }

  fellBackToRelay(): boolean {
    return this.fellBack;
  }

  /** Viewer starts: create channels + offer. */
  async startAsViewer(): Promise<void> {
    for (const name of REMOTE_P2P_CHANNELS) {
      const channel = this.pc.createDataChannel(name, { ordered: true });
      this.bindChannel(name, channel);
    }
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.hooks.sendSignal({ sid: this.sid, kind: "offer", sdp: offer.sdp ?? "" });
  }

  /** Host (or viewer renegotiation): attach a screen/video track with bitrate caps. */
  async addVideoTrack(track: MediaStreamTrack, stream?: MediaStream): Promise<RTCRtpSender> {
    const sender = stream ? this.pc.addTrack(track, stream) : this.pc.addTrack(track);
    await applySenderBitrateCaps(this.pc, this.bitrateCaps);
    return sender;
  }

  async handleSignal(frame: RemoteSignalFrame): Promise<void> {
    if (frame.sid !== this.sid || this.closed || this.fellBack) return;
    if (frame.kind === "offer" && this.role === "host" && frame.sdp) {
      await this.pc.setRemoteDescription({ type: "offer", sdp: frame.sdp });
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.hooks.sendSignal({ sid: this.sid, kind: "answer", sdp: answer.sdp ?? "" });
      return;
    }
    if (frame.kind === "answer" && this.role === "viewer" && frame.sdp) {
      await this.pc.setRemoteDescription({ type: "answer", sdp: frame.sdp });
      return;
    }
    if (frame.kind === "ice" && frame.candidate) {
      try {
        await this.pc.addIceCandidate(frame.candidate);
      } catch {
        /* late/duplicate */
      }
    }
    if (frame.kind === "path" && frame.path === "relay") {
      this.fallbackToRelay("peer_path");
      return;
    }
    if (frame.kind === "bye") this.close();
  }

  channel(name: RemoteP2pChannel): RTCDataChannel | undefined {
    return this.channels.get(name);
  }

  send(name: RemoteP2pChannel, data: string | ArrayBuffer): boolean {
    if (this.closed) return false;
    if (this.fellBack) {
      // Queue for ordered relay replay — never drop in-flight bytes (Rex 9.1).
      this.pendingForRelay.push({ name, data });
      return true;
    }
    const channel = this.channels.get(name);
    if (!channel || channel.readyState !== "open") return false;
    channel.send(data as never);
    return true;
  }

  /** Bytes accepted by send() after (or during) fallback; drain once onto the relay. */
  takePendingForRelay(): Array<{ name: RemoteP2pChannel; data: string | ArrayBuffer }> {
    const pending = this.pendingForRelay.slice();
    this.pendingForRelay.length = 0;
    return pending;
  }

  pendingForRelayCount(): number {
    return this.pendingForRelay.length;
  }

  /** Tear down the PC and report path=relay so callers keep using the Cloudflare proxy. */
  fallbackToRelay(_reason = "manual"): void {
    if (this.fellBack || this.closed) return;
    this.fellBack = true;
    clearTimeout(this.timer);
    this.path = "relay";
    this.hooks.onPath?.(this.path);
    this.hooks.sendSignal({ sid: this.sid, kind: "path", path: "relay" });
    this.hooks.onFallbackToRelay?.();
    for (const channel of this.channels.values()) {
      try { channel.close(); } catch { /* closed */ }
    }
    try { this.pc.close(); } catch { /* closed */ }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    for (const channel of this.channels.values()) {
      try { channel.close(); } catch { /* closed */ }
    }
    try { this.pc.close(); } catch { /* closed */ }
    if (!this.fellBack) {
      this.path = "relay";
      this.hooks.onPath?.(this.path);
    }
  }

  private bindChannel(name: RemoteP2pChannel, channel: RTCDataChannel): void {
    this.channels.set(name, channel);
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      this.hooks.onChannel?.(name, channel);
      this.recomputePath();
    };
    channel.onmessage = (event) => this.hooks.onMessage?.(name, event.data as string | ArrayBuffer);
  }

  private async onConnectTimeout(): Promise<void> {
    if (this.closed || this.fellBack) return;
    const peerConnected =
      this.pc.connectionState === "connected" ||
      [...this.channels.values()].some((channel) => channel.readyState === "open");
    if (peerConnected) {
      this.recomputePath();
      return;
    }
    // Soft timeout: one ICE restart (viewer renegotiates), then relay fallback.
    if (!this.iceRestarted && this.role === "viewer" && !this.restarting) {
      this.iceRestarted = true;
      this.restarting = true;
      this.startedAt = (this.hooks.now ?? Date.now)();
      try {
        const offer = await this.pc.createOffer({ iceRestart: true });
        await this.pc.setLocalDescription(offer);
        this.hooks.sendSignal({ sid: this.sid, kind: "offer", sdp: offer.sdp ?? "" });
        this.timer = setTimeout(() => void this.onConnectTimeout(), this.timeoutMs);
      } catch {
        this.fallbackToRelay("ice_restart_failed");
      } finally {
        this.restarting = false;
      }
      return;
    }
    this.fallbackToRelay("connect_timeout");
  }

  private async refreshSelectedCandidateType(): Promise<void> {
    try {
      const stats = await this.pc.getStats();
      for (const report of stats.values()) {
        if (report.type === "candidate-pair" && (report as { state?: string }).state === "succeeded") {
          const localId = (report as { localCandidateId?: string }).localCandidateId;
          if (!localId) continue;
          const local = stats.get(localId) as { candidateType?: string } | undefined;
          if (local?.candidateType) {
            this.selectedCandidateType = local.candidateType;
            return;
          }
        }
      }
    } catch {
      /* getStats optional */
    }
  }

  private recomputePath(timedOut = false): void {
    if (this.closed || this.fellBack) return;
    const peerConnected =
      this.pc.connectionState === "connected" ||
      [...this.channels.values()].some((channel) => channel.readyState === "open");
    const expired = timedOut || (this.hooks.now ?? Date.now)() - this.startedAt >= this.timeoutMs;
    if (expired && !peerConnected) {
      void this.onConnectTimeout();
      return;
    }
    const next = chooseTransportPath({
      peerConnected,
      selectedCandidateType: this.selectedCandidateType,
      turnConfigured: this.turnConfigured,
      timedOut: false,
    });
    if (next !== this.path) {
      this.path = next;
      this.hooks.onPath?.(next);
      if (peerConnected) {
        this.hooks.sendSignal({ sid: this.sid, kind: "path", path: next });
      }
    }
    if (peerConnected) clearTimeout(this.timer);
  }
}
