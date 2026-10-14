// Copyright (c) 2026 AIKING.
import type { AudioChunk, AudioFrame, VoiceError } from "./contract";

export interface VoiceCapture {
  start(deviceId: string, frame: (frame: AudioFrame) => void, lost: () => void): Promise<void>;
  mute(muted: boolean): void;
  stop(): void;
}
export interface VoicePlayback {
  prepare(deviceId: string): Promise<void>;
  enqueue(chunk: AudioChunk): void;
  drain(): Promise<void>;
  interrupt(): void;
  close(): void;
}

export function audioError(cause: unknown, device: "microphone" | "speaker" = "microphone"): VoiceError {
  const name = cause instanceof Error ? cause.name : "";
  const code = name === "NotAllowedError" || name === "SecurityError" ? "permission-denied"
    : name === "NotFoundError" || name === "OverconstrainedError" ? device === "speaker" ? "device-lost" : "no-microphone"
    : name === "NotReadableError" ? "device-lost" : "audio-unsupported";
  const message = code === "permission-denied" ? `Access to the ${device} was denied. Allow it in browser or system settings and call again.`
    : code === "no-microphone" ? "No microphone matches your selection. Choose a connected microphone and call again."
    : code === "device-lost" ? `The ${device} is unavailable or in use. Choose an available device and call again.`
    : cause instanceof Error ? cause.message : "Audio is unavailable on this device.";
  return { code, message, retryable: false };
}

/** Streaming area resampler: continuity across worklet blocks, 320 samples per wire frame. */
export class Pcm16Framer {
  private readonly ratio: number;
  private area = 0;
  private filled = 0;
  private samples: number[] = [];
  constructor(inputRate: number, private readonly emit: (pcm: Int16Array) => void) {
    if (!Number.isFinite(inputRate) || inputRate < 16000) throw new Error("Unsupported input sample rate.");
    this.ratio = inputRate / 16000;
  }
  push(input: Float32Array) {
    for (const raw of input) {
      const value = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      let remaining = 1;
      while (remaining > 1e-9) {
        const part = Math.min(remaining, this.ratio - this.filled);
        this.area += value * part;
        this.filled += part;
        remaining -= part;
        if (this.filled >= this.ratio - 1e-9) {
          const mean = this.area / this.ratio;
          this.samples.push(Math.round(mean * (mean < 0 ? 32768 : 32767)));
          this.area = 0;
          this.filled = 0;
          if (this.samples.length === 320) {
            this.emit(Int16Array.from(this.samples));
            this.samples = [];
          }
        }
      }
    }
  }
}

export class EnergyVad {
  private speechFrames = 0;
  private quietFrames = 0;
  speaking = false;
  reset() { this.speechFrames = 0; this.quietFrames = 0; this.speaking = false; }
  push(pcm: Int16Array): { level: number; started: boolean; ended: boolean } {
    const level = Math.sqrt(pcm.reduce((sum, value) => sum + (value / 32768) ** 2, 0) / Math.max(1, pcm.length));
    let started = false;
    let ended = false;
    if (level >= (this.speaking ? 0.008 : 0.015)) {
      this.quietFrames = 0;
      this.speechFrames++;
      if (!this.speaking && this.speechFrames >= 3) { this.speaking = true; started = true; }
    } else {
      this.speechFrames = 0;
      if (this.speaking && ++this.quietFrames >= 30) { this.reset(); ended = true; }
    }
    return { level, started, ended };
  }
}

const processor = `class VoiceCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const mono = inputs[0]?.[0];
    if (mono) this.port.postMessage(mono.slice());
    return true;
  }
}
registerProcessor("aiking-voice-capture", VoiceCaptureProcessor);`;

export class WebAudioCapture implements VoiceCapture {
  private generation = 0;
  private context?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private muted = false;
  async start(deviceId: string, frame: (frame: AudioFrame) => void, lost: () => void) {
    const generation = ++this.generation;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioContext) throw new Error("Web Audio microphone capture requires a secure context.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    } });
    if (generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); return; }
    this.stream = stream;
    const context = new AudioContext();
    this.context = context;
    const url = URL.createObjectURL(new Blob([processor], { type: "text/javascript" }));
    try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    if (generation !== this.generation) return;
    const node = new AudioWorkletNode(context, "aiking-voice-capture");
    this.node = node;
    const framer = new Pcm16Framer(context.sampleRate, (pcm) => {
      if (!this.muted && generation === this.generation) frame({ pcm, sampleRate: 16000, at: performance.now() });
    });
    node.port.onmessage = (event: MessageEvent<Float32Array>) => framer.push(event.data);
    const silent = context.createGain();
    silent.gain.value = 0;
    context.createMediaStreamSource(stream).connect(node).connect(silent).connect(context.destination);
    for (const track of stream.getAudioTracks()) {
      track.enabled = !this.muted;
      track.onended = () => { if (generation === this.generation) lost(); };
    }
    await context.resume();
  }
  mute(muted: boolean) {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
  }
  stop() {
    ++this.generation;
    this.node?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    void this.context?.close().catch(() => {});
    this.node = undefined; this.stream = undefined; this.context = undefined;
  }
}

export class WebAudioPlayback implements VoicePlayback {
  private context?: AudioContext;
  private output?: AudioNode;
  private element?: HTMLAudioElement;
  private sources = new Set<AudioBufferSourceNode>();
  private nextAt = 0;
  private timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  async prepare(deviceId: string) {
    const context = new AudioContext();
    this.context = context;
    const sinkContext = context as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (sinkContext.setSinkId) {
      await sinkContext.setSinkId(deviceId);
      this.output = context.destination;
    } else if (deviceId) {
      const destination = context.createMediaStreamDestination();
      const element = new Audio();
      this.element = element;
      const sinkElement = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (!sinkElement.setSinkId) throw new Error("Speaker selection is unavailable on this device. Choose the default speaker.");
      element.srcObject = destination.stream;
      await sinkElement.setSinkId(deviceId);
      await element.play();
      this.output = destination;
    } else this.output = context.destination;
    await context.resume();
  }
  enqueue(chunk: AudioChunk) {
    const context = this.context;
    if (!context || !this.output || !chunk.pcm.length) return;
    if (!Number.isInteger(chunk.sampleRate) || chunk.sampleRate < 8000 || chunk.sampleRate > 96000) throw new Error("Unsupported output sample rate.");
    const buffer = context.createBuffer(1, chunk.pcm.length, chunk.sampleRate);
    buffer.copyToChannel(Float32Array.from(chunk.pcm, (value) => value / 32768), 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.output);
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
    this.sources.add(source);
    this.nextAt = Math.max(context.currentTime, this.nextAt);
    source.start(this.nextAt);
    this.nextAt += buffer.duration;
  }
  drain() {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => { this.timers.delete(timer); resolve(); }, Math.max(0, this.nextAt - (this.context?.currentTime ?? 0)) * 1000 + 20);
      this.timers.set(timer, resolve);
    });
  }
  interrupt() {
    this.sources.forEach((source) => { source.stop(); source.disconnect(); });
    this.sources.clear(); this.nextAt = 0;
    this.timers.forEach((resolve, timer) => { clearTimeout(timer); resolve(); });
    this.timers.clear();
  }
  close() {
    this.interrupt();
    this.element?.pause();
    if (this.element) this.element.srcObject = null;
    void this.context?.close().catch(() => {});
    this.context = undefined; this.output = undefined; this.element = undefined;
  }
}
