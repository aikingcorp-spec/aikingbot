// Copyright (c) 2026 AIKING.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Mic, MicOff, Phone, PhoneOff, X } from "lucide-react";
import type { Bot } from "@/state/store";
import { BotAvatar } from "@/components/Avatar";
import { CallButton as ProviderCallButton } from "@/components/CallView";
import { useOnCall } from "@/lib/call";
import { isLiveCallRunning, useLiveMedia } from "@/lib/live-call-media";
import { WebAudioCapture, WebAudioPlayback } from "./audio";
import type { VoicePhase } from "./contract";
import { VoiceSession } from "./session";
import { createLoopbackTransport, voiceSocketUrl, WebSocketVoiceTransport } from "./transports";

type CallTarget = { bot: Bot; open: boolean };
let target: CallTarget | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getTarget = () => target;
function setTarget(next: CallTarget | null) { target = next; listeners.forEach((listener) => listener()); }

export function VoiceCallButton({ bot }: { bot: Bot; placement?: "composer" | "header" }) {
  return <button type="button" aria-label={`Voice call with ${bot.name}`} title="Voice call" className="flex size-7 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink" onClick={() => setTarget(target ? { ...target, open: true } : { bot, open: true })}><Phone className="size-4" /></button>;
}

const labels: Record<VoicePhase["phase"], string> = {
  idle: "Ready to call", "requesting-permission": "Requesting microphone access…", connecting: "Connecting…",
  listening: "Listening", "user-speaking": "You are speaking", thinking: "Agent is thinking…",
  "agent-speaking": "Agent is speaking", reconnecting: "Reconnecting…", ended: "Call ended", error: "Unable to continue the call",
};
function readPreference(key: string) { try { return localStorage.getItem(`aiking-voice-${key}`) ?? ""; } catch { return ""; } }
function savePreference(key: string, value: string) { try { localStorage.setItem(`aiking-voice-${key}`, value); } catch {} }

export function VoiceCallHost() {
  const current = useSyncExternalStore(subscribe, getTarget);
  return current ? <VoiceCall key={`${current.bot.id}:${current.bot.threadId}`} target={current} /> : null;
}

