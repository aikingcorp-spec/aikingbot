// Copyright (c) 2026 AIKING.
import { z } from "zod";
import type { AgentReplies, AudioFrame, SpeechToText, TextToSpeech, VoiceTransport, VoiceTransportEvents } from "./contract";

export class PipelineVoiceTransport implements VoiceTransport {
  readonly id = "pipeline";
  private events?: VoiceTransportEvents;
  private options?: { botId: string; threadId: string };
  private frames: Int16Array[] = [];
  private samples = 0;
  private abort?: AbortController;
  constructor(private readonly stt: SpeechToText, private readonly agent: AgentReplies, private readonly tts: TextToSpeech) {}
  async connect(events: VoiceTransportEvents, options: { botId: string; threadId: string }) {
    this.events = events; this.options = options;
    events.onOpen({ resumeToken: "loopback" });
  }
  sendAudio(frame: AudioFrame) {
    if (!this.events) return;
    if (this.samples + frame.pcm.length > 16000 * 60) {
      this.frames = []; this.samples = 0;
      this.events.onError({ code: "audio-unsupported", message: "An utterance cannot exceed 60 seconds.", retryable: false });
      return;
    }
    this.frames.push(frame.pcm.slice()); this.samples += frame.pcm.length;
  }
  endOfUtterance() {
    if (!this.events || !this.options || !this.samples) return;
    this.abort?.abort();
    const abort = new AbortController(); this.abort = abort;
    const pcm = new Int16Array(this.samples);
    let offset = 0;
    for (const frame of this.frames) { pcm.set(frame, offset); offset += frame.length; }
    this.frames = []; this.samples = 0;
    const events = this.events;
    const options = this.options;
    void (async () => {
      try {
        events.onAgentThinking();
        const text = await this.stt.transcribe(pcm, 16000, abort.signal);
        if (abort.signal.aborted) return;
        events.onTranscript({ role: "user", text, final: true });
        const reply = await this.agent.reply({ ...options, text }, abort.signal);
        if (abort.signal.aborted) return;
        events.onTranscript({ role: "agent", text: reply, final: true });
        for await (const chunk of this.tts.synthesize(reply, abort.signal)) {
          if (abort.signal.aborted) return;
          events.onAgentAudio(chunk);
        }
        if (!abort.signal.aborted) events.onAgentAudioEnd();
      } catch (cause) {
        if (!abort.signal.aborted) events.onError({ code: "provider-unavailable", message: cause instanceof Error ? cause.message : "Speech provider failed.", retryable: false });
      }
    })();
  }
  interrupt() { this.abort?.abort(); this.frames = []; this.samples = 0; }
  close() { this.interrupt(); this.events = undefined; this.options = undefined; }
}

/** Offline verification only: scripted transcript/reply and an audible tone, no AI provider. */
export function createLoopbackTransport(): VoiceTransport {
  return new PipelineVoiceTransport(
    { transcribe: async (pcm) => `Offline microphone test: ${pcm.length} samples received at 16 kHz.` },
    { reply: async () => "Offline loopback reply. Microphone capture and playback are working." },
    { async *synthesize(_text, signal) {
      for (let chunk = 0; chunk < 12 && !signal.aborted; chunk++) {
        const pcm = Int16Array.from({ length: 2400 }, (_, i) => Math.round(Math.sin(2 * Math.PI * 440 * (i + chunk * 2400) / 24000) * 1800));
        yield { pcm, sampleRate: 24000 };
      }
    } },
  );
}

const serverEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session.ready"), resumeToken: z.string().max(4096).optional() }),
  z.object({ type: z.literal("transcript"), role: z.enum(["user", "agent"]), text: z.string().max(32000), final: z.boolean() }),
  z.object({ type: z.literal("response.thinking") }),
  z.object({ type: z.literal("response.audio.start"), sampleRate: z.number().int().min(8000).max(96000) }),
  z.object({ type: z.literal("response.audio.end") }),
  z.object({ type: z.literal("error"), code: z.enum(["permission-denied", "no-microphone", "device-lost", "transport-failed", "provider-unavailable", "audio-unsupported"]), message: z.string().max(4096), retryable: z.boolean() }),
]);

