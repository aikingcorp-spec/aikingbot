import { describe, expect, it, vi } from "vitest";
import {
  buildIceServers,
  chooseTransportPath,
  DEFAULT_STUN_SERVERS,
  HEADLESS_VPS_P2P_DECISION,
  isRemoteP2pEnabled,
  isRemoteSignalFrame,
  mintTurnRestCredential,
  parseRemoteSignalFrame,
  REMOTE_P2P_MAX_BITRATE,
  viewerShouldPreferP2p,
} from "./remote-p2p.ts";
import { RemotePeerSession } from "./remote-p2p-peer.ts";
import { RemoteTransportController } from "./remote-p2p-fallback.ts";

describe("remote-p2p protocol", () => {
  it("accepts well-formed signal frames", () => {
    expect(
      isRemoteSignalFrame({
        t: "signal",
        sid: "sess-1234",
        kind: "offer",
        from: "viewer",
        sdp: "v=0",
      }),
    ).toBe(true);
    expect(parseRemoteSignalFrame('{"t":"signal","sid":"ab","kind":"offer","from":"viewer"}')).toBeNull();
    expect(parseRemoteSignalFrame("not-json")).toBeNull();
    expect(isRemoteSignalFrame({ t: "signal", sid: "sess-1234", kind: "nope", from: "viewer" })).toBe(false);
  });

  it("mints TURN REST credentials with HMAC-SHA1", async () => {
    const minted = await mintTurnRestCredential("test-secret", "alice@example.com", 600, 1_700_000_000);
    expect(minted.username).toBe("1700000600:alice@example.com");
    expect(minted.expiresAt).toBe(1_700_000_600);
    expect(minted.credential.length).toBeGreaterThan(10);
    // Stable against known Python hmac:
    // python3 -c "import hmac,base64,hashlib; print(base64.b64encode(hmac.new(b'test-secret', b'1700000600:alice@example.com', hashlib.sha1).digest()).decode())"
    expect(minted.credential).toBe("YQ7CIid50d2yo+O4WSBACTWSh30=");
  });

  it("buildIceServers stays STUN-only without TURN env", async () => {
    const { iceServers, turn } = await buildIceServers({});
    expect(turn).toBe(false);
    expect(iceServers).toEqual(DEFAULT_STUN_SERVERS);
  });

  it("buildIceServers appends TURN when uris+secret set", async () => {
    const { iceServers, turn, expiresAt } = await buildIceServers({
      turnUris: "turn:turn.example:3478?transport=udp,turns:turn.example:5349",
      turnSecret: "s3cret",
      username: "bob",
      ttlSec: 300,
      nowSec: 1_000,
    });
    expect(turn).toBe(true);
    expect(expiresAt).toBe(1_300);
    expect(iceServers.length).toBe(DEFAULT_STUN_SERVERS.length + 1);
    const turnServer = iceServers.at(-1)!;
    expect(turnServer.urls).toEqual(["turn:turn.example:3478?transport=udp", "turns:turn.example:5349"]);
    expect(turnServer.username).toBe("1300:bob");
    expect(typeof turnServer.credential).toBe("string");
  });

  it("chooseTransportPath prefers p2p then turn then relay", () => {
    expect(chooseTransportPath({ peerConnected: true, selectedCandidateType: "host", turnConfigured: true, timedOut: false })).toBe("p2p");
    expect(chooseTransportPath({ peerConnected: true, selectedCandidateType: "relay", turnConfigured: true, timedOut: false })).toBe("turn");
    expect(chooseTransportPath({ peerConnected: false, timedOut: true, turnConfigured: false })).toBe("relay");
  });
});

