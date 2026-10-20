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
import { RealtimeCallWidget, RealtimeCodexCall } from "./RealtimeCodexCall";
import { agentRealtimeStatus, showRealtimeNotice, startRealtimeCall, useRealtimeCall, voiceUnavailableMessage } from "./realtime-call";
import { createLoopbackTransport, voiceSocketUrl, WebSocketVoiceTransport } from "./transports";
import { at } from "../strings";

type CallTarget = { bot: Bot; open: boolean };
let target: CallTarget | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getTarget = () => target;
function setTarget(next: CallTarget | null) { target = next; listeners.forEach((listener) => listener()); }

/** One press calls: realtime voice when this agent's model can, otherwise why not, or the dialog with what is missing. */
export function VoiceCallButton({ bot }: { bot: Bot; placement?: "composer" | "header" }) {
  const { dispatch } = useStore();
  const call = useRealtimeCall();
  const [unsupported, setUnsupported] = useState(false);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const statusKey = JSON.stringify([bot.id, bot.modelSelection]);
  useEffect(() => {
    let live = true;
    void agentRealtimeStatus(bot.id).then((status) => {
      if (!live) return;
      setUnsupported("agent" in status && status.agent?.supported === false);
      setReadyFor("available" in status && status.available ? statusKey : null);
    });
    return () => { live = false; };
  }, [bot.id, statusKey]);
  const press = async () => {
    if (call.phase !== "idle") return;
    if (target) { setTarget({ ...target, open: true }); return; }
    const status = await agentRealtimeStatus(bot.id);
    if ("agent" in status && status.agent?.supported === false) { setUnsupported(true); showRealtimeNotice(voiceUnavailableMessage()); return; }
    if ("available" in status && status.available) {
      dispatch({ type: "select", id: bot.id });
      if (await startRealtimeCall(bot, "")) return;
    }
    setTarget({ bot, open: true });
  };
  const onCall = call.phase !== "idle" && call.bot?.id === bot.id;
  if (readyFor !== statusKey && !onCall) return null;
  const label = unsupported ? voiceUnavailableMessage() : onCall ? at("vc.onCallWith", { name: bot.name }) : at("vc.callWith", { name: bot.name });
  return <button type="button" aria-label={label} aria-pressed={onCall} aria-disabled={unsupported || undefined} title={unsupported ? voiceUnavailableMessage() : onCall ? at("call.onCall") : at("vc.voiceCall")} data-voice-call-button data-voice-unsupported={unsupported ? "true" : undefined} disabled={call.phase !== "idle"} className={`flex size-7 items-center justify-center rounded-full hover:bg-raised hover:text-ink disabled:opacity-60 ${onCall ? "text-accent" : unsupported ? "text-ink-tertiary opacity-60" : "text-ink-secondary"}`} onClick={() => void press()}>{call.phase === "connecting" && call.bot?.id === bot.id ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}</button>;
}

const labels = new Proxy({} as Record<VoicePhase["phase"], string>, {
  get: (_target, phase: string) => at(`vc.phase.${phase}` as Parameters<typeof at>[0]),
});
function readPreference(key: string) { try { return localStorage.getItem(`aiking-voice-${key}`) ?? ""; } catch { return ""; } }
function savePreference(key: string, value: string) { try { localStorage.setItem(`aiking-voice-${key}`, value); } catch {} }

/** One dependency of a call and what fixes it. `ok: null` is still being checked. */
export type VoiceCheck = { id: "platform" | "microphone" | "engine" | "speech"; title: string; ok: boolean | null; detail: string; fix?: { label: string; run: () => void } };

export function engineCheck(bot: Bot, instances: InstanceInfo[] | null, openEngines: () => void): VoiceCheck {
  const instanceId = bot.modelSelection?.instanceId;
  const instance = instances?.find((candidate) => candidate.instanceId === instanceId);
  if (!instances) return { id: "engine", title: at("vc.engine"), ok: null, detail: at("vc.engineChecking") };
  if (!instance) return { id: "engine", title: at("vc.engine"), ok: false, detail: at("vc.engineNone", { name: bot.name }), fix: { label: at("vc.engineConnect"), run: openEngines } };
  if (instance.snapshot.state !== "available" || instance.snapshot.authenticated === false) {
    return { id: "engine", title: at("vc.engine"), ok: false, detail: `${at("vc.engineSignIn", { engine: instance.displayName, name: bot.name })} ${instance.snapshot.reason ?? ""}`.trim(), fix: { label: at("vc.engineConnectNamed", { engine: instance.displayName }), run: openEngines } };
  }
  return { id: "engine", title: at("vc.engine"), ok: true, detail: at("vc.engineOk", { engine: instance.displayName }) };
}

