// Copyright (c) 2026 AIKING.
// Realtime voice with the workspace's Codex (ChatGPT) sign-in. Before the call: choose a voice and call. During the
// call: a small floating card says who you are talking to and whether the agent is listening, speaking or working;
// the work itself shows in the agent's conversation, like any other turn.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Mic, MicOff, PhoneOff, Radio } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { BotAvatar } from "@/components/Avatar";
import { clearRealtimeError, hangUpRealtimeCall, muteRealtimeCall, startRealtimeCall, useRealtimeCall, useRealtimeStatus } from "./realtime-call";
import { at } from "../strings";

/** Inside the call dialog: why realtime is unavailable, or a way to call again after an error. */
export function RealtimeCodexCall({ bot, onStarted }: { bot: Bot; onStarted(): void }) {
  const status = useRealtimeStatus();
  const call = useRealtimeCall();
  const { dispatch } = useStore();
  if (!status || "forbidden" in status) return null;
  const busy = call.phase !== "idle";
  const start = async () => {
    clearRealtimeError();
    dispatch({ type: "select", id: bot.id });
    if (await startRealtimeCall(bot, "")) onStarted();
  };
  return (
    <section aria-label={at("call.realtimeVoice")} data-realtime-voice className="space-y-3 rounded-xl border border-accent/40 p-3 text-sm">
      <div className="flex items-center gap-2">
        <Radio className="size-4 text-accent" aria-hidden="true" />
        <span className="flex-1 font-medium">{at("call.realtimeWith", { name: bot.name })}</span>
      </div>
      <p className="text-ink-secondary">
        {status.available
          ? at("call.realtimeHint", { name: bot.name })
          : status.reason}
      </p>
      {call.error && call.phase === "idle" && <p role="alert" className="text-danger">{call.error}</p>}
      <button type="button" disabled={!status.available || busy} onClick={() => void start()} className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 font-medium text-on-accent disabled:opacity-40" data-realtime-start>
        {call.phase === "connecting" ? <Loader2 className="size-4 animate-spin" /> : <Radio className="size-4" />}
        {call.phase === "connecting" ? at("call.connecting") : busy ? at("call.onCall") : at("call.startRealtime")}
      </button>
    </section>
  );
}

export function voiceLabel(voice: string): string {
  return voice ? voice[0]!.toUpperCase() + voice.slice(1) : at("call.default");
}

function elapsed(since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The only call UI while talking: who, what the agent is doing, mute and hang up. */
export function RealtimeCallWidget() {
  const call = useRealtimeCall();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (call.phase !== "active") return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [call.phase]);
  if (call.phase === "idle" && call.notice) {
    return createPortal(<div role="status" data-realtime-notice className="fixed bottom-24 right-5 z-50 max-w-[300px] rounded-xl border border-hairline bg-panel px-3 py-2 text-sm text-ink shadow-xl">{call.notice}</div>, document.body);
  }
  if (call.phase === "idle" || !call.bot) return null;
  const name = call.bot.name;
  const line = call.phase === "connecting" ? at("call.connecting")
    : call.phase === "ending" ? at("call.ending")
    : call.working ? at("call.working", { name })
    : call.speaking ? at("call.speaking", { name })
    : call.muted ? at("call.muted") : at("call.listening");
  return createPortal(
    <div role="region" aria-label={at("call.with", { name })} data-realtime-call data-realtime-phase={call.phase} data-realtime-working={call.working ? "true" : "false"} className="fixed bottom-24 right-5 z-50 w-[300px] rounded-2xl border border-accent/40 bg-panel p-3 text-ink shadow-2xl">
      <div className="flex items-center gap-3">
        <div className={`rounded-full ${call.speaking ? "ring-2 ring-accent ring-offset-2 ring-offset-panel" : ""}`}><BotAvatar bot={call.bot} size={40} /></div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{name}{call.phase === "active" ? <span className="ml-1.5 text-xs font-normal text-ink-tertiary">{elapsed(call.startedAt, now)}</span> : null}</div>
          <div role="status" className="flex items-center gap-1.5 truncate text-xs text-ink-secondary">
            {call.working ? <Loader2 className="size-3 shrink-0 animate-spin text-accent" aria-hidden="true" /> : <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${call.phase === "active" ? "bg-accent" : "bg-ink-tertiary"}`} />}
            {line}
          </div>
        </div>
      </div>
      {call.working && <p className="mt-2 line-clamp-2 text-xs text-ink-secondary" title={call.working}>{call.working}</p>}
      {!call.working && call.lastResult && !call.lastResult.ok && <p className="mt-2 line-clamp-2 text-xs text-warning">{call.lastResult.summary}</p>}
      {call.error && <p role="alert" className="mt-2 text-xs text-danger">{call.error}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" aria-pressed={call.muted} aria-label={call.muted ? at("call.unmute") : at("call.mute")} disabled={call.phase !== "active"} onClick={() => muteRealtimeCall(!call.muted)} className="rounded-full bg-raised p-2.5 hover:bg-raised-hover disabled:opacity-40">{call.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}</button>
        <button type="button" aria-label={at("call.hangUpRealtime")} disabled={call.phase === "ending"} onClick={() => void hangUpRealtimeCall()} className="flex items-center gap-2 rounded-full bg-danger px-4 py-2 text-sm text-white"><PhoneOff className="size-4" />{at("call.hangUp")}</button>
      </div>
    </div>, document.body,
  );
}
