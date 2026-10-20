// Copyright (c) 2026 AIKING.
// Settings → Appearance → Voice calls: the voice agents use in realtime calls, saved for the workspace.
import { useState } from "react";
import { api, useStore } from "@/state/store";
import type { LiveSettings } from "../../../shared/wire";
import { Card } from "@/components/SettingsPrimitives";
import { useRealtimeStatus } from "./realtime-call";
import { voiceLabel } from "./RealtimeCodexCall";

export function RealtimeVoiceSettings() {
  const { state, dispatch } = useStore();
  const status = useRealtimeStatus();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!status || "forbidden" in status) return null;
  const voices = status.voices ?? [];
  const current = state.config?.live?.voice ?? "";
  const save = async (voice: string) => {
    setSaving(true); setError("");
    try {
      const body = await api<{ live: LiveSettings }>("/api/live/settings", { method: "PATCH", body: JSON.stringify({ voice }) });
      if (state.config) dispatch({ type: "configStatus", config: { ...state.config, live: body.live } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setSaving(false); }
  };
  return (
    <Card title="Voice calls" subtitle={status.available ? "Press the phone button on an agent to talk with it. Its work shows in the chat while you talk." : status.reason ?? ""}>
      {status.available && (
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span>Agent voice</span>
          <select aria-label="Agent voice" data-settings-realtime-voice value={voices.includes(current) ? current : ""} disabled={saving} onChange={(event) => void save(event.target.value)} className="rounded-lg border border-hairline bg-raised px-2 py-1.5">
            <option value="">Default</option>
            {voices.map((voice) => <option key={voice} value={voice}>{voiceLabel(voice)}</option>)}
          </select>
        </label>
      )}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </Card>
  );
}
