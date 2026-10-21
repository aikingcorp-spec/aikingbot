// Copyright (c) 2026 AIKING.
// Signing out of the desktop app takes the person back to the sign-in screen: the email sign-in is not optional. The screen
// covers the app until they sign in again (with the same email or another one). The first run has its own sign-in step in the
// welcome flow, so the gate waits for that to finish.
import { useEffect, useState } from "react";
import { welcomeDue } from "@/lib/onboarding";
import { emailGateDone } from "@/lib/analytics";
import { api, useStore } from "@/state/store";
import { DesktopSignIn } from "./DesktopSignIn";
import { at } from "./strings";

export const ACCOUNT_CHANGED = "aiking:account-changed";

export function DesktopAccountGate() {
  const { state } = useStore();
  const desktop = Boolean(window.ogb?.workspaces?.connectAiking) && window.ogb?.remoteClient !== undefined;
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    const read = () => { api<{ signedIn: boolean }>("/api/aiking/account/status").then((value) => { if (live) setSignedIn(Boolean(value.signedIn)); }).catch(() => undefined); };
    read();
    window.addEventListener(ACCOUNT_CHANGED, read); window.addEventListener("focus", read);
    return () => { live = false; window.removeEventListener(ACCOUNT_CHANGED, read); window.removeEventListener("focus", read); };
  }, [desktop]);
  const due = Boolean(state.config) && welcomeDue(state.config, { remoteClient: false, legacyDone: emailGateDone() });
  // The status read at start-up is old once the first-run sign-in is done: ask again whenever the welcome flow comes or goes.
  useEffect(() => { if (desktop) window.dispatchEvent(new Event(ACCOUNT_CHANGED)); }, [desktop, due]);
  if (!desktop || signedIn !== false || !state.config || due) return null;
  return (
    <div role="dialog" aria-modal="true" data-account-gate className="fixed inset-0 z-[70] flex items-center justify-center bg-app p-4">
      <div className="w-full max-w-[440px] rounded-2xl border border-hairline/50 bg-panel p-7 shadow-xl">
        <h1 className="text-center text-[20px] font-semibold text-ink">{at("gate.title")}</h1>
        <p className="mt-2 text-center text-[13.5px] leading-relaxed text-ink-secondary">{at("gate.intro")}</p>
        <div className="mt-3"><DesktopSignIn askName={false} intro={false} onSignedIn={() => { setSignedIn(true); window.dispatchEvent(new Event(ACCOUNT_CHANGED)); }} /></div>
      </div>
    </div>
  );
}
