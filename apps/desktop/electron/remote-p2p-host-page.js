/**
 * Renderer page for the hidden remote-P2P host. Talks only via window.aikingRemoteP2p.
 */
(function () {
  const api = window.aikingRemoteP2p;
  if (!api) {
    console.error("aikingRemoteP2p bridge missing");
    return;
  }

  const CHANNELS = ["rpc", "events", "files"];
  let pc = null;
  let sid = "desktop-host";
  const pending = [];
  const channels = new Map();

  function sendSignal(frame) {
    api.sendOutbox({ t: "signal", from: "host", sid, ...frame });
  }

  function bindChannel(name, channel) {
    channels.set(name, channel);
    channel.binaryType = "arraybuffer";
    channel.onopen = () => api.sendLog("channel:" + name);
  }

  async function handleSignal(frame) {
    if (!pc || !frame || (frame.sid && frame.sid !== sid)) return;
    if (frame.kind === "offer" && frame.sdp) {
      await pc.setRemoteDescription({ type: "offer", sdp: frame.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ kind: "answer", sdp: answer.sdp || "" });
      return;
    }
    if (frame.kind === "ice" && frame.candidate) {
      try { await pc.addIceCandidate(frame.candidate); } catch { /* late */ }
    }
    if (frame.kind === "path" && frame.path === "relay") {
      api.sendPath("relay", true);
      try { pc.close(); } catch { /* */ }
      pc = null;
    }
    if (frame.kind === "bye") {
      try { pc.close(); } catch { /* */ }
      pc = null;
    }
  }

  api.onInbox(async (frame) => {
    if (!pc) { pending.push(frame); return; }
    try { await handleSignal(frame); }
    catch (err) { api.sendLog(String(err && err.message || err)); }
  });

  api.onStart(async (opts) => {
    try {
      if (pc) { try { pc.close(); } catch { /* */ } pc = null; }
      api.sendPath("relay", false);
      sid = (opts && opts.sid) || "desktop-host";
      pc = new RTCPeerConnection({
        iceServers: (opts && opts.iceServers) || [{ urls: "stun:stun.cloudflare.com:3478" }],
      });
      pc.onicecandidate = (event) => {
        sendSignal({ kind: "ice", candidate: event.candidate ? event.candidate.toJSON() : null });
      };
      pc.onconnectionstatechange = () => {
        if (!pc) return;
        if (pc.connectionState === "connected") api.sendPath("p2p");
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          api.sendPath("relay", true);
        }
      };
      pc.ondatachannel = (event) => {
        const name = event.channel.label;
        if (CHANNELS.includes(name)) bindChannel(name, event.channel);
      };
      for (const frame of pending.splice(0, pending.length)) {
        try { await handleSignal(frame); } catch { /* ignore */ }
      }
      api.sendLog("host-ready");
    } catch (err) {
      api.sendLog("start-failed:" + String(err && err.message || err));
    }
  });

  api.onStop(() => {
    try { if (pc) pc.close(); } catch { /* */ }
    pc = null;
    channels.clear();
  });

  api.sendLog("renderer-boot");
})();
