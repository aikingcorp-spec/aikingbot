// Copyright (c) 2026 AIKING.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnergyVad, Pcm16Framer, WebAudioCapture, type VoiceCapture, type VoicePlayback } from "./audio";
import type { AudioFrame, VoiceTransport, VoiceTransportEvents } from "./contract";
import { VoiceSession } from "./session";
import { decodePcm, encodePcm, PipelineVoiceTransport, voiceSocketUrl, WebSocketVoiceTransport } from "./transports";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const frame = (value: number): AudioFrame => ({ pcm: new Int16Array(320).fill(value), sampleRate: 16000, at: 0 });

function fixture(open = true) {
  let input!: (frame: AudioFrame) => void;
  let lost!: () => void;
  const capture: VoiceCapture = { start: vi.fn(async (_device, cb, loss) => { input = cb; lost = loss; }), mute: vi.fn(), stop: vi.fn() };
  const playback: VoicePlayback = { prepare: vi.fn(async () => {}), enqueue: vi.fn(), drain: vi.fn(async () => {}), interrupt: vi.fn(), close: vi.fn() };
  const transports: Array<VoiceTransport & { events: VoiceTransportEvents; options: { resumeToken?: string } }> = [];
  const session = new VoiceSession(() => {
    const transport = { id: "fixture", events: {} as VoiceTransportEvents, options: {}, connect: vi.fn(async (events, options) => { transport.events = events; transport.options = options; if (open) events.onOpen({ resumeToken: "resume-1" }); else throw new Error("offline"); }), sendAudio: vi.fn(), endOfUtterance: vi.fn(), interrupt: vi.fn(), close: vi.fn() };
    transports.push(transport); return transport;
  }, capture, playback);
  return { session, capture, playback, transports, speak: () => { for (let i = 0; i < 5; i++) input(frame(2000)); }, quiet: () => { for (let i = 0; i < 30; i++) input(frame(0)); }, lost: () => lost() };
}

describe("PCM16 capture and VAD", () => {
  it.each([16000, 44100, 48000])("keeps 20 ms frame boundaries over worklet blocks at %i Hz", (rate) => {
    const frames: Int16Array[] = [];
    const framer = new Pcm16Framer(rate, (pcm) => frames.push(pcm));
    const input = new Float32Array(rate).fill(0.5);
    for (let offset = 0; offset < input.length; offset += 128) framer.push(input.subarray(offset, offset + 128));
    expect(frames).toHaveLength(50);
    expect(frames.every((pcm) => pcm.length === 320 && pcm.every((value) => Math.abs(value - 16384) <= 1))).toBe(true);
  });
  it("ignores isolated noise and ends speech after 600 ms of silence", () => {
    const vad = new EnergyVad();
    expect(vad.push(frame(2000).pcm).started).toBe(false);
    vad.push(frame(0).pcm);
    for (let i = 0; i < 2; i++) expect(vad.push(frame(2000).pcm).started).toBe(false);
    expect(vad.push(frame(2000).pcm).started).toBe(true);
    for (let i = 0; i < 29; i++) expect(vad.push(frame(0).pcm).ended).toBe(false);
    expect(vad.push(frame(0).pcm).ended).toBe(true);
  });
  it("stops a microphone granted after hangup without opening an audio graph", async () => {
    const stop = vi.fn();
    let grant!: (stream: unknown) => void;
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise((resolve) => { grant = resolve; }) } });
    vi.stubGlobal("AudioContext", vi.fn());
    const capture = new WebAudioCapture();
    const pending = capture.start("", vi.fn(), vi.fn());
    capture.stop(); grant({ getTracks: () => [{ stop }] }); await pending;
    expect(stop).toHaveBeenCalledOnce();
    expect(AudioContext).not.toHaveBeenCalled();
  });
});

