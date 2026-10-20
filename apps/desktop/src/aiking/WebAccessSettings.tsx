// Copyright (c) 2026 AIKING.
// Settings → Account → Use on the web: join this computer to the AIKINGBOT web relay with a one-time code, so its owner can
// open the same agents from any browser. Chats and files stay on this computer; the relay only passes requests through.
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/SettingsPrimitives";
import { api } from "@/state/store";
import { at } from "./strings";

type Status = { configured: boolean; state: "off" | "connecting" | "online"; name?: string; relayUrl: string; canJoinWithAccount?: boolean };
const relayEmail = () => { try { return decodeURIComponent(/(?:^|;\s*)rl_email=([^;]*)/.exec(document.cookie)?.[1] ?? ""); } catch { return ""; } };

export function WebAccessSettings() {
  const viaWeb = relayEmail();
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState(() => at("web.defaultName"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setStatus(await api<Status>("/api/aiking/relay/status")); } catch { /* shown as unavailable below */ } }, []);
  useEffect(() => {
    if (viaWeb) return;
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load, viaWeb]);
  if (viaWeb) return <Card title={at("web.title")} subtitle={at("web.viaWeb", { email: viaWeb })} />;
  if (!status) return <Card title={at("web.title")} subtitle={at("account.loading")} />;
  const connect = async () => {
    setBusy(true); setError("");
    try { setStatus(await api<Status>("/api/aiking/relay/enroll", { method: "POST", body: JSON.stringify({ code: code.trim(), name: name.trim() }) })); setCode(""); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : at("web.error")); }
    setBusy(false);
  };
  const joinWithAccount = async () => {
    setBusy(true); setError("");
    try { setStatus(await api<Status>("/api/aiking/relay/enroll-account", { method: "POST", body: JSON.stringify({ name: name.trim() }) })); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : at("web.error")); }
    setBusy(false);
  };
  const disconnect = async () => {
    if (!window.confirm(at("web.confirmDisconnect"))) return;
    setBusy(true); setError("");
    try { setStatus(await api<Status>("/api/aiking/relay", { method: "DELETE" })); } catch { setError(at("web.error")); }
    setBusy(false);
  };
  if (status.configured) {
    return (
      <Card title={at("web.title")} subtitle={status.state === "online" ? at("web.online", { name: status.name ?? "" }) : at("web.connecting", { name: status.name ?? "" })}>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">{at("web.help")}</p>
        <a href={status.relayUrl} target="_blank" rel="noreferrer" className="mt-3 block w-fit text-[13px] text-accent underline">{at("web.openSite")}</a>
        {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
        <button type="button" disabled={busy} onClick={() => void disconnect()} className="ui-button mt-4 w-fit">{at("web.disconnect")}</button>
      </Card>
    );
  }
  const ready = /^[A-Za-z0-9-]{8,24}$/.test(code.trim());
  if (status.canJoinWithAccount) {
    return (
      <Card title={at("web.title")} subtitle={at("web.subtitle")}>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">{at("web.accountHelp")}</p>
        <label className="mt-3 block text-[12.5px] text-ink-secondary">{at("web.nameLabel")}
          <input value={name} onChange={event => setName(event.target.value)} maxLength={60}
            className="mt-1 block w-full max-w-xs rounded-lg border border-hairline/40 bg-card px-3 py-2 text-[14px] text-ink" />
        </label>
        {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
        <button type="button" disabled={busy} onClick={() => void joinWithAccount()} data-web-join className="mt-4 w-fit rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50">{at("web.turnOn")}</button>
        <a href={status.relayUrl} target="_blank" rel="noreferrer" className="mt-3 block w-fit text-[13px] text-accent underline">{at("web.openSite")}</a>
      </Card>
    );
  }
  return (
    <Card title={at("web.title")} subtitle={at("web.subtitle")}>
      <ol className="mt-3 list-decimal pl-5 text-[13px] leading-relaxed text-ink-secondary">
        <li>{at("web.step1")} <a href={status.relayUrl} target="_blank" rel="noreferrer" className="text-accent underline">{status.relayUrl.replace(/^https?:\/\//, "")}</a></li>
        <li>{at("web.step2")}</li>
        <li>{at("web.step3")}</li>
      </ol>
      <label className="mt-4 block text-[12.5px] text-ink-secondary">{at("web.codeLabel")}
        <input value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="ABCD-EFGH-JKLM" autoComplete="off" spellCheck={false} data-web-code
          className="mt-1 block w-full max-w-xs rounded-lg border border-hairline/40 bg-card px-3 py-2 font-mono text-[14px] tracking-wider text-ink" />
      </label>
      <label className="mt-3 block text-[12.5px] text-ink-secondary">{at("web.nameLabel")}
        <input value={name} onChange={event => setName(event.target.value)} maxLength={60}
          className="mt-1 block w-full max-w-xs rounded-lg border border-hairline/40 bg-card px-3 py-2 text-[14px] text-ink" />
      </label>
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      <button type="button" disabled={busy || !ready} onClick={() => void connect()} className="mt-4 w-fit rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50">{at("web.connect")}</button>
    </Card>
  );
}