describe("RemotePeerSession signaling (mock PC)", () => {
  function mockPc() {
    const handlers: Record<string, ((event: unknown) => void) | null> = {};
    const local: { sdp?: string; type?: string } = {};
    const remote: { sdp?: string; type?: string } = {};
    const channels: Array<{ label: string; readyState: string; onopen: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null; close: () => void; send: (d: unknown) => void }> = [];
    const pc = {
      connectionState: "new" as string,
      onicecandidate: null as ((e: { candidate: { toJSON: () => object } | null }) => void) | null,
      onconnectionstatechange: null as (() => void) | null,
      ondatachannel: null as ((e: { channel: (typeof channels)[0] }) => void) | null,
      createDataChannel(label: string) {
        const channel = {
          label,
          readyState: "connecting",
          onopen: null as (() => void) | null,
          onmessage: null as ((e: { data: unknown }) => void) | null,
          binaryType: "arraybuffer",
          close() {
            this.readyState = "closed";
          },
          send: vi.fn(),
        };
        channels.push(channel);
        return channel as unknown as RTCDataChannel;
      },
      offers: [] as Array<{ iceRestart?: boolean } | undefined>,
      async createOffer(opts?: { iceRestart?: boolean }) {
        this.offers.push(opts);
        return { type: "offer" as const, sdp: opts?.iceRestart ? "offer-restart-sdp" : "offer-sdp" };
      },
      async createAnswer() {
        return { type: "answer" as const, sdp: "answer-sdp" };
      },
      async setLocalDescription(desc: { type: string; sdp?: string }) {
        local.type = desc.type;
        local.sdp = desc.sdp;
      },
      async setRemoteDescription(desc: { type: string; sdp?: string }) {
        remote.type = desc.type;
        remote.sdp = desc.sdp;
      },
      async addIceCandidate() {
        /* ok */
      },
      getSenders() {
        return [] as RTCRtpSender[];
      },
      async getStats() {
        return new Map();
      },
      close() {
        this.connectionState = "closed";
      },
    };
    return { pc: pc as unknown as RTCPeerConnection & { offers: Array<{ iceRestart?: boolean } | undefined> }, channels, local, remote, handlers };
  }

  it("viewer emits offer; host answers", async () => {
    const signals: Array<{ kind: string; sdp?: string }> = [];
    const viewerMock = mockPc();
    const hostMock = mockPc();
    const viewer = new RemotePeerSession(
      { sid: "sess-abcd", role: "viewer", iceServers: [] },
      {
        sendSignal: (frame) => signals.push(frame),
        createPeerConnection: () => viewerMock.pc,
      },
    );
    const host = new RemotePeerSession(
      { sid: "sess-abcd", role: "host", iceServers: [] },
      {
        sendSignal: (frame) => signals.push(frame),
        createPeerConnection: () => hostMock.pc,
      },
    );
    await viewer.startAsViewer();
    const offer = signals.find((s) => s.kind === "offer");
    expect(offer?.sdp).toBe("offer-sdp");
    expect(viewerMock.channels.map((c) => c.label)).toEqual(["rpc", "events", "files"]);
    await host.handleSignal({ t: "signal", sid: "sess-abcd", kind: "offer", from: "viewer", sdp: "offer-sdp" });
    const answer = signals.find((s) => s.kind === "answer");
    expect(answer?.sdp).toBe("answer-sdp");
    await viewer.handleSignal({ t: "signal", sid: "sess-abcd", kind: "answer", from: "host", sdp: "answer-sdp" });
    expect(viewerMock.local.type).toBe("offer");
    expect(hostMock.local.type).toBe("answer");
    viewer.close();
    host.close();
  });

  it("on soft timeout viewer restarts ICE once, then falls back to relay", async () => {
    vi.useFakeTimers();
    const signals: Array<{ kind: string; sdp?: string; path?: string }> = [];
    const fallback = vi.fn();
    const mock = mockPc();
    let now = 1_000;
    const viewer = new RemotePeerSession(
      { sid: "sess-timeout", role: "viewer", iceServers: [], connectTimeoutMs: 100 },
      {
        sendSignal: (frame) => signals.push(frame),
        createPeerConnection: () => mock.pc,
        onFallbackToRelay: fallback,
        now: () => now,
      },
    );
    await viewer.startAsViewer();
    expect(signals.some((s) => s.kind === "offer" && s.sdp === "offer-sdp")).toBe(true);

    now = 1_200;
    await vi.advanceTimersByTimeAsync(100);
    expect(viewer.iceRestartAttempted()).toBe(true);
    expect(viewer.fellBackToRelay()).toBe(false);
    expect(signals.some((s) => s.kind === "offer" && s.sdp === "offer-restart-sdp")).toBe(true);
    expect(fallback).not.toHaveBeenCalled();

    now = 1_400;
    await vi.advanceTimersByTimeAsync(100);
    expect(viewer.fellBackToRelay()).toBe(true);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(viewer.pathLabel()).toBe("relay");
    expect(signals.some((s) => s.kind === "path" && s.path === "relay")).toBe(true);
    viewer.close();
    vi.useRealTimers();
  });

  it("host does not ICE-restart; falls back on soft timeout", async () => {
    vi.useFakeTimers();
    const fallback = vi.fn();
    const mock = mockPc();
    const host = new RemotePeerSession(
      { sid: "sess-host-to", role: "host", iceServers: [], connectTimeoutMs: 50 },
      {
        sendSignal: () => undefined,
        createPeerConnection: () => mock.pc,
        onFallbackToRelay: fallback,
      },
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(host.iceRestartAttempted()).toBe(false);
    expect(host.fellBackToRelay()).toBe(true);
    expect(fallback).toHaveBeenCalled();
    host.close();
    vi.useRealTimers();
  });
});

describe("remote-p2p feature flag + caps (slice B/C)", () => {
  it("isRemoteP2pEnabled reads AIKING_REMOTE_P2P", () => {
    expect(isRemoteP2pEnabled({ AIKING_REMOTE_P2P: "1" })).toBe(true);
    expect(isRemoteP2pEnabled({ AIKING_REMOTE_P2P: "true" })).toBe(true);
    expect(isRemoteP2pEnabled({ AIKING_REMOTE_P2P: "0" })).toBe(false);
    expect(isRemoteP2pEnabled({})).toBe(false);
  });

  it("viewerShouldPreferP2p follows ice.p2p", () => {
    expect(viewerShouldPreferP2p({ p2p: true })).toBe(true);
    expect(viewerShouldPreferP2p({ p2p: false })).toBe(false);
    expect(viewerShouldPreferP2p(null)).toBe(false);
  });

  it("documents headless VPS deferral", () => {
    expect(HEADLESS_VPS_P2P_DECISION).toContain("defer-werift");
    expect(REMOTE_P2P_MAX_BITRATE.video).toBe(1_500_000);
    expect(REMOTE_P2P_MAX_BITRATE.audio).toBe(64_000);
  });
});

describe("RemoteTransportController (slice B/C fallback)", () => {
  it("keeps useRelayProxy until peer reports p2p/turn", () => {
    const ctl = new RemoteTransportController({ preferP2p: true });
    expect(ctl.state()).toEqual({ path: "relay", useRelayProxy: true, switching: false, statusKey: "remote.p2p.onRelay" });
    ctl.notePeerPath("p2p");
    expect(ctl.state()).toEqual({ path: "p2p", useRelayProxy: false, switching: false, statusKey: "remote.p2p.onP2p" });
    ctl.forceRelay();
    expect(ctl.state()).toEqual({ path: "relay", useRelayProxy: true, switching: true, statusKey: "remote.p2p.switchingToRelay" });
    ctl.finishSwitchToRelay();
    expect(ctl.state()).toEqual({ path: "relay", useRelayProxy: true, switching: false, statusKey: "remote.p2p.onRelay" });
  });

  it("never leaves relay when preferP2p is false", () => {
    const ctl = new RemoteTransportController({ preferP2p: false });
    ctl.notePeerPath("p2p");
    expect(ctl.state().useRelayProxy).toBe(true);
    expect(ctl.state().path).toBe("relay");
  });

  it("preferP2p from ice.p2p", () => {
    const ctl = new RemoteTransportController({ ice: { p2p: true } });
    ctl.notePeerPath("turn");
    expect(ctl.state()).toEqual({ path: "turn", useRelayProxy: false, switching: false, statusKey: "remote.p2p.onTurn" });
  });

  it("queues sends during ICE→relay fallback and replays once in order with no duplicates", () => {
    const p2p: string[] = [];
    const relay: string[] = [];
    const ctl = new RemoteTransportController({ preferP2p: true });
    ctl.setSenders({
      p2p: (message) => {
        p2p.push(String(message.data));
        return true;
      },
      relay: (message) => {
        relay.push(String(message.data));
        return true;
      },
    });
    ctl.notePeerPath("p2p");
    expect(ctl.send("rpc", "m0")).toBe(true);
    expect(p2p).toEqual(["m0"]);

    // Mid-fallback sends must not be lost or double-delivered.
    ctl.beginSwitchToRelay();
    expect(ctl.state().switching).toBe(true);
    expect(ctl.state().statusKey).toBe("remote.p2p.switchingToRelay");
    expect(ctl.send("rpc", "m1")).toBe(true);
    expect(ctl.send("events", "m2")).toBe(true);
    expect(ctl.send("files", "m3")).toBe(true);
    expect(ctl.pendingCount()).toBe(3);
    expect(relay).toEqual([]);
    expect(p2p).toEqual(["m0"]);

    ctl.finishSwitchToRelay();
    expect(relay).toEqual(["m1", "m2", "m3"]);
    expect(p2p).toEqual(["m0"]);
    expect(ctl.pendingCount()).toBe(0);
    expect(ctl.state().switching).toBe(false);

    // Settled on relay: further sends go straight to relay, not re-queued.
    expect(ctl.send("rpc", "m4")).toBe(true);
    expect(relay).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("when p2p send fails mid-session, queues that message and switches", () => {
    const relay: string[] = [];
    let p2pOpen = true;
    const ctl = new RemoteTransportController({ preferP2p: true });
    ctl.setSenders({
      p2p: () => {
        if (!p2pOpen) return false;
        return true;
      },
      relay: (message) => {
        relay.push(String(message.data));
        return true;
      },
    });
    ctl.notePeerPath("p2p");
    p2pOpen = false;
    expect(ctl.send("rpc", "orphan")).toBe(true);
    expect(ctl.state().switching).toBe(true);
    expect(ctl.pendingCount()).toBe(1);
    ctl.finishSwitchToRelay();
    expect(relay).toEqual(["orphan"]);
  });
});

describe("RemotePeerSession fallback handoff queue", () => {
  it("send() after fallback queues bytes for takePendingForRelay in order", async () => {
    vi.useFakeTimers();
    const pc = {
      connectionState: "new",
      onicecandidate: null,
      onconnectionstatechange: null,
      ondatachannel: null,
      createDataChannel: () => ({ label: "rpc", readyState: "connecting", onopen: null, onmessage: null, binaryType: "arraybuffer", close() {}, send: vi.fn() }),
      createOffer: async () => ({ type: "offer", sdp: "v=0" }),
      createAnswer: async () => ({ type: "answer", sdp: "v=0" }),
      setLocalDescription: async () => undefined,
      setRemoteDescription: async () => undefined,
      addIceCandidate: async () => undefined,
      getStats: async () => new Map(),
      close: () => undefined,
      addTrack: () => ({ replaceTrack: async () => undefined, getParameters: () => ({ encodings: [] }), setParameters: async () => undefined }),
    } as unknown as RTCPeerConnection;
    const host = new RemotePeerSession(
      { sid: "sess-handoff", role: "host", iceServers: [], connectTimeoutMs: 50 },
      { sendSignal: () => undefined, createPeerConnection: () => pc },
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(host.fellBackToRelay()).toBe(true);
    expect(host.send("rpc", "a")).toBe(true);
    expect(host.send("rpc", "b")).toBe(true);
    expect(host.send("events", "c")).toBe(true);
    expect(host.pendingForRelayCount()).toBe(3);
    const drained = host.takePendingForRelay();
    expect(drained.map((entry) => entry.data)).toEqual(["a", "b", "c"]);
    expect(host.takePendingForRelay()).toEqual([]);
    host.close();
    vi.useRealTimers();
  });
});
