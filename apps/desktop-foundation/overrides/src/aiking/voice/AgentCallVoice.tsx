// Copyright (c) 2026 AIKING.
// Agent settings → Voice → Voice calls: this agent's own call voice, or why its model cannot take a call.
import { useEffect, useState } from "react";
import type { Bot } from "@/state/store";
import { agentRealtimeStatus, saveAgentVoice, type AgentRealtimeStatus } from "./realtime-call";
import { voiceLabel } from "./RealtimeCodexCall";
import { at } from "../strings";

export function AgentCallVoice({ bot }: { bot: Bot }) {
  const [status, setStatus] = useState<AgentRealtimeStatus | { forbidden: true } | null>(null);
  const [voice, setVoice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void agentRealtimeStatus(bot.id).then((next) => {
      if (!live) return;
      setStatus(next);
      if ("agent" in next && next.agent) setVoice(next.agent.voice);
    });
    return () => { live = false; };
  }, [bot.id, bot.modelSelection?.instanceId]);
  if (!status || "forbidden" in status) return null;
  const voices = status.voices ?? [];
  const supported = status.agent?.supported !== false;
  const choose = async (next: string) => {
    const previous = voice;
    setVoice(next); setSaving(true); setError("");
    try { await saveAgentVoice(bot.id, next); } catch (cause) { setVoice(previous); setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSaving(false); }
  };
  return (
    <div className="rounded-xl bg-card p-4" data-agent-call-voice>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[15px] font-medium text-ink">{at("call.voiceCalls")}</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            {!supported ? status.reason : status.available ? at("call.agentVoiceHint", { name: bot.name }) : status.reason}
          </div>
        </div>
        {supported && status.available && voices.length > 0 && (
          <select aria-label={at("call.agentVoiceAria", { name: bot.name })} data-agent-call-voice-select value={voices.includes(voice) ? voice : ""} disabled={saving} onChange={(event) => void choose(event.target.value)} className="shrink-0 rounded-lg border border-hairline bg-raised px-2 py-1.5 text-[13px]">
            <option value="">{at("call.default")}</option>
            {voices.map((name) => <option key={name} value={name}>{voiceLabel(name)}</option>)}
          </select>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
