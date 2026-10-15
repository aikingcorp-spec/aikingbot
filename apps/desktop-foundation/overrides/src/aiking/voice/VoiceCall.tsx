// Copyright (c) 2026 AIKING.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, CircleAlert, Loader2, Mic, MicOff, Phone, PhoneOff, X } from "lucide-react";
import { api, useStore, type Bot, type InstanceInfo } from "@/state/store";
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

/** One dependency of a call and what fixes it. `ok: null` is still being checked. */
export type VoiceCheck = { id: "platform" | "microphone" | "engine" | "speech"; title: string; ok: boolean | null; detail: string; fix?: { label: string; run: () => void } };

export function engineCheck(bot: Bot, instances: InstanceInfo[] | null, openEngines: () => void): VoiceCheck {
  const instanceId = bot.modelSelection?.instanceId;
  const instance = instances?.find((candidate) => candidate.instanceId === instanceId);
  if (!instances) return { id: "engine", title: "AI engine", ok: null, detail: "Checking the agent's engine…" };
  if (!instance) return { id: "engine", title: "AI engine", ok: false, detail: `${bot.name} has no connected AI engine yet. Connect one (Codex, Claude Code, Grok, Gemini…) and choose it for this agent.`, fix: { label: "Connect an engine", run: openEngines } };
  if (instance.snapshot.state !== "available" || instance.snapshot.authenticated === false) {
    return { id: "engine", title: "AI engine", ok: false, detail: `${instance.displayName} needs sign-in before ${bot.name} can answer. ${instance.snapshot.reason ?? ""}`.trim(), fix: { label: `Connect ${instance.displayName}`, run: openEngines } };
  }
  return { id: "engine", title: "AI engine", ok: true, detail: `${instance.displayName} answers; voice turns go to it as text.` };
}

export function speechCheck(status: { voice: { mode: string; configured: boolean; stt?: string | null; tts?: string | null } } | "forbidden" | "unavailable" | null, openConnections: () => void): VoiceCheck {
  const title = "Speech service";
  if (status === null) return { id: "speech", title, ok: null, detail: "Checking speech-to-text and text-to-speech…" };
  if (status === "forbidden") return { id: "speech", title, ok: false, detail: "Voice calls in this workspace need owner or admin access. Ask the workspace owner." };
  if (status === "unavailable") return { id: "speech", title, ok: false, detail: "This workspace's voice service did not answer. Reload, or update AIKINGBOT." };
  if (status.voice.mode === "offline-scripted") return { id: "speech", title, ok: true, detail: "Offline test service: scripted transcript and tone, no real speech recognition." };
  if (status.voice.configured) {
    const source = status.voice.stt === "openai" ? "OpenAI speech with this workspace's key (billed by OpenAI)" : "the speech service set up by the workspace operator";
    return { id: "speech", title, ok: true, detail: `Speech-to-text → your agent → text-to-speech, using ${source}.` };
  }
  return { id: "speech", title, ok: false, detail: "Your engine answers in text. To talk with it, the workspace needs speech-to-text and text-to-speech: add an OpenAI API key in Connections (billed by OpenAI per minute), or ask the operator to configure a speech service.", fix: { label: "Open Connections", run: openConnections } };
}

export function platformCheck(secure: boolean, media: boolean): VoiceCheck {
  return secure && media
    ? { id: "platform", title: "This device", ok: true, detail: "Audio capture and playback are available." }
    : { id: "platform", title: "This device", ok: false, detail: "Calls need the AIKINGBOT app or the workspace opened at its https address in a current browser." };
}

export function microphoneCheck(permission: PermissionState | "unknown" | null, request: () => void): VoiceCheck {
  const title = "Microphone";
  if (permission === null) return { id: "microphone", title, ok: null, detail: "Checking microphone permission…" };
  if (permission === "granted") return { id: "microphone", title, ok: true, detail: "Allowed." };
  if (permission === "denied") return { id: "microphone", title, ok: false, detail: "Microphone access is blocked. On Windows: Settings → Privacy & security → Microphone, allow desktop apps; in a browser, allow it in the site settings. Then try again.", fix: { label: "Try again", run: request } };
  return { id: "microphone", title, ok: false, detail: "AIKINGBOT will ask to use your microphone.", fix: { label: "Allow microphone", run: request } };
}

