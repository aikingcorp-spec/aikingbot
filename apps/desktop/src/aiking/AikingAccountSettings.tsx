// Copyright (c) 2026 AIKING.
import { useEffect, useState } from "react";
import { Card } from "@/components/SettingsPrimitives";
import { api } from "@/state/store";
import { DesktopSignIn } from "./DesktopSignIn";
import { platformEnabled } from "./platform-transport";
import { at } from "./strings";

type Identity = { email: string } | null;

/**
 * Settings → Account. This is the person's AIKING account (email one-time code), not the company/admin sign-in of the
 * original app. Inside a Server window it shows who is signed in and lets them sign out; on this computer alone it
 * explains what an account adds and offers the sign-in the first-run screen already offers.
 */
export function AikingAccountSettings() {
  const hosted = platformEnabled();
  const desktop = !hosted && Boolean(window.ogb?.workspaces?.connectAiking);
  const [identity, setIdentity] = useState<Identity | "loading">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    if (desktop) {
      api<{ signedIn: boolean; email?: string }>("/api/aiking/account/status").then(value => { if (live) setIdentity(value.signedIn && value.email ? { email: value.email } : null); }).catch(() => { if (live) setIdentity(null); });
      return () => { live = false; };
    }
    if (!hosted) { setIdentity(null); return; }
    fetch("/api/platform/session", { credentials: "same-origin", cache: "no-store" })
      .then(response => response.json())
      .then(value => { if (live) setIdentity(value?.authenticated && value.identity?.email ? { email: String(value.identity.email) } : null); })
      .catch(() => { if (live) setIdentity(null); });
    return () => { live = false; };
  }, [hosted, desktop]);
  const signOut = async () => {
    setBusy(true); setError("");
    try {
      if (desktop) { await api("/api/aiking/account/logout", { method: "POST", body: "{}" }); setIdentity(null); setBusy(false); return; }
      const response = await fetch("/api/platform/logout", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("logout");
      location.assign("/");
    } catch { setError(at("account.signOutFailed")); setBusy(false); }
  };
  const signIn = async () => {
    setBusy(true); setError("");
    try { await window.ogb?.workspaces?.connectAiking?.(); } catch { setError(at("account.signInFailed")); }
    setBusy(false);
  };
  if (identity === "loading") return <Card title={at("account.title")} subtitle={at("account.loading")} />;
  if (identity) {
    return (
      <Card title={at("account.title")} subtitle={at("account.signedInAs", { email: identity.email })}>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">{desktop ? at("signin.signedInHelp") : at("account.signedInHelp")}</p>
        {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
        <button type="button" disabled={busy} onClick={() => void signOut()} className="ui-button mt-4 w-fit">{at("account.signOut")}</button>
      </Card>
    );
  }
  if (desktop) {
    return (
      <Card title={at("account.title")} subtitle={at("account.notSignedIn")}>
        <div className="mt-3 max-w-sm"><DesktopSignIn askName={false} onSignedIn={(email) => setIdentity({ email })} /></div>
      </Card>
    );
  }
  return (
    <Card title={at("account.title")} subtitle={at("account.notSignedIn")}>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">{at("account.localHelp")}</p>
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      {window.ogb?.workspaces?.connectAiking && (
        <button type="button" disabled={busy} onClick={() => void signIn()} className="mt-4 w-fit rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50">{at("account.signIn")}</button>
      )}
    </Card>
  );
}
