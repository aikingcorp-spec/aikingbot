// Copyright (c) 2026 AIKING.
// One realtime call at a time, owned outside any dialog so the call survives closing it. Audio goes browser ↔
// provider over WebRTC; the server only brokers the SDP and reports whether the agent is working.
import { useSyncExternalStore } from "react";
import { at, voiceReason } from "../strings";
import { api, type Bot } from "@/state/store";

export type RealtimeEvent =
  | { seq: number; type: "transcript"; role: "user" | "assistant"; text: string }
  | { seq: number; type: "agent-working"; request: string }
  | { seq: number; type: "agent-done"; ok: boolean; summary: string }
  | { seq: number; type: "error"; message: string }
  | { seq: number; type: "closed"; reason: string };

export type RealtimeCallState = {
  phase: "idle" | "connecting" | "active" | "ending";
  bot: Bot | null;
  startedAt: number;
  muted: boolean;
  speaking: boolean;
  /** The request the agent is working on in its conversation, if any. */
  working: string | null;
  lastResult: { ok: boolean; summary: string } | null;
  error: string;
  /** A short message shown when no call is running, e.g. why this agent cannot take a call. */
  notice: string;
};

const idle: RealtimeCallState = { phase: "idle", bot: null, startedAt: 0, muted: false, speaking: false, working: null, lastResult: null, error: "", notice: "" };
let state = idle;
const listeners = new Set<() => void>();
const set = (patch: Partial<RealtimeCallState>) => { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

type Media = { pc: RTCPeerConnection; stream: MediaStream; audio: HTMLAudioElement; context?: AudioContext };
let media: Media | null = null;
let callId = "";
let after = 0;
let poll: ReturnType<typeof setInterval> | undefined;
let meter: ReturnType<typeof setInterval> | undefined;

export function useRealtimeCall(): RealtimeCallState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Waits for ICE gathering so the offer carries candidates; the provider does not trickle. */
export async function gatheredOffer(pc: RTCPeerConnection, timeoutMs = 3_000): Promise<string> {
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const timer = setTimeout(resolve, timeoutMs);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(timer); resolve(); } });
  });
  return pc.localDescription?.sdp ?? "";
}

/** What the call widget says the agent is doing, from the server's events in order. */
export function reduceEvents(previous: Pick<RealtimeCallState, "working" | "lastResult" | "error">, events: RealtimeEvent[]) {
  let { working, lastResult, error } = previous;
  for (const event of events) {
    if (event.type === "agent-working") { working = event.request; lastResult = null; }
    if (event.type === "agent-done") { working = null; lastResult = { ok: event.ok, summary: event.summary }; }
    if (event.type === "error") error = event.message;
  }
  return { working, lastResult, error };
}

function release() {
  clearInterval(poll); clearInterval(meter);
  poll = undefined; meter = undefined;
  if (media) {
    media.stream.getTracks().forEach((track) => track.stop());
    media.pc.close();
    media.audio.pause();
    media.audio.srcObject = null;
    void media.context?.close().catch(() => undefined);
  }
  media = null;
  callId = "";
}

function watchSpeaking(stream: MediaStream, current: Media) {
  try {
    const context = new AudioContext();
    current.context = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    meter = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0; for (const value of data) sum += value * value;
      const speaking = Math.sqrt(sum / data.length) > 0.015;
      if (speaking !== state.speaking) set({ speaking });
    }, 150);
  } catch { /* the indicator is optional */ }
}

export async function startRealtimeCall(bot: Bot, voice: string): Promise<boolean> {
  if (state.phase !== "idle") return false;
  set({ ...idle, phase: "connecting", bot });
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const pc = new RTCPeerConnection();
    const audio = new Audio(); audio.autoplay = true;
    const current: Media = { pc, stream, audio };
    media = current;
    pc.createDataChannel("oai-events");
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.ontrack = (event) => {
      const output = event.streams[0] ?? new MediaStream([event.track]);
      audio.srcObject = output;
      void audio.play().catch(() => set({ error: at("call.audioBlocked") }));
      watchSpeaking(output, current);
    };
    pc.onconnectionstatechange = () => {
      if (media === current && (pc.connectionState === "failed" || pc.connectionState === "disconnected")) {
        set({ error: at("call.connectionLost") });
        void hangUpRealtimeCall();
      }
    };
    const sdp = await gatheredOffer(pc);
    const started = await api<{ id: string; sdp: string }>("/api/aiking/realtime/calls", { method: "POST", body: JSON.stringify({ botId: bot.id, threadId: bot.threadId, sdp, ...(voice ? { voice } : {}) }), timeoutMs: 60_000 });
    if (media !== current) return false;
    callId = started.id; after = 0;
    await pc.setRemoteDescription({ type: "answer", sdp: started.sdp });
    set({ phase: "active", startedAt: Date.now() });
    poll = setInterval(() => void refresh(), 1_000);
    return true;
  } catch (cause) {
    release();
    set({ ...idle, error: cause instanceof Error ? cause.message : at("call.couldNotStart") });
    return false;
  }
}