function useVoiceReadiness(bot: Bot, open: boolean) {
  const { dispatch } = useStore();
  const [instances, setInstances] = useState<InstanceInfo[] | null>(null);
  const [status, setStatus] = useState<Parameters<typeof speechCheck>[0]>(null);
  const [permission, setPermission] = useState<PermissionState | "unknown" | null>(null);
  const [round, setRound] = useState(0);
  const recheck = () => setRound((value) => value + 1);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void api<{ instances: InstanceInfo[] }>("/api/instances").then((value) => { if (active) setInstances(value.instances ?? []); }).catch(() => { if (active) setInstances([]); });
    void api<{ voice: { mode: string; configured: boolean; stt?: string | null; tts?: string | null } }>("/api/aiking/status")
      .then((value) => { if (active) setStatus(value); })
      .catch((cause: { status?: number }) => { if (active) setStatus(cause?.status === 403 ? "forbidden" : "unavailable"); });
    const query = navigator.permissions?.query({ name: "microphone" as PermissionName });
    if (!query) setPermission("unknown");
    else void query.then((result) => { if (!active) return; setPermission(result.state); result.onchange = () => setPermission(result.state); }).catch(() => { if (active) setPermission("unknown"); });
    return () => { active = false; };
  }, [open, round]);
  const requestMicrophone = () => {
    void navigator.mediaDevices?.getUserMedia({ audio: true }).then((stream) => { stream.getTracks().forEach((track) => track.stop()); setPermission("granted"); }).catch(() => setPermission("denied"));
  };
  const openSettings = (section: "engines" | "connections") => dispatch({ type: "toggleAppSettings", open: true, section });
  const checks = [
    platformCheck(globalThis.isSecureContext !== false, Boolean(navigator.mediaDevices?.getUserMedia)),
    microphoneCheck(permission, requestMicrophone),
    engineCheck(bot, instances, () => openSettings("engines")),
    speechCheck(status, () => openSettings("connections")),
  ];
  // The microphone prompt is part of starting a call; only a refusal blocks it.
  const blocking = checks.filter((check) => check.ok === false && !(check.id === "microphone" && permission !== "denied"));
  return { checks, ready: checks.every((check) => check.ok !== null || check.id === "microphone") && blocking.length === 0, recheck };
}