export function speechCheck(status: { voice: { mode: string; configured: boolean; stt?: string | null; tts?: string | null } } | "forbidden" | "unavailable" | null, openConnections: () => void): VoiceCheck {
  const title = at("vc.speech");
  if (status === null) return { id: "speech", title, ok: null, detail: at("vc.speechChecking") };
  if (status === "forbidden") return { id: "speech", title, ok: false, detail: at("vc.speechForbidden") };
  if (status === "unavailable") return { id: "speech", title, ok: false, detail: at("vc.speechUnavailable") };
  if (status.voice.mode === "offline-scripted") return { id: "speech", title, ok: true, detail: at("vc.speechOffline") };
  if (status.voice.configured) {
    const source = status.voice.stt === "openai" ? at("vc.sourceOpenai") : at("vc.sourceOperator");
    return { id: "speech", title, ok: true, detail: at("vc.speechOk", { source }) };
  }
  return { id: "speech", title, ok: false, detail: at("vc.speechMissing"), fix: { label: at("vc.openConnections"), run: openConnections } };
}

export function platformCheck(secure: boolean, media: boolean): VoiceCheck {
  return secure && media
    ? { id: "platform", title: at("vc.device"), ok: true, detail: at("vc.deviceOk") }
    : { id: "platform", title: at("vc.device"), ok: false, detail: at("vc.deviceNo") };
}