/** PCM16 wire bytes are little endian, independent of the host's typed-array endianness. */
export function encodePcm(pcm: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(pcm.length * 2);
  const view = new DataView(buffer);
  pcm.forEach((value, i) => view.setInt16(i * 2, value, true));
  return buffer;
}
export function decodePcm(buffer: ArrayBuffer): Int16Array {
  if (buffer.byteLength % 2 || buffer.byteLength > 1024 * 1024) throw new Error("Invalid PCM16 audio chunk.");
  const view = new DataView(buffer);
  return Int16Array.from({ length: buffer.byteLength / 2 }, (_, i) => view.getInt16(i * 2, true));
}
export function voiceSocketUrl(endpoint: string): string {
  const url = new URL(endpoint);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "wss:" && !(url.protocol === "ws:" && loopback)) throw new Error("Use wss:// for a voice server, or ws:// on localhost for testing.");
  if (url.username || url.password || url.hash) throw new Error("Voice URLs cannot contain credentials or fragments.");
  return url.href;
}

export class WebSocketVoiceTransport implements VoiceTransport {
  readonly id = "websocket-v1";
  private socket?: WebSocket;
  private events?: VoiceTransportEvents;
  private ready = false;
  private outputRate?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private cancelConnect?: () => void;
  constructor(private readonly endpoint: string) {}
  connect(events: VoiceTransportEvents, options: { botId: string; threadId: string; resumeToken?: string }): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(voiceSocketUrl(this.endpoint));
      this.socket = socket; this.events = events;
      socket.binaryType = "arraybuffer";
      const clear = () => { clearTimeout(this.timer); this.timer = undefined; this.cancelConnect = undefined; };
      this.cancelConnect = () => { clear(); reject(new Error("Voice connection was cancelled.")); };
      this.timer = setTimeout(() => { reject(new Error("Voice server did not become ready within 10 seconds.")); this.close(); }, 10000);
      socket.onopen = () => socket.send(JSON.stringify({ type: "session.start", ...options, format: { sampleRate: 16000, encoding: "pcm16" } }));
      socket.onmessage = (event) => {
        try {
          if (event.data instanceof ArrayBuffer) {
            if (!this.ready || this.outputRate === undefined) throw new Error("Audio arrived outside a response.");
            events.onAgentAudio({ pcm: decodePcm(event.data), sampleRate: this.outputRate });
            return;
          }
          if (typeof event.data !== "string" || event.data.length > 64000) throw new Error("Invalid voice event.");
          const data = serverEvent.parse(JSON.parse(event.data));
          if (data.type === "session.ready") {
            if (this.ready) throw new Error("Duplicate voice session.ready.");
            this.ready = true; clear(); events.onOpen({ resumeToken: data.resumeToken }); resolve();
          } else {
            if (!this.ready && data.type !== "error") throw new Error("Voice server has not acknowledged the session.");
            switch (data.type) {
              case "transcript": events.onTranscript(data); break;
              case "response.thinking": events.onAgentThinking(); break;
              case "response.audio.start": this.outputRate = data.sampleRate; break;
              case "response.audio.end": this.outputRate = undefined; events.onAgentAudioEnd(); break;
              case "error": events.onError(data); break;
            }
          }
        } catch {
          events.onError({ code: "transport-failed", message: "The voice server sent an invalid protocol v1 message.", retryable: false });
          this.close();
        }
      };
      socket.onclose = (event) => {
        clear(); this.ready = false;
        reject(new Error("Voice connection closed before it was ready."));
        events.onClose({ expected: event.code === 1000, error: `Voice connection closed (${event.code}).` });
      };
      socket.onerror = () => { reject(new Error("Unable to reach the voice server.")); };
    });
  }
  private send(data: object) { if (this.ready && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(data)); }
  sendAudio(frame: AudioFrame) {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return;
    if (frame.sampleRate !== 16000 || frame.pcm.length !== 320) throw new Error("Voice input must be 20 ms PCM16 at 16 kHz.");
    if (this.socket.bufferedAmount > 1024 * 1024) {
      this.events?.onError({ code: "transport-failed", message: "The voice connection cannot keep up with microphone input.", retryable: true });
      return;
    }
    this.socket.send(encodePcm(frame.pcm));
  }
  endOfUtterance() { this.send({ type: "input.end" }); }
  interrupt() { this.send({ type: "response.cancel" }); }
  close() {
    const socket = this.socket;
    this.cancelConnect?.();
    clearTimeout(this.timer); this.timer = undefined;
    if (socket) {
      this.send({ type: "session.close" });
      socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null;
      socket.close();
    }
    this.socket = undefined; this.events = undefined; this.ready = false; this.outputRate = undefined;
  }
}