function VoiceChecks({ checks }: { checks: VoiceCheck[] }) {
  return (
    <ul aria-label="Voice call readiness" className="space-y-2 rounded-xl border border-hairline p-3 text-sm">
      {checks.map((check) => (
        <li key={check.id} data-voice-check={check.id} data-voice-check-ok={check.ok === null ? "pending" : String(check.ok)} className="flex gap-2.5">
          {check.ok === null ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-ink-tertiary" /> : check.ok ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
          <div className="min-w-0 flex-1">
            <div className="font-medium">{check.title}</div>
            <div className="text-xs leading-relaxed text-ink-secondary">{check.detail}</div>
            {check.ok === false && check.fix && <button type="button" onClick={check.fix.run} className="mt-1.5 rounded-md bg-raised px-2.5 py-1 text-xs font-medium hover:bg-raised-hover">{check.fix.label}</button>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function VoiceCallHost() {
  const current = useSyncExternalStore(subscribe, getTarget);
  return current ? <VoiceCall key={`${current.bot.id}:${current.bot.threadId}`} target={current} /> : null;
}

function VoiceCall({ target: current }: { target: CallTarget }) {
  const [microphone, setMicrophone] = useState(() => readPreference("microphone"));
  const [speaker, setSpeaker] = useState(() => readPreference("speaker"));
  const [endpoint, setEndpoint] = useState(() => readPreference("endpoint"));
  const [mode, setMode] = useState(() => readPreference("mode") === "websocket" ? "websocket" : "local");
  const readiness = useVoiceReadiness(current.bot, current.open);
  const [testing, setTesting] = useState(false);
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
  const start = (test = false) => {
    setDeviceError("");
    if (providerBusy) return;
    setTesting(test);
    if (!test && mode === "local" && !readiness.ready) { readiness.recheck(); return; }
    let url = "";
    if (!test && mode === "websocket") {
      try { url = voiceSocketUrl(endpoint); } catch (cause) { setDeviceError(cause instanceof Error ? cause.message : "Enter a voice server URL."); return; }
    }
    const next = new VoiceSession(test ? createLoopbackTransport : () => new WebSocketVoiceTransport(mode === "local" ? async () => {
      const result = await api<{ ticket: string; path: string }>("/api/aiking/voice/ticket", { method: "POST", body: JSON.stringify({ botId: current.bot.id, threadId: current.bot.threadId }) });
      const socket = new URL(result.path, location.href); socket.protocol = location.protocol === "https:" ? "wss:" : "ws:"; socket.searchParams.set("ticket", result.ticket); return socket.href;
    } : url), new WebAudioCapture(), new WebAudioPlayback());
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
        {mode === "local" && <VoiceChecks checks={readiness.checks} />}
        <details open={mode !== "local"} className="text-sm">
          <summary className="cursor-pointer text-ink-secondary">Advanced voice options</summary>
          <div className="mt-2 space-y-2">
            <label className="block space-y-1"><span className="text-ink-secondary">Voice service</span><select aria-label="Voice service" disabled={active} value={mode} onChange={(event) => choose("mode", event.target.value, setMode)} className="w-full rounded-lg border border-hairline bg-raised p-2"><option value="local">This workspace's voice service</option><option value="websocket">External AIKING Core voice server</option></select></label>
            {mode === "websocket" && <label className="block space-y-1"><span className="text-ink-secondary">Voice server URL</span><input aria-label="Voice server URL" placeholder="wss://core.example/v1/voice/sessions" disabled={active} value={endpoint} onChange={(event) => choose("endpoint", event.target.value, setEndpoint)} className="w-full rounded-lg border border-hairline bg-raised p-2" /></label>}
          </div>
        </details>
        {testing && active && <p role="status" className="text-xs text-ink-tertiary">Device test: a scripted transcript and a tone check your microphone and speaker. No AI or speech service is used.</p>}
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
          </> : <>
            <button type="button" disabled={providerBusy || (mode === "local" && !readiness.ready)} onClick={() => start()} className="flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-medium text-on-accent disabled:opacity-40"><Phone className="size-4" />{phase === "idle" || testing ? "Start voice call" : "Call again"}</button>
            <button type="button" disabled={providerBusy} onClick={() => start(true)} className="rounded-full bg-raised px-4 py-3 text-sm hover:bg-raised-hover disabled:opacity-40">Test microphone and speaker</button>
          </>}
        </div>
        {!active && <details className="border-t border-hairline pt-3 text-sm text-ink-secondary"><summary className="cursor-pointer">Other call modes: native realtime (OpenAI Live) and on-device speech</summary><div className="mt-3"><ProviderCallButton bot={current.bot} placement="composer" /></div></details>}
        <output data-voice-frames={snapshot.framesSent} data-voice-interruptions={snapshot.interruptions} data-voice-reconnects={snapshot.reconnects} className="sr-only">{snapshot.framesSent} audio frames sent</output>
      </div>
    </dialog>, document.body,
  );
}

function DeviceSelect({ label, kind, value, devices, disabled, onChange }: { label: string; kind: MediaDeviceKind; value: string; devices: MediaDeviceInfo[]; disabled: boolean; onChange: (id: string) => void }) {
  const choices = devices.filter((device) => device.kind === kind && device.deviceId !== "default");
  return <label className="block space-y-1 text-sm"><span className="text-ink-secondary">{label}</span><select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-hairline bg-raised p-2"><option value="">System default</option>{value && !choices.some((device) => device.deviceId === value) && <option value={value}>Previously selected (unavailable)</option>}{choices.map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${i + 1}`}</option>)}</select></label>;
}
