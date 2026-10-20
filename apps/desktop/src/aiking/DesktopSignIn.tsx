// Copyright (c) 2026 AIKING.
// Signing in on the desktop app, inside the app: email, the one-time code from the email, then the person's name. One
// verification and the app carries on; the window never leaves this computer.
import { useRef, useState } from "react";
import { api, ApiError } from "@/state/store";
import { at } from "./strings";

type Step = "email" | "code" | "name";
const field = "mt-3 w-full rounded-xl border border-hairline/50 bg-card px-4 py-3 text-[15px] text-ink outline-none focus:border-accent";
const primary = "mt-4 w-full rounded-xl bg-accent px-4 py-3 text-[14.5px] font-semibold text-accent-ink hover:brightness-110 disabled:opacity-50";
const quiet = "mt-3 w-full text-center text-[13px] text-ink-secondary hover:text-ink";

const reason = (error: unknown): string => {
  const code = error instanceof ApiError ? (error.body as { code?: string } | undefined)?.code : undefined;
  switch (code) {
    case "invalid_email": return at("signin.err.invalid_email");
    case "invalid_otp": return at("signin.err.invalid_otp");
    case "rate_limited": return at("signin.err.rate_limited");
    default: return at("signin.err.unavailable");
  }
};

/** `onSignedIn` receives the verified email and the name the person gave (possibly empty). */
export function DesktopSignIn({ onSignedIn, startAt = "email", askName = true }: { onSignedIn(email: string, name: string): void | Promise<void>; startAt?: Step; askName?: boolean }) {
  const [step, setStep] = useState<Step>(startAt);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  const run = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await work(); } catch (cause) { setError(reason(cause)); }
    pending.current = false; setBusy(false);
  };
  const post = (path: string, body: unknown) => api(`/api/aiking/account/${path}`, { method: "POST", body: JSON.stringify(body), timeoutMs: 20_000 });
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  if (step === "email") return (
    <form onSubmit={(event) => { event.preventDefault(); if (validEmail) void run(async () => { await post("otp", { email: email.trim() }); setCode(""); setStep("code"); }); }} className="flex flex-col items-stretch">
      <p className="mt-1.5 text-center text-[14px] leading-relaxed text-ink-secondary">{at("welcome.signInIntro")}</p>
      <input autoFocus type="email" autoComplete="email" aria-label={at("signin.emailLabel")} placeholder="ban@example.com" value={email} onChange={(event) => setEmail(event.target.value)} className={field} data-signin-email />
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      <button type="submit" disabled={busy || !validEmail} className={primary} data-signin-send>{busy ? at("signin.sending") : at("signin.sendCode")}</button>
    </form>
  );
  if (step === "code") return (
    <form onSubmit={(event) => { event.preventDefault(); if (code.trim().length >= 6) void run(async () => { await post("verify", { email: email.trim(), code: code.trim() }); if (askName) setStep("name"); else await onSignedIn(email.trim().toLowerCase(), ""); }); }} className="flex flex-col items-stretch">
      <p className="mt-1.5 text-center text-[14px] leading-relaxed text-ink-secondary">{at("signin.codeHint", { email: email.trim() })}</p>
      <input autoFocus inputMode="text" autoComplete="one-time-code" aria-label={at("signin.codeLabel")} placeholder="ABCD-EFGH" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} className={`${field} text-center font-mono tracking-[0.15em]`} data-signin-code />
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      <button type="submit" disabled={busy || code.trim().length < 6} className={primary} data-signin-verify>{busy ? at("signin.verifying") : at("signin.verify")}</button>
      <button type="button" className={quiet} onClick={() => { setError(""); setStep("email"); }}>{at("signin.changeEmail")}</button>
    </form>
  );
  return (
    <form onSubmit={(event) => { event.preventDefault(); void run(async () => { await onSignedIn(email.trim().toLowerCase(), name.trim()); }); }} className="flex flex-col items-stretch">
      <p className="mt-1.5 text-center text-[14px] leading-relaxed text-ink-secondary">{at("signin.nameHint")}</p>
      <input autoFocus type="text" aria-label={at("signin.nameLabel")} placeholder={at("signin.nameLabel")} value={name} onChange={(event) => setName(event.target.value)} className={field} data-signin-name />
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      <button type="submit" disabled={busy} className={primary} data-signin-continue>{at("signin.continue")}</button>
    </form>
  );
}