describe("VoiceSession lifecycle", () => {
  it("sends pre-roll, endpoints speech, plays at server rate and returns to listening", async () => {
    const f = fixture(); await f.session.start({ botId: "a", threadId: "t", microphone: "mic", speaker: "sink" });
    expect(f.capture.start).toHaveBeenCalledWith("mic", expect.any(Function), expect.any(Function));
    expect(f.playback.prepare).toHaveBeenCalledWith("sink");
    f.speak(); expect(f.transports[0].sendAudio).toHaveBeenCalledTimes(5);
    f.quiet(); expect(f.transports[0].endOfUtterance).toHaveBeenCalledOnce();
    const events = f.transports[0].events;
    events.onTranscript({ role: "agent", text: "hel", final: false });
    events.onTranscript({ role: "agent", text: "hello", final: true });
    expect(f.session.getSnapshot().transcripts).toHaveLength(1);
    events.onAgentAudio({ pcm: new Int16Array(2400), sampleRate: 24000 });
    expect(f.session.getSnapshot().status.phase).toBe("agent-speaking");
    events.onAgentAudioEnd(); await Promise.resolve();
    expect(f.session.getSnapshot().status.phase).toBe("listening");
    f.session.finish(); expect(f.capture.stop).toHaveBeenCalledOnce();
  });
  it("barge-in cancels a queued reply and ignores its draining callback", async () => {
    const f = fixture(); await f.session.start({ botId: "a", threadId: "t" });
    let drained!: () => void;
    vi.mocked(f.playback.drain).mockImplementation(() => new Promise((resolve) => { drained = resolve; }));
    f.transports[0].events.onAgentAudio({ pcm: frame(100).pcm, sampleRate: 16000 });
    f.transports[0].events.onAgentAudioEnd(); f.speak(); drained(); await Promise.resolve();
    expect(f.transports[0].interrupt).toHaveBeenCalledOnce();
    expect(f.playback.interrupt).toHaveBeenCalledOnce();
    expect(f.session.getSnapshot().status.phase).toBe("user-speaking");
    f.session.finish();
  });
  it("mute stops input and resets the VAD boundary", async () => {
    const f = fixture(); await f.session.start({ botId: "a", threadId: "t" });
    f.session.mute(true); f.speak(); expect(f.transports[0].sendAudio).not.toHaveBeenCalled();
    f.session.mute(false); f.speak(); expect(f.transports[0].sendAudio).toHaveBeenCalledTimes(5);
    f.session.finish();
  });
  it("reconnects with the resume token and ignores stale callbacks without replaying audio", async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.start({ botId: "a", threadId: "t" });
    f.speak(); const old = f.transports[0]; old.events.onClose({ expected: false });
    old.events.onError({ code: "provider-unavailable", message: "stale", retryable: false });
    expect(f.session.getSnapshot().status.phase).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(500);
    expect(f.transports[1].options.resumeToken).toBe("resume-1");
    expect(f.transports[1].sendAudio).not.toHaveBeenCalled();
    expect(f.session.getSnapshot().status.phase).toBe("listening");
    f.session.finish(); old.events.onAgentThinking(); expect(f.session.getSnapshot().status.phase).toBe("ended");
  });
  it("stops after exactly three retries, and hangup cancels a pending retry", async () => {
    vi.useFakeTimers(); const f = fixture(false); await f.session.start({ botId: "a", threadId: "t" });
    await vi.advanceTimersByTimeAsync(3500);
    expect(f.transports).toHaveLength(4);
    expect(f.session.getSnapshot().status).toMatchObject({ phase: "error", error: { code: "transport-failed" } });
    const g = fixture(false); await g.session.start({ botId: "a", threadId: "t" });
    g.session.finish(); await vi.advanceTimersByTimeAsync(5000); expect(g.transports).toHaveLength(1);
  });
  it("releases audio on device loss and on remote hangup", async () => {
    const f = fixture(); await f.session.start({ botId: "a", threadId: "t" }); f.lost();
    expect(f.session.getSnapshot().status).toMatchObject({ phase: "error", error: { code: "device-lost" } });
    expect(f.playback.close).toHaveBeenCalledOnce();
    const g = fixture(); await g.session.start({ botId: "a", threadId: "t" }); g.transports[0].events.onClose({ expected: true });
    expect(g.session.getSnapshot().status).toEqual({ phase: "ended", reason: "remote" });
  });
  it("classifies denied permission and missing speakers without connecting a transport", async () => {
    const f = fixture(); vi.mocked(f.capture.start).mockRejectedValue(new DOMException("Microphone denied", "NotAllowedError"));
    await f.session.start({ botId: "a", threadId: "t" });
    expect(f.session.getSnapshot().status).toMatchObject({ phase: "error", error: { code: "permission-denied" } });
    expect(f.transports).toHaveLength(0); expect(f.playback.close).toHaveBeenCalledOnce();
    const g = fixture(); vi.mocked(g.playback.prepare).mockRejectedValue(new DOMException("Missing sink private-device-id", "NotFoundError"));
    await g.session.start({ botId: "a", threadId: "t", speaker: "missing" });
    expect(g.session.getSnapshot().status).toMatchObject({ phase: "error", error: { code: "device-lost" } });
    expect(JSON.stringify(g.session.getSnapshot().status)).not.toContain("private-device-id");
    expect(g.transports).toHaveLength(0); expect(g.capture.start).not.toHaveBeenCalled();
  });
});