async function refresh() {
  const id = callId;
  if (!id) return;
  try {
    const result = await api<{ active: boolean; events: RealtimeEvent[] }>(`/api/aiking/realtime/calls/${id}?after=${after}`);
    if (id !== callId) return;
    if (result.events.length) {
      after = result.events.at(-1)!.seq;
      set(reduceEvents(state, result.events));
    }
    if (!result.active) { release(); set({ phase: "idle", speaking: false, working: null }); }
  } catch { /* one missed poll is not a dropped call */ }
}

export async function hangUpRealtimeCall(): Promise<void> {
  const id = callId;
  if (state.phase === "idle") return;
  set({ phase: "ending" });
  if (id) await api(`/api/aiking/realtime/calls/${id}/end`, { method: "POST", body: "{}" }).catch(() => undefined);
  release();
  set({ phase: "idle", speaking: false, working: null });
}

export function muteRealtimeCall(muted: boolean): void {
  media?.stream.getAudioTracks().forEach((track) => { track.enabled = !muted; });
  set({ muted });
}

export function clearRealtimeError(): void { set({ error: "" }); }

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
export function showRealtimeNotice(notice: string): void {
  clearTimeout(noticeTimer);
  set({ notice });
  noticeTimer = setTimeout(() => set({ notice: "" }), 5_000);
}

export function voiceUnavailableMessage(): string { return at("call.unavailableModel"); }
export type AgentRealtimeStatus = { available: boolean; reason?: string; voices?: string[]; agent?: { supported: boolean; voice: string } };

/** This agent's call readiness, read fresh: its model can change at any time. */
export async function agentRealtimeStatus(botId: string): Promise<AgentRealtimeStatus | { forbidden: true }> {
  try {
    const status = await api<AgentRealtimeStatus>(`/api/aiking/realtime/status?botId=${encodeURIComponent(botId)}`);
    return status.reason ? { ...status, reason: voiceReason(status.reason) } : status;
  } catch (cause) {
    return (cause as { status?: number }).status === 403 ? { forbidden: true } : { available: false, reason: at("call.unavailableWorkspace") };
  }
}

export async function saveAgentVoice(botId: string, voice: string): Promise<void> {
  await api(`/api/aiking/realtime/agents/${encodeURIComponent(botId)}/voice`, { method: "PUT", body: JSON.stringify({ voice }) });
}

export type RealtimeStatus = { available: boolean; reason?: string; voices?: string[] } | { forbidden: true };
let statusRequest: Promise<RealtimeStatus> | null = null;
let statusValue: RealtimeStatus | null = null;
const statusListeners = new Set<() => void>();

/** Fetched once per page; a failed read is retried on the next call. */
export function realtimeStatus(): Promise<RealtimeStatus> {
  statusRequest ??= api<{ available: boolean; reason?: string; voices?: string[] }>("/api/aiking/realtime/status")
    .catch((cause): RealtimeStatus => {
      statusRequest = null;
      return (cause as { status?: number }).status === 403 ? { forbidden: true } : { available: false, reason: at("call.unavailableWorkspace") };
    })
    .then((value) => { if (!("forbidden" in value) && value.reason) value = { ...value, reason: voiceReason(value.reason) }; statusValue = value; statusListeners.forEach((listener) => listener()); return value; });
  return statusRequest;
}

export function useRealtimeStatus(): RealtimeStatus | null {
  const value = useSyncExternalStore((listener) => { statusListeners.add(listener); return () => { statusListeners.delete(listener); }; }, () => statusValue);
  if (!value) void realtimeStatus();
  return value;
}