function VoiceCall({ target: current }: { target: CallTarget }) {
  const [microphone, setMicrophone] = useState(() => readPreference("microphone"));
  const [speaker, setSpeaker] = useState(() => readPreference("speaker"));
  const [endpoint, setEndpoint] = useState(() => readPreference("endpoint"));
  const [mode, setMode] = useState(() => readPreference("mode") === "websocket" ? "websocket" : "loopback");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState("");
  const [session, setSession] = useState(() => new VoiceSession(createLoopbackTransport, new WebAudioCapture(), new WebAudioPlayback()));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const phase = snapshot.status.phase;
  const active = !["idle", "ended", "error"].includes(phase);
  const liveMedia = useLiveMedia();
  const turnsTarget = useOnCall();
  const providerBusy = isLiveCallRunning(liveMedia.phase) || Boolean(turnsTarget);
  const dialog = useRef<HTMLDialogElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => () => session.finish(), [session]);
  useEffect(() => {
    let mounted = true;
    const refresh = () => { void navigator.mediaDevices?.enumerateDevices().then((list) => { if (mounted) setDevices(list); }).catch(() => { if (mounted) setDeviceError("Device names become available after granting microphone access."); }); };
    refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => { mounted = false; navigator.mediaDevices?.removeEventListener("devicechange", refresh); };
  }, [phase === "requesting-permission"]);
  useEffect(() => {
    if (current.open) {
      const previous = document.activeElement;
      dialog.current?.showModal();
      return () => { if (previous instanceof HTMLElement) previous.focus(); };
    }
  }, [current.open]);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); }, [snapshot.transcripts]);
  const choose = (key: string, value: string, setter: (value: string) => void) => { setter(value); savePreference(key, value); };
  const start = () => {
    setDeviceError("");
    if (providerBusy) return;
    let url = "";
    if (mode === "websocket") {
      try { url = voiceSocketUrl(endpoint); } catch (cause) { setDeviceError(cause instanceof Error ? cause.message : "Enter a voice server URL."); return; }
    }
    const next = new VoiceSession(mode === "loopback" ? createLoopbackTransport : () => new WebSocketVoiceTransport(url), new WebAudioCapture(), new WebAudioPlayback());
    setSession(next);
    void next.start({ botId: current.bot.id, threadId: current.bot.threadId, microphone, speaker });
  };
  const close = () => { session.finish(); setTarget(null); };
  if (!current.open) return createPortal(
    <button type="button" aria-label="Return to voice call" onClick={() => setTarget({ ...current, open: true })} className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-full border border-accent/40 bg-panel px-5 py-3 text-sm text-ink shadow-xl"><Phone className="size-4 text-accent" />{current.bot.name} · {labels[phase]}</button>, document.body,
  );
  return createPortal(
    <dialog ref={dialog} aria-label={`Voice call with ${current.bot.name}`} onCancel={(event) => { event.preventDefault(); close(); }} className="m-auto w-[560px] max-w-[calc(100vw-32px)] rounded-2xl border border-hairline bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/60">
      <div className="flex items-center gap-3 border-b border-hairline p-5">
        <Phone className="size-5 text-accent" /><h2 className="flex-1 text-lg font-semibold">Voice call</h2>
        {active && <button type="button" aria-label="Minimize voice call" onClick={() => setTarget({ ...current, open: false })} className="rounded-lg px-3 py-1 text-sm text-ink-secondary hover:bg-raised">Minimize</button>}
        <button type="button" aria-label="Close voice call" onClick={close} className="rounded-lg p-2 hover:bg-raised"><X className="size-4" /></button>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-4"><BotAvatar bot={current.bot} size={56} /><div><div className="text-lg font-medium">{current.bot.name}</div><div role="status" data-voice-phase={phase} className="text-sm text-ink-secondary">{labels[phase]}{snapshot.status.phase === "reconnecting" ? ` (attempt ${snapshot.status.attempt})` : ""}</div></div></div>
        <div className="grid grid-cols-2 gap-3">
          <DeviceSelect label="Microphone" kind="audioinput" value={microphone} devices={devices} disabled={active} onChange={(value) => choose("microphone", value, setMicrophone)} />
          <DeviceSelect label="Speaker" kind="audiooutput" value={speaker} devices={devices} disabled={active} onChange={(value) => choose("speaker", value, setSpeaker)} />
        </div>
        <label className="block space-y-1 text-sm"><span className="text-ink-secondary">Voice service</span><select aria-label="Voice service" disabled={active} value={mode} onChange={(event) => choose("mode", event.target.value, setMode)} className="w-full rounded-lg border border-hairline bg-raised p-2"><option value="loopback">Offline test (scripted)</option><option value="websocket">AIKING Core voice server</option></select></label>
        {mode === "websocket" ? <label className="block space-y-1 text-sm"><span className="text-ink-secondary">Voice server URL</span><input aria-label="Voice server URL" placeholder="wss://core.example/v1/voice/sessions" disabled={active} value={endpoint} onChange={(event) => choose("endpoint", event.target.value, setEndpoint)} className="w-full rounded-lg border border-hairline bg-raised p-2" /></label> : <p className="text-xs text-ink-tertiary">Tests your microphone and speaker locally with a scripted reply and a tone. No speech recognition or AI provider is connected.</p>}
        <div role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, snapshot.level * 5) * 100)} className="h-1.5 overflow-hidden rounded-full bg-raised"><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.min(1, snapshot.level * 5) * 100}%` }} /></div>
        {snapshot.status.phase === "error" && <p role="alert" data-voice-error={snapshot.status.error.code} className="text-sm text-danger">{snapshot.status.error.message}</p>}
        {deviceError && <p role="alert" className="text-sm text-danger">{deviceError}</p>}
        {providerBusy && <p role="status" className="text-sm text-warning">End the existing provider call before starting another call.</p>}
        <div ref={transcript} role="log" aria-label="Voice transcript" aria-live="polite" className="max-h-48 space-y-2 overflow-y-auto rounded-xl bg-raised p-3 text-sm">
          {snapshot.transcripts.length ? snapshot.transcripts.map((line, i) => <p key={i}><span className="font-medium text-accent">{line.role === "user" ? "You" : current.bot.name}: </span>{line.text}{!line.final && "…"}</p>) : <p className="text-ink-tertiary">Your conversation will appear here.</p>}
        </div>
        <div className="flex items-center justify-center gap-3">
          {active ? <>
            <button type="button" aria-label={snapshot.muted ? "Unmute microphone" : "Mute microphone"} aria-pressed={snapshot.muted} onClick={() => session.mute(!snapshot.muted)} className="rounded-full bg-raised p-3 hover:bg-raised-hover">{snapshot.muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}</button>
            <button type="button" onClick={() => session.interrupt()} disabled={!["thinking", "agent-speaking"].includes(phase)} className="rounded-full bg-raised px-4 py-3 text-sm disabled:opacity-40">Interrupt reply</button>
            <button type="button" aria-label="Hang up voice call" onClick={() => session.finish()} className="rounded-full bg-danger p-3 text-white"><PhoneOff className="size-5" /></button>
          </> : <button type="button" disabled={providerBusy} onClick={start} className="flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-medium text-on-accent disabled:opacity-40"><Phone className="size-4" />{phase === "idle" ? "Start voice call" : "Call again"}</button>}
        </div>
        {!active && <details className="border-t border-hairline pt-3 text-sm text-ink-secondary"><summary className="cursor-pointer">Existing provider call options</summary><div className="mt-3"><ProviderCallButton bot={current.bot} placement="composer" /></div></details>}
        <output data-voice-frames={snapshot.framesSent} data-voice-interruptions={snapshot.interruptions} data-voice-reconnects={snapshot.reconnects} className="sr-only">{snapshot.framesSent} audio frames sent</output>
      </div>
    </dialog>, document.body,
  );
}

function DeviceSelect({ label, kind, value, devices, disabled, onChange }: { label: string; kind: MediaDeviceKind; value: string; devices: MediaDeviceInfo[]; disabled: boolean; onChange: (id: string) => void }) {
  const choices = devices.filter((device) => device.kind === kind && device.deviceId !== "default");
  return <label className="block space-y-1 text-sm"><span className="text-ink-secondary">{label}</span><select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-hairline bg-raised p-2"><option value="">System default</option>{value && !choices.some((device) => device.deviceId === value) && <option value={value}>Previously selected (unavailable)</option>}{choices.map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${i + 1}`}</option>)}</select></label>;
}
