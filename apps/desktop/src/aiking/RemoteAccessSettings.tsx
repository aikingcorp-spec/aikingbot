// Copyright (c) 2026 AIKING.
// Settings → Remote access. A switch, off by default: on, this computer joins the AIKINGBOT web relay with the account it is signed
// in to, and the person can use the same agents from a phone or another computer through the web page. Off, the web loses control
// of this computer at once; AIKINGBOT here keeps working. Chats and files stay on this computer either way.
import { useCallback, useEffect, useState } from "react";
import { Card, Switch } from "@/components/SettingsPrimitives";
import { api } from "@/state/store";
import { DesktopSignIn } from "./DesktopSignIn";
import { at } from "./strings";

type Status = { configured: boolean; state: "off" | "connecting" | "online"; name?: string; relayUrl: string; canJoinWithAccount?: boolean };
const relayEmail = () => { try { return decodeURIComponent(/(?:^|;\s*)rl_email=([^;]*)/.exec(document.cookie)?.[1] ?? ""); } catch { return ""; } };

export function RemoteAccessSettings() {
  const viaWeb = relayEmail();
  const [status, setStatus] = useState<Status | null>(null);
  const [name, setName] = useState(() => at("web.defaultName"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const load = useCallback(async () => { try { setStatus(await api<Status>("/api/aiking/relay/status")); } catch { /* unavailable */ } }, []);
  useEffect(() => {
    if (viaWeb) return;
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load, viaWeb]);
  if (viaWeb) return <Card title={at("web.title")} subtitle={at("web.viaWeb", { email: viaWeb })} />;
  if (!status) return <Card title={at("web.title")} subtitle={at("account.loading")} />;

  const join = async () => {
    setBusy(true); setError("");
    try { setStatus(await api<Status>("/api/aiking/relay/enroll-account", { method: "POST", body: JSON.stringify({ name: name.trim() }) })); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : at("web.error")); }
    setBusy(false);
  };
  const leave = async () => {
    if (!window.confirm(at("web.confirmDisconnect"))) return;
    setBusy(true); setError("");
    try { setStatus(await api<Status>("/api/aiking/relay", { method: "DELETE" })); } catch { setError(at("web.error")); }
    setBusy(false);
  };
  const toggle = () => {
    if (busy) return;
    if (status.configured) { void leave(); return; }
    if (!status.canJoinWithAccount) { setSigningIn(true); return; }
    void join();
  };
  const stateText = !status.configured ? at("web.statusOff")
    : status.state === "online" ? at("web.online", { name: status.name ?? "" }) : at("web.connecting", { name: status.name ?? "" });

  return (
    <Card title={at("web.title")} subtitle={at("web.subtitle")}>
      <div className="mt-4 flex items-center justify-between gap-4 rounded-xl bg-card p-4">
        <div className="min-w-0">
          <div className="text-[15px] font-medium text-ink">{at("web.toggleLabel")}</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary" data-remote-state={status.configured ? status.state : "off"}>{stateText}</div>
        </div>
        <Switch checked={status.configured} disabled={busy} aria-label={at("web.toggleLabel")} data-remote-toggle onClick={toggle} />
      </div>
      {!status.configured && !signingIn && (
        <label className="mt-3 block text-[12.5px] text-ink-secondary">{at("web.nameLabel")}
          <input value={name} onChange={event => setName(event.target.value)} maxLength={60}
            className="mt-1 block w-full max-w-xs rounded-lg border border-hairline/40 bg-card px-3 py-2 text-[14px] text-ink" />
        </label>
      )}
      {signingIn && !status.configured && (
        <div className="mt-3 max-w-sm">
          <p className="mb-1 text-[13px] text-ink-secondary">{at("web.needSignIn")}</p>
          <DesktopSignIn askName={false} onSignedIn={async () => { setSigningIn(false); await load(); await join(); }} />
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">{status.configured ? at("web.help") : at("web.offNote")}</p>
      {status.configured && <a href={status.relayUrl} target="_blank" rel="noreferrer" className="mt-2 block w-fit text-[13px] text-accent underline">{at("web.openSite")}</a>}
    </Card>
  );
}
