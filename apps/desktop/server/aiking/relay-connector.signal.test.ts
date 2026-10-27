import { describe, expect, it, vi } from "vitest";
import { startRelayConnector } from "./relay-connector.ts";

class FakeSocket {
  readyState = 1;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("relay-connector signal hook", () => {
  it("forwards signal frames to onSignal and sendSignal stamps from=host", async () => {
    const sockets: FakeSocket[] = [];
    function FakeWS() {
      const socket = new FakeSocket();
      sockets.push(socket);
      Promise.resolve().then(() => {
        socket.onopen?.();
      });
      return socket;
    }

    const onSignal = vi.fn();
    const connector = startRelayConnector({
      relayUrl: "https://relay.example",
      hostId: "hostid123456",
      token: "tok",
      target: { host: "127.0.0.1", port: 9 },
      webSocket: FakeWS as unknown as typeof WebSocket,
      onSignal,
      pingMs: 60_000,
      silenceMs: 120_000,
    });

    await vi.waitFor(() => expect(sockets.length).toBe(1));
    const socket = sockets[0]!;
    socket.onmessage?.({
      data: JSON.stringify({ t: "signal", sid: "sess-xyz1", kind: "offer", from: "viewer", sdp: "v=0" }),
    });
    expect(onSignal).toHaveBeenCalledOnce();
    expect(onSignal.mock.calls[0]![0]).toMatchObject({ t: "signal", kind: "offer", sid: "sess-xyz1" });

    connector.sendSignal({ sid: "sess-xyz1", kind: "answer", sdp: "v=0" });
    const last = JSON.parse(socket.sent.at(-1)!);
    expect(last).toMatchObject({ t: "signal", from: "host", kind: "answer", sid: "sess-xyz1" });
    connector.stop();
  });
});
