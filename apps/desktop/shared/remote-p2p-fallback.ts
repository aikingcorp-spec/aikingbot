/**
 * End-to-end transport preference (rc8 §9.1 slice C).
 * Prefer P2P while the peer is up; after ICE restart exhaustion fall back to the
 * existing Cloudflare WebSocket relay for RPC/events/files bytes.
 *
 * During ICE→relay handoff, outbound messages are queued and replayed once in
 * order over the relay so send() never drops in-flight data (Rex 9.1 FAIL).
 */
import type { RemoteP2pChannel, RemoteTransportPath } from "./remote-p2p.ts";
import { isRemoteP2pEnabled, viewerShouldPreferP2p } from "./remote-p2p.ts";

export type OutboundMessage = {
  channel: RemoteP2pChannel;
  data: string | ArrayBuffer;
};

export type RelayProxyHooks = {
  /** True while the legacy relay WebSocket / HTTP proxy should carry app bytes. */
  useRelayProxy: boolean;
  path: RemoteTransportPath;
  /** True while ICE→relay handoff is draining the outbound queue. */
  switching: boolean;
  /**
   * i18n key for a short user-visible status.
   * VI for switching: "Đang chuyển sang relay" (remote.p2p.switchingToRelay).
   */
  statusKey:
    | "remote.p2p.onP2p"
    | "remote.p2p.onTurn"
    | "remote.p2p.onRelay"
    | "remote.p2p.switchingToRelay";
};

export type TransportSenders = {
  /** Return true when the DataChannel accepted the bytes. */
  p2p?: (message: OutboundMessage) => boolean;
  /** Return true when the Cloudflare relay accepted the bytes. */
  relay?: (message: OutboundMessage) => boolean;
};

export function statusKeyForTransport(
  path: RemoteTransportPath,
  switching: boolean,
): RelayProxyHooks["statusKey"] {
  if (switching) return "remote.p2p.switchingToRelay";
  if (path === "p2p") return "remote.p2p.onP2p";
  if (path === "turn") return "remote.p2p.onTurn";
  return "remote.p2p.onRelay";
}

export class RemoteTransportController {
  private path: RemoteTransportPath = "relay";
  private preferP2p: boolean;
  private switching = false;
  private queue: OutboundMessage[] = [];
  private senders: TransportSenders = {};
  private listeners = new Set<(state: RelayProxyHooks) => void>();

  constructor(options: { preferP2p?: boolean; ice?: { p2p?: boolean } | null } = {}) {
    this.preferP2p =
      options.preferP2p === true ||
      (options.ice !== undefined && viewerShouldPreferP2p(options.ice)) ||
      isRemoteP2pEnabled();
    // Until a peer reports connected, bytes stay on the relay.
    this.path = "relay";
  }

  /** Wire the live send paths. Call again when a sender is replaced. */
  setSenders(senders: TransportSenders): void {
    this.senders = senders;
  }

  state(): RelayProxyHooks {
    return {
      path: this.path,
      useRelayProxy: this.path === "relay" || !this.preferP2p || this.switching,
      switching: this.switching,
      statusKey: statusKeyForTransport(this.path, this.switching),
    };
  }

  /** Queued outbound count (tests / status). */
  pendingCount(): number {
    return this.queue.length;
  }

  onChange(listener: (state: RelayProxyHooks) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Send app bytes on the active path. During ICE→relay switching, messages are
   * queued and later replayed once over the relay (order preserved, no dups of
   * bytes already accepted by P2P).
   */
  send(channel: RemoteP2pChannel, data: string | ArrayBuffer): boolean {
    const message: OutboundMessage = { channel, data };
    if (this.switching) {
      this.queue.push(message);
      return true;
    }
    if (this.preferP2p && this.path !== "relay" && this.senders.p2p) {
      const ok = this.senders.p2p(message);
      if (ok) return true;
      // DC refused mid-session — begin handoff and keep the message.
      this.beginSwitchToRelay();
      this.queue.push(message);
      return true;
    }
    if (this.senders.relay) return this.senders.relay(message);
    // No relay sender yet: queue so a later finishSwitch still delivers.
    this.queue.push(message);
    return true;
  }

  /** Called when RemotePeerSession reports a path (p2p | turn | relay). */
  notePeerPath(path: RemoteTransportPath): void {
    if (!this.preferP2p) {
      this.setPath("relay");
      return;
    }
    if (path === "relay" && this.path !== "relay") {
      this.beginSwitchToRelay();
      return;
    }
    if (this.switching && path !== "relay") return;
    this.setPath(path);
  }

  /** Explicit fallback (timeout / bye / flag off) — start handoff. */
  forceRelay(): void {
    this.beginSwitchToRelay();
  }

  /**
   * Enter switching: UI shows "Đang chuyển sang relay" / "Switching to relay…".
   * Subsequent send() calls queue until finishSwitchToRelay().
   */
  beginSwitchToRelay(): void {
    if (this.switching && this.path === "relay") return;
    this.switching = true;
    this.path = "relay";
    this.emit();
  }

  /**
   * Flush the outbound queue once over the relay, in order. Messages that
   * already succeeded on P2P were never queued, so they are not duplicated.
   */
  finishSwitchToRelay(): void {
    const pending = this.queue.splice(0, this.queue.length);
    this.switching = false;
    this.path = "relay";
    for (const message of pending) {
      this.senders.relay?.(message);
    }
    this.emit();
  }

  private setPath(path: RemoteTransportPath): void {
    if (path === this.path && !this.switching) return;
    this.path = path;
    if (path !== "relay") this.switching = false;
    this.emit();
  }

  private emit(): void {
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }
}