describe("transports", () => {
  it("encodes signed PCM16 little endian and rejects invalid chunks and insecure endpoints", () => {
    const pcm = Int16Array.from([-32768, -1, 0, 32767]);
    expect([...new Uint8Array(encodePcm(pcm))]).toEqual([0, 128, 255, 255, 0, 0, 255, 127]);
    expect(decodePcm(encodePcm(pcm))).toEqual(pcm);
    expect(() => decodePcm(new ArrayBuffer(3))).toThrow();
    expect(() => voiceSocketUrl("ws://example.com/v1/voice/sessions")).toThrow();
    expect(() => voiceSocketUrl("wss://user:password@example.com/")).toThrow();
    expect(voiceSocketUrl("ws://127.0.0.1:1234/v1/voice/sessions")).toContain("127.0.0.1");
  });
  it("does not emit stale pipeline transcripts/audio after interruption", async () => {
    let finish!: (text: string) => void;
    const events = { onOpen: vi.fn(), onClose: vi.fn(), onTranscript: vi.fn(), onAgentThinking: vi.fn(), onAgentAudio: vi.fn(), onAgentAudioEnd: vi.fn(), onError: vi.fn() };
    const agent = { reply: vi.fn(async () => "reply") };
    const transport = new PipelineVoiceTransport({ transcribe: () => new Promise((resolve) => { finish = resolve; }) }, agent, { async *synthesize() { yield { pcm: frame(1).pcm, sampleRate: 16000 }; } });
    await transport.connect(events, { botId: "a", threadId: "t" });
    transport.sendAudio(frame(2000)); transport.endOfUtterance(); transport.interrupt(); finish("hello"); await Promise.resolve();
    expect(agent.reply).not.toHaveBeenCalled(); expect(events.onTranscript).not.toHaveBeenCalled(); expect(events.onAgentAudio).not.toHaveBeenCalled();
    transport.close();
  });
  it("waits for ready, times out an unresponsive websocket and cancels its timer on close", async () => {
    vi.useFakeTimers();
    class Socket {
      static OPEN = 1; readyState = 1; binaryType = ""; bufferedAmount = 0;
      onopen: (() => void) | null = null; onmessage: ((event: { data: unknown }) => void) | null = null;
      onclose: (() => void) | null = null; onerror: (() => void) | null = null;
      send = vi.fn(); close = vi.fn();
    }
    vi.stubGlobal("WebSocket", Socket);
    const events = { onOpen: vi.fn(), onClose: vi.fn(), onTranscript: vi.fn(), onAgentThinking: vi.fn(), onAgentAudio: vi.fn(), onAgentAudioEnd: vi.fn(), onError: vi.fn() };
    const transport = new WebSocketVoiceTransport("ws://localhost:1234/v1/voice/sessions");
    const promise = transport.connect(events, { botId: "a", threadId: "t" });
    const result = expect(promise).rejects.toThrow("10 seconds");
    await vi.advanceTimersByTimeAsync(10000); await result;
    expect(events.onOpen).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
