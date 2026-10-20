// Copyright (c) 2026 AIKING.
// What a signed-in account sees before it has a workspace: its own workspaces and linked computers, and how to add one.
// Everything listed comes from the server's checks for this account; nothing here opens a workspace by itself.
import { useCallback, useEffect, useState } from "react";
import { LogOut, Monitor, RefreshCw } from "lucide-react";
import { defaultDeviceLabel } from "../../lib/session";
import { at } from "../strings";
import {
  createLinkCode, enterWorkspace, lastSeenText, readAccountState, signOutAccount, unlinkDevice,
  type AccountState,
} from "./account-api";

const WEBSITE = "https://aikingxbot.com/";
const card = "mt-5 rounded-xl border border-hairline/40 bg-raised/40 p-5";
const primary = "rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-50";
const secondary = "rounded-md border border-hairline/50 px-3 py-1.5 text-[13px] text-ink hover:bg-raised disabled:opacity-50";

export function AccountShell({ initial }: { initial: AccountState }) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ code: string; expiresAt: number } | null>(null);

  const refresh = useCallback(async () => {
    const next = await readAccountState();
    if (!next) { location.replace("/pair"); return; }
    setState(next);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function signOut() {
    setBusy("signout");
    await signOutAccount();
    location.replace("/pair");
  }

  async function open(id: string) {
    setBusy(`open:${id}`);
    setError(null);
    const result = await enterWorkspace(id, defaultDeviceLabel());
    if (result.ok) {
      const url=Reflect.get(Object(result.body),"url");
      location.replace(typeof url==="string"&&/^\/servers\/[a-f0-9-]{36}\/$/.test(url)?url:"/");
      return;
    }
    setBusy(null);
    setError(result.error);
    void refresh();
  }

  async function newLinkCode() {
    setBusy("link");
    setError(null);
    const result = await createLinkCode();
    setBusy(null);
    if (result.ok) setLink({ code: result.code, expiresAt: result.expiresAt });
    else setError(result.error);
  }

  async function unlink(id: string, name: string) {
    if (!confirm(at("account.unlinkConfirm", { name }))) return;
    setBusy(`unlink:${id}`);
    const result = await unlinkDevice(id);
    setBusy(null);
    if (!result.ok) setError(result.error);
    void refresh();
  }

  const empty = state.workspaces.length === 0;
  return (
    <main className="min-h-screen bg-app px-6 py-8 text-ink" data-account-shell>
      <div className="mx-auto w-full max-w-[720px]">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{at("account.label")}</p>
            <h1 className="mt-0.5 truncate text-[20px] font-semibold" data-account-email>{state.account.email}</h1>
          </div>
          <button type="button" onClick={signOut} disabled={busy === "signout"} className={`${secondary} flex items-center gap-1.5`} data-account-signout>
            <LogOut size={14} aria-hidden="true" /> {at("account.signOut")}
          </button>
        </header>
        {error ? <p role="alert" className="mt-4 text-[13px] text-danger">{error}</p> : null}

        <section className={card} aria-labelledby="account-workspaces">
          <h2 id="account-workspaces" className="text-[15px] font-semibold">{at("account.workspaces")}</h2>
          {empty ? (
            <div data-account-empty>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-secondary">
                {at("account.emptyA")}
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-secondary">
                {at("account.emptyB")}
              </p>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-hairline/30">
              {state.workspaces.map((workspace) => (
                <li key={workspace.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium">{workspace.name}</p>
                    <p className="text-[12.5px] text-ink-secondary">{workspace.role === "owner" ? at("account.owner") : at("account.member")}</p>
                  </div>
                  <button type="button" className={primary} disabled={busy !== null} onClick={() => void open(workspace.id)}>
                    {busy === `open:${workspace.id}` ? at("account.opening") : at("account.open")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card} aria-labelledby="account-computers">
          <div className="flex items-center justify-between gap-3">
            <h2 id="account-computers" className="text-[15px] font-semibold">{at("account.computers")}</h2>
            <button type="button" onClick={() => void refresh()} className="text-ink-secondary hover:text-ink" aria-label={at("account.refresh")} title={at("account.refresh")}>
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>
          {state.devices.length === 0 ? (
            <p className="mt-2 text-[13.5px] text-ink-secondary" data-account-no-devices>{at("account.noDevices")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-hairline/30" data-account-devices>
              {state.devices.map((device) => (
                <li key={device.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Monitor size={18} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium">{device.name}</p>
                      <p className="text-[12.5px] text-ink-secondary">
                        <span aria-hidden="true" className={`mr-1.5 inline-block size-2 rounded-full ${device.online ? "bg-[#28c840]" : "bg-ink-secondary/50"}`} />
                        {lastSeenText(device)}{device.platform ? ` · ${device.platform}` : ""}{device.appVersion ? ` · ${device.appVersion}` : ""}
                      </p>
                    </div>
                  </div>
                  <button type="button" className={secondary} disabled={busy !== null} onClick={() => void unlink(device.id, device.name)}>{at("account.unlink")}</button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 border-t border-hairline/30 pt-4">
            <h3 className="text-[13.5px] font-semibold">{at("account.linkTitle")}</h3>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-ink-secondary">
              <li>{at("account.step1a")} <a className="text-accent underline" href={WEBSITE} target="_blank" rel="noreferrer">{at("account.step1link")}</a>.</li>
              <li>{at("account.step2")}</li>
              <li>{at("account.step3")}</li>
            </ol>
            {link ? (
              <p className="mt-3 text-[13px]" data-account-link-code>
                {at("account.linkCode")} <span className="font-mono text-[16px] tracking-[0.12em]">{link.code}</span>
                <span className="text-ink-secondary"> · {at("account.expiresAt", { time: new Date(link.expiresAt).toLocaleTimeString() })}</span>
              </p>
            ) : null}
            <button type="button" className={`${primary} mt-3`} disabled={busy !== null} onClick={() => void newLinkCode()}>
              {busy === "link" ? at("account.creating") : link ? at("account.newCode") : at("account.createCode")}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
