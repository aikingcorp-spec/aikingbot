// Copyright (c) 2026 AIKING.
import { EnergyVad, audioError, type VoiceCapture, type VoicePlayback } from "./audio";
import { VOICE_RECONNECT, type AudioFrame, type VoiceError, type VoicePhase, type VoiceTransport, type VoiceTransportEvents } from "./contract";

export type VoiceSnapshot = {
  status: VoicePhase; muted: boolean; level: number;
  transcripts: Array<{ role: "user" | "agent"; text: string; final: boolean }>;
  framesSent: number; interruptions: number; reconnects: number;
};

export class VoiceSession {
  private snapshot: VoiceSnapshot = { status: { phase: "idle" }, muted: false, level: 0, transcripts: [], framesSent: 0, interruptions: 0, reconnects: 0 };
  private listeners = new Set<() => void>();
  private active = false;
  private connection = 0;
  private reply = 0;
  private attempts = 0;
  private resumeToken?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private transport?: VoiceTransport;
  private vad = new EnergyVad();
  private preRoll: AudioFrame[] = [];
  private options?: { botId: string; threadId: string };
  constructor(private readonly createTransport: () => VoiceTransport, private readonly capture: VoiceCapture, private readonly playback: VoicePlayback) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<VoiceSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach((listener) => listener()); }
  private phase(status: VoicePhase) { this.update({ status }); }
  async start(options: { botId: string; threadId: string; microphone?: string; speaker?: string }) {
    if (this.active) return;
    this.active = true; this.options = { botId: options.botId, threadId: options.threadId };
    this.attempts = 0; this.resumeToken = undefined;
    this.capture.mute(false);
    this.update({ muted: false, transcripts: [], framesSent: 0, interruptions: 0, reconnects: 0 });
    this.phase({ phase: "requesting-permission" });
    let device: "microphone" | "speaker" = "speaker";
    try {
      await this.playback.prepare(options.speaker ?? "");
      if (!this.active) { this.playback.close(); return; }
      device = "microphone";
      await this.capture.start(options.microphone ?? "", (frame) => this.input(frame), () => this.fail({ code: "device-lost", message: "The microphone was disconnected. Choose a device and call again.", retryable: false }));
      if (!this.active) { this.capture.stop(); return; }
      await this.connect();
    } catch (cause) { if (this.active) this.fail(audioError(cause, device)); }
  }
  private async connect() {
    if (!this.active || !this.options) return;
    this.phase({ phase: "connecting", attempt: this.attempts + 1 });
    const connection = ++this.connection;
    const current = () => this.active && connection === this.connection;
    const events: VoiceTransportEvents = {
      onOpen: (info) => { if (current()) { this.resumeToken = info.resumeToken ?? this.resumeToken; this.attempts = 0; this.phase({ phase: "listening" }); } },
      onClose: (info) => {
        if (!current()) return;
        if (info.expected) { this.finish("remote"); return; }
        this.reconnect(info.error);
      },
      onTranscript: (line) => {
        if (!current()) return;
        const lines = [...this.snapshot.transcripts];
        const last = lines.at(-1);
        if (last && last.role === line.role && !last.final) lines[lines.length - 1] = line;
        else lines.push(line);
        this.update({ transcripts: lines.slice(-100) });
      },
      onAgentThinking: () => { if (current() && !this.vad.speaking) this.phase({ phase: "thinking" }); },
      onAgentAudio: (chunk) => {
        if (!current() || this.vad.speaking) return;
        try { this.playback.enqueue(chunk); this.phase({ phase: "agent-speaking" }); }
        catch (cause) { this.fail(audioError(cause)); }
      },
      onAgentAudioEnd: () => {
        const reply = this.reply;
        void this.playback.drain().then(() => { if (current() && reply === this.reply && ["agent-speaking", "thinking"].includes(this.snapshot.status.phase)) this.phase({ phase: "listening" }); });
      },
      onError: (error) => { if (current()) { if (error.retryable) this.reconnect(error.message); else this.fail(error); } },
    };
    try {
      const transport = this.createTransport();
      this.transport = transport;
      await transport.connect(events, { ...this.options, resumeToken: this.resumeToken });
    }
    catch (cause) { if (current()) this.reconnect(cause instanceof Error ? cause.message : "Voice connection failed."); }
  }
  private reconnect(message = "Voice connection was lost.") {
    ++this.connection; ++this.reply;
    this.transport?.close(); this.transport = undefined;
    this.playback.interrupt(); this.vad.reset(); this.preRoll = [];
    if (this.attempts >= VOICE_RECONNECT.attempts) {
      this.fail({ code: "transport-failed", message, retryable: true }); return;
    }
    const inMs = VOICE_RECONNECT.delaysMs[this.attempts++];
    this.update({ status: { phase: "reconnecting", attempt: this.attempts, inMs }, level: 0, reconnects: this.snapshot.reconnects + 1 });
    this.timer = setTimeout(() => { this.timer = undefined; void this.connect(); }, inMs);
  }
  private input(frame: AudioFrame) {
    if (!this.active || this.snapshot.muted || !this.transport || ["connecting", "reconnecting", "requesting-permission"].includes(this.snapshot.status.phase)) return;
    const { level, started, ended } = this.vad.push(frame.pcm);
    this.update({ level });
    if (started) {
      if (["thinking", "agent-speaking"].includes(this.snapshot.status.phase)) this.interrupt();
      this.phase({ phase: "user-speaking" });
      for (const previous of this.preRoll) this.send(previous);
      this.preRoll = [];
    }
    if (this.vad.speaking || ended) this.send(frame);
    else { this.preRoll.push(frame); if (this.preRoll.length > 10) this.preRoll.shift(); }
    if (ended && this.active && this.transport) { this.phase({ phase: "thinking" }); this.transport.endOfUtterance(); }
  }
  private send(frame: AudioFrame) {
    try { this.transport?.sendAudio(frame); if (this.active) this.update({ framesSent: this.snapshot.framesSent + 1 }); }
    catch (cause) { this.fail({ code: "transport-failed", message: cause instanceof Error ? cause.message : "Audio transport failed.", retryable: true }); }
  }
  interrupt() {
    if (!this.active) return;
    ++this.reply; this.playback.interrupt(); this.transport?.interrupt();
    this.update({ interruptions: this.snapshot.interruptions + 1 });
    if (!this.vad.speaking) this.phase({ phase: "listening" });
  }
  mute(muted: boolean) {
    this.capture.mute(muted); this.update({ muted, level: 0 });
    if (muted && this.vad.speaking) { this.transport?.interrupt(); this.phase({ phase: "listening" }); }
    this.vad.reset(); this.preRoll = [];
  }
  private release() {
    this.active = false; ++this.connection; ++this.reply;
    clearTimeout(this.timer); this.timer = undefined;
    this.capture.stop(); this.playback.close(); this.transport?.close(); this.transport = undefined;
    this.vad.reset(); this.preRoll = [];
  }
  private fail(error: VoiceError) { this.release(); this.update({ status: { phase: "error", error }, level: 0 }); }
  finish(reason: "hangup" | "remote" | "idle-timeout" = "hangup") {
    const idle = this.snapshot.status.phase === "idle";
    this.release();
    if (!idle) this.update({ status: { phase: "ended", reason }, level: 0 });
  }
}
