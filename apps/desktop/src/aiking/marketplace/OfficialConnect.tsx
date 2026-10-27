// Copyright (c) 2026 AIKING.
// Connect an app through its maker's own MCP server and OAuth. Apps that register a workspace themselves connect in
// one click; the others need a sign-in app the owner registers with the provider once. Composio is offered only as
// the fallback.
import { useState } from "react";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import type { AppListing } from "./contract";
import { at } from "../strings";
import { officialProviderSteps } from "./official-steps";
import { connectOfficial, disconnectOfficial, officialRedirectUri, officialSignInStatus, type AppsState } from "./installer";

type Official = Extract<AppListing["connector"], { type: "official" }>;

/** Opens the provider's sign-in in a new tab (opened during the click so it is not blocked) and waits for the result. */
export async function signInOfficial(listing: AppListing, apps: AppsState, app?: { clientId: string; clientSecret: string }): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const started = await connectOfficial(listing, apps, app);
    if (tab && !tab.closed) tab.location.href = started.authorizationUrl;
    else window.open(started.authorizationUrl, "_blank", "noopener");
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const status = await officialSignInStatus(started.name, started.flowId);
      if (status.phase === "succeeded") return;
      if (status.phase !== "waiting") throw new Error(status.message ?? `Signing in to ${listing.name} did not finish.`);
    }
    throw new Error(`Signing in to ${listing.name} took too long. Try again.`);
  } catch (error) {
    if (tab && !tab.closed && tab.location.href === "about:blank") tab.close();
    throw error;
  }
}

const field = "mt-1 w-full rounded-lg border border-hairline bg-raised px-3 py-2 text-[13px] text-ink outline-none focus:border-accent-border";

export function OfficialConnect({ listing, apps, connected, onChanged, onComposio }: { listing: AppListing; apps: AppsState; connected: boolean; onChanged(): void; onComposio?: () => void }) {
  const connector = listing.connector as Official;
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const installed = apps.mcp.find((row) => row.name === connector.server.name);
  const savedApp = installed?.oauth?.clientId;
  const needsApp = connector.signIn === "app" && !savedApp;
  const redirectUri = officialRedirectUri();
  const run = async (kind: "connect" | "disconnect") => {
    setBusy(kind); setError("");
    try {
      if (kind === "disconnect") await disconnectOfficial(listing);
      else await signInOfficial(listing, apps, connector.signIn === "app" && clientId.trim() ? { clientId, clientSecret } : undefined);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      onChanged();
    } finally { setBusy(null); }
  };
  return (
    <section data-official-connect={listing.id} className="space-y-3 rounded-xl bg-raised px-4 py-3 text-[13px]">
      <div>
        <h4 className="text-[14px] font-semibold text-ink">{at("official.title")}</h4>
        <p className="mt-1 text-ink-secondary">
          {connector.signIn === "automatic"
            ? at("official.autoHint", { name: listing.name })
            : at("official.appHint", { name: listing.name, provider: connector.provider?.name ?? listing.name })}
        </p>
        <p className="mt-1 break-all font-mono text-[11.5px] text-ink-tertiary">{connector.server.url}</p>
      </div>
      {connector.signIn === "app" && !connected && (
        <div className="space-y-2" data-official-app-setup>
          {connector.provider && (
            <ol className="list-decimal space-y-1 pl-5 text-ink-secondary">
              {officialProviderSteps(listing.id, connector.provider.steps).map((step) => <li key={step}>{step}</li>)}
            </ol>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-secondary">{at("official.redirect")}</span>
            <code className="break-all rounded bg-app px-1.5 py-0.5 text-[12px]">{redirectUri}</code>
            <button type="button" aria-label={at("official.copyRedirect")} onClick={() => { void navigator.clipboard?.writeText(redirectUri).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} className="text-ink-secondary hover:text-ink"><Copy size={13} aria-hidden="true" /></button>
            {copied && <span className="text-[12px] text-success">{at("official.copied")}</span>}
          </div>
          {connector.scopes?.length ? <p className="text-ink-secondary">{at("official.scopes")} <span className="font-mono text-[12px]">{connector.scopes.join(" ")}</span></p> : null}
          {connector.provider && <a href={connector.provider.setupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent underline underline-offset-2">{at("official.openProvider", { name: connector.provider.name })}<ExternalLink size={12} aria-hidden="true" /></a>}
          {savedApp && <p className="text-ink-secondary">{at("official.appSaved")} <span className="font-mono">{savedApp}</span>. {at("official.appReplace")}</p>}
          <label className="block text-ink-secondary">{at("official.clientId")}<input aria-label={at("official.clientId")} value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" spellCheck={false} className={field} /></label>
          <label className="block text-ink-secondary">{at("official.clientSecret")}<input aria-label={at("official.clientSecret")} type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} autoComplete="off" spellCheck={false} className={field} /></label>
        </div>
      )}
      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {connected && installed ? (
          <button type="button" disabled={busy !== null} onClick={() => void run("disconnect")} className="rounded-lg border border-danger/40 px-3 py-1.5 text-danger disabled:opacity-50">{busy === "disconnect" ? at("official.disconnecting") : at("official.disconnect")}</button>
        ) : (
          <button type="button" data-official-connect-button disabled={busy !== null || (needsApp && (!clientId.trim() || !clientSecret.trim()))} onClick={() => void run("connect")} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 font-medium text-on-accent disabled:opacity-40">
            {busy === "connect" && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}{busy === "connect" ? at("official.waiting", { name: listing.name }) : at("official.signIn", { name: listing.name })}
          </button>
        )}
        {!connected && connector.composio && onComposio && (
          <button type="button" onClick={onComposio} className="rounded-lg px-3 py-1.5 text-ink-secondary underline underline-offset-2">{at("official.useComposio")}</button>
        )}
      </div>
    </section>
  );
}