export function microphoneCheck(permission: PermissionState | "unknown" | null, request: () => void): VoiceCheck {
  const title = at("vc.microphone");
  if (permission === null) return { id: "microphone", title, ok: null, detail: at("vc.micChecking") };
  if (permission === "granted") return { id: "microphone", title, ok: true, detail: at("vc.micAllowed") };
  if (permission === "denied") return { id: "microphone", title, ok: false, detail: at("vc.micBlocked"), fix: { label: at("vc.tryAgain"), run: request } };
  return { id: "microphone", title, ok: false, detail: at("vc.micAsk"), fix: { label: at("vc.micAllow"), run: request } };
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
    <ul aria-label={at("vc.readiness")} className="space-y-2 rounded-xl border border-hairline p-3 text-sm">
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
  return <>
    {current ? <VoiceCall key={`${current.bot.id}:${current.bot.threadId}`} target={current} /> : null}
    <RealtimeCallWidget />
  </>;
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
    const refresh = () => { void navigator.mediaDevices?.enumerateDevices().then((list) => { if (mounted) setDevices(list); }).catch(() => { if (mounted) setDeviceError(at("vc.deviceNames")); }); };
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
      // The browser's own "Failed to construct 'URL'" means nothing to a person; say what to enter instead.
      try { if (!endpoint.trim()) throw new Error("empty"); url = voiceSocketUrl(endpoint); } catch { setDeviceError(at("vc.enterUrl")); return; }
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
    <button type="button" aria-label={at("vc.return")} onClick={() => setTarget({ ...current, open: true })} className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-full border border-accent/40 bg-panel px-5 py-3 text-sm text-ink shadow-xl"><Phone className="size-4 text-accent" />{current.bot.name} · {labels[phase]}</button>, document.body,
  );
  return createPortal(
    <dialog ref={dialog} aria-label={at("vc.callWith", { name: current.bot.name })} onCancel={(event) => { event.preventDefault(); close(); }} className="m-auto w-[560px] max-w-[calc(100vw-32px)] rounded-2xl border border-hairline bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/60">
      <div className="flex items-center gap-3 border-b border-hairline p-5">
        <Phone className="size-5 text-accent" /><h2 className="flex-1 text-lg font-semibold">{at("vc.voiceCall")}</h2>
        {active && <button type="button" aria-label={at("vc.minimizeCall")} onClick={() => setTarget({ ...current, open: false })} className="rounded-lg px-3 py-1 text-sm text-ink-secondary hover:bg-raised">{at("vc.minimize")}</button>}
        <button type="button" aria-label={at("vc.closeCall")} onClick={close} className="rounded-lg p-2 hover:bg-raised"><X className="size-4" /></button>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-4"><BotAvatar bot={current.bot} size={56} /><div><div className="text-lg font-medium">{current.bot.name}</div><div role="status" data-voice-phase={phase} className="text-sm text-ink-secondary">{labels[phase]}{snapshot.status.phase === "reconnecting" ? ` (${at("vc.attempt", { n: snapshot.status.attempt })})` : ""}</div></div></div>
        <div className="grid grid-cols-2 gap-3">
          <DeviceSelect label={at("vc.microphone")} kind="audioinput" value={microphone} devices={devices} disabled={active} onChange={(value) => choose("microphone", value, setMicrophone)} />
          <DeviceSelect label={at("vc.speaker")} kind="audiooutput" value={speaker} devices={devices} disabled={active} onChange={(value) => choose("speaker", value, setSpeaker)} />
        </div>
        {!active && <RealtimeCodexCall bot={current.bot} onStarted={close} />}
        {mode === "local" && <VoiceChecks checks={readiness.checks} />}
        <details open={mode !== "local"} className="text-sm">
          <summary className="cursor-pointer text-ink-secondary">{at("vc.advanced")}</summary>
          <div className="mt-2 space-y-2">
            <label className="block space-y-1"><span className="text-ink-secondary">{at("vc.service")}</span><select aria-label={at("vc.service")} disabled={active} value={mode} onChange={(event) => choose("mode", event.target.value, setMode)} className="w-full rounded-lg border border-hairline bg-raised p-2"><option value="local">{at("vc.serviceLocal")}</option><option value="websocket">{at("vc.serviceExternal")}</option></select></label>
            {mode === "websocket" && <label className="block space-y-1"><span className="text-ink-secondary">{at("vc.serverUrl")}</span><input aria-label={at("vc.serverUrl")} placeholder="wss://core.example/v1/voice/sessions" disabled={active} value={endpoint} onChange={(event) => choose("endpoint", event.target.value, setEndpoint)} className="w-full rounded-lg border border-hairline bg-raised p-2" /></label>}
          </div>
        </details>
        {testing && active && <p role="status" className="text-xs text-ink-tertiary">{at("vc.deviceTest")}</p>}
        <div role="meter" aria-label={at("vc.level")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, snapshot.level * 5) * 100)} className="h-1.5 overflow-hidden rounded-full bg-raised"><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.min(1, snapshot.level * 5) * 100}%` }} /></div>
        {snapshot.status.phase === "error" && <p role="alert" data-voice-error={snapshot.status.error.code} className="text-sm text-danger">{snapshot.status.error.message}</p>}
        {deviceError && <p role="alert" className="text-sm text-danger">{deviceError}</p>}
        {providerBusy && <p role="status" className="text-sm text-warning">{at("vc.providerBusy")}</p>}
        <div ref={transcript} role="log" aria-label={at("vc.transcript")} aria-live="polite" className="max-h-48 space-y-2 overflow-y-auto rounded-xl bg-raised p-3 text-sm">
          {snapshot.transcripts.length ? snapshot.transcripts.map((line, i) => <p key={i}><span className="font-medium text-accent">{line.role === "user" ? at("vc.you") : current.bot.name}: </span>{line.text}{!line.final && "…"}</p>) : <p className="text-ink-tertiary">{at("vc.conversationHere")}</p>}
        </div>
        <div className="flex items-center justify-center gap-3">
          {active ? <>
            <button type="button" aria-label={snapshot.muted ? at("call.unmute") : at("call.mute")} aria-pressed={snapshot.muted} onClick={() => session.mute(!snapshot.muted)} className="rounded-full bg-raised p-3 hover:bg-raised-hover">{snapshot.muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}</button>
            <button type="button" onClick={() => session.interrupt()} disabled={!["thinking", "agent-speaking"].includes(phase)} className="rounded-full bg-raised px-4 py-3 text-sm disabled:opacity-40">{at("vc.interrupt")}</button>
            <button type="button" aria-label={at("vc.hangUp")} onClick={() => session.finish()} className="rounded-full bg-danger p-3 text-white"><PhoneOff className="size-5" /></button>
          </> : <>
            <button type="button" disabled={providerBusy || (mode === "local" && !readiness.ready)} onClick={() => start()} className="flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-medium text-on-accent disabled:opacity-40"><Phone className="size-4" />{phase === "idle" || testing ? at("vc.start") : at("vc.again")}</button>
            <button type="button" disabled={providerBusy} onClick={() => start(true)} className="rounded-full bg-raised px-4 py-3 text-sm hover:bg-raised-hover disabled:opacity-40">{at("vc.test")}</button>
          </>}
        </div>
        {!active && <details className="border-t border-hairline pt-3 text-sm text-ink-secondary"><summary className="cursor-pointer">{at("vc.otherModes")}</summary><div className="mt-3"><ProviderCallButton bot={current.bot} placement="composer" /></div></details>}
        <output data-voice-frames={snapshot.framesSent} data-voice-interruptions={snapshot.interruptions} data-voice-reconnects={snapshot.reconnects} className="sr-only">{at("vc.frames", { n: snapshot.framesSent })}</output>
      </div>
    </dialog>, document.body,
  );
}

function DeviceSelect({ label, kind, value, devices, disabled, onChange }: { label: string; kind: MediaDeviceKind; value: string; devices: MediaDeviceInfo[]; disabled: boolean; onChange: (id: string) => void }) {
  const choices = devices.filter((device) => device.kind === kind && device.deviceId !== "default");
  return <label className="block space-y-1 text-sm"><span className="text-ink-secondary">{label}</span><select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-hairline bg-raised p-2"><option value="">{at("vc.systemDefault")}</option>{value && !choices.some((device) => device.deviceId === value) && <option value={value}>Previously selected (unavailable)</option>}{choices.map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${i + 1}`}</option>)}</select></label>;
}
