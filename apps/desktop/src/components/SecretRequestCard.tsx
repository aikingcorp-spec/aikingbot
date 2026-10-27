import { useState, type FormEvent } from "react";
import { ExternalLink, KeyRound, Loader2, LockKeyhole, RefreshCw, X } from "lucide-react";

import { credentialConfigPatch, credentialErrorText, credentialResumeErrorText, credentialResumeOutcome, isFixedCredentialTargetId, trustedCredentialCopy } from "../../shared/credential-request";
import { activeLocale } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { api, useStore, type ConfigStatus, type Message } from "@/state/store";
import { ASK_FIELD, ASK_PRIMARY_BUTTON, ASK_QUIET_BUTTON, AskCard, AskSettledLine, returnFocusToComposer } from "./AskCard";

// Security: the value goes straight to the host's settings, never into the chat.

export function SecretRequestCard({
  botId,
  threadId,
  message,
}: {
  botId: string;
  threadId: string;
  message: Message;
}) {
  const { dispatch } = useStore();
  const secret = message.secret!;
  const isCustom = secret.target === "custom";
  // Title and description come from the registry only for fixed targets; custom shows the
  // agent-supplied label marked as requested by the bot (untrusted text).
  const trusted = trustedCredentialCopy(secret.target);
  const displayLabel = isCustom ? (secret.label || trusted.label) : trusted.label;
  const customDescription = secret.description
    || "Requested by the bot. Stored in the vault; the bot only receives a reference.";
  // Only fixed, localized text is ever shown for errors: never a backend, stored or thrown message.
  const refusalText = (caught: unknown) => credentialErrorText(caught, activeLocale());
  const [claimId, setClaimId] = useState<string | null>(null);
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const endpoint = `/api/bots/${encodeURIComponent(botId)}/secret-cards/${encodeURIComponent(message.id)}`;
  const error = localError ?? (secret.error ? credentialResumeErrorText(secret.error, activeLocale()) : undefined);
  const outcome = credentialResumeOutcome(secret);
  const provided = outcome === "provided";
  const declined = outcome === "dismissed";
  const superseded = secret.superseded === true;
  const stopped = secret.stopped === true;
  const description = superseded
    ? "This request was replaced by a newer one for the same key. Use the newest card to provide it."
    : provided
    ? stopped
      ? "Saved securely."
      : secret.resumed
      ? "Saved securely. Your bot is continuing the task."
      : "Saved securely. Your bot will continue when its current turn settles."
    : declined
      ? "You chose not to provide this credential. AIKINGBOT could not resume the bot yet."
      : isCustom
        ? customDescription
        : trusted.description;
  const footerLabel = stopped
    ? "Stopped"
    : declined
    ? "Continuing without this credential failed"
    : secret.resumed
      ? "Bot resumed without seeing the key"
      : error
        ? "The key is safe; resuming failed"
        : "Waiting to resume safely";

  if (declined && (secret.resumed || !error)) return null;

  // The claim is passed in by the save that just made it: state set in the same tick is not yet visible here.
  const notifyProvided = async (activeClaim: string | null) => {
    await api(`${endpoint}/provided`, {
      method: "POST",
      body: JSON.stringify({ threadId, ...(activeClaim ? { claimId: activeClaim } : {}) }),
    });
  };

  const retryResume = async () => {
    if (saving) return;
    setSaving(true);
    setLocalError(null);
    try {
      await api(`${endpoint}/resume`, {
        method: "POST",
        body: JSON.stringify({ threadId }),
      });
    } catch (error) {
      setLocalError(credentialResumeErrorText(error, activeLocale()));
    } finally {
      setSaving(false);
    }
  };

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving || (!value.trim() && !savedLocally)) return;
    setSaving(true);
    setLocalError(null);
    try {
      let activeClaim = claimId;
      if (!savedLocally) {
        const next = value.trim();
        if (isCustom) {
          // Custom secrets go to the vault, never config.json / Electron credential patch.
          const claim = await api<{ claimId: string }>(`${endpoint}/claim`, {
            method: "POST",
            body: JSON.stringify({ threadId, target: secret.target }),
          });
          try {
            await api<{ stored: true; ref: string }>(`${endpoint}/store-custom`, {
              method: "POST",
              body: JSON.stringify({ threadId, claimId: claim.claimId, value: next }),
            });
          } catch (failure) {
            await api(`${endpoint}/release`, { method: "POST", body: JSON.stringify({ threadId, claimId: claim.claimId }) }).catch(() => {});
            throw failure;
          }
          activeClaim = claim.claimId;
          setClaimId(activeClaim);
        } else if (isFixedCredentialTargetId(secret.target)) {
          // Narrow away from "custom": Electron setCredential and config patches only accept fixed slots.
          const target = secret.target;
          let status: ConfigStatus;
          if (window.ogb?.setCredential) {
            // Electron admits the card (live, unexpired, this bot/thread/target) before it writes.
            const saved = await window.ogb.setCredential(target, next, { botId, threadId, messageId: message.id });
            activeClaim = saved.claimId ?? null;
            setClaimId(activeClaim);
            status = saved;
          } else {
            // Fallback: claim first, so admission precedes the write; release if the write fails.
            const claim = await api<{ claimId: string }>(`${endpoint}/claim`, {
              method: "POST",
              body: JSON.stringify({ threadId, target }),
            });
            try {
              status = await api("/api/config", {
                method: "PUT",
                // The card context makes this the server-checked card write, not a plain Settings save.
                body: JSON.stringify({
                  ...credentialConfigPatch(target, next),
                  credentialCard: { botId, threadId, messageId: message.id, target, claimId: claim.claimId },
                }),
              });
            } catch (failure) {
              await api(`${endpoint}/release`, { method: "POST", body: JSON.stringify({ threadId, claimId: claim.claimId }) }).catch(() => {});
              throw failure;
            }
            activeClaim = claim.claimId;
            setClaimId(activeClaim);
          }
          dispatch({ type: "configStatus", config: status });
        } else {
          throw new Error("unsupported credential target");
        }
        setValue("");
        setSavedLocally(true);
      }
      await notifyProvided(activeClaim);
      returnFocusToComposer();
    } catch (error) {
      setLocalError(refusalText(error));
    } finally {
      setSaving(false);
    }
  };

  const dismiss = () => {
    void api(`${endpoint}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ threadId }),
    }).catch(() => {});
  };

  if (superseded) {
    return (
      <AskSettledLine icon={<X size={13} />} ariaLabel={displayLabel}>
        <span className="text-ink-secondary" title={description}>{displayLabel}</span>
        <span> · Superseded by a newer request</span>
      </AskSettledLine>
    );
  }

  if (stopped && !provided) {
    return (
      <AskSettledLine icon={<X size={13} />} ariaLabel={displayLabel}>
        <span className="text-ink-secondary" title={trusted.description}>{displayLabel}</span>
        <span> · Stopped</span>
      </AskSettledLine>
    );
  }

  if (provided || declined) {
    const retry = !secret.resumed && !stopped && error ? (
      <button type="button" onClick={() => void retryResume()} disabled={saving} className={cn(ASK_QUIET_BUTTON, "text-accent-text")}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        Try again
      </button>
    ) : undefined;
    return (
      <AskSettledLine
        ariaLabel={displayLabel}
        icon={secret.resumed || stopped
          ? undefined
          : declined
            ? <X size={13} className="text-danger" />
            : error
              ? <KeyRound size={13} />
              : <Loader2 size={13} className="animate-spin" />}
        action={retry}
        detail={error && <p role="alert" className="ms-[19px] mt-1 text-[12px] text-danger">{error}</p>}
      >
        <span className="text-ink-secondary" title={description}>{provided ? `${displayLabel} saved securely` : displayLabel}</span>
        <span className={declined ? "text-danger" : undefined}> · {footerLabel}</span>
      </AskSettledLine>
    );
  }

  return (
    <AskCard
      ariaLabel={displayLabel}
      icon={<KeyRound size={15} />}
      title={displayLabel}
      explanation={description}
      onDismiss={dismiss}
      dismissLabel="Not now"
    >
      {remoteClient ? (
        <div className="text-[12.5px] leading-relaxed text-ink-secondary">
          This key must be saved on the host computer. Open this conversation on the host to continue securely.
        </div>
      ) : (
        <form onSubmit={(event) => void save(event)}>
          <div className="flex flex-wrap gap-2">
            <input
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              dir="ltr"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={trusted.placeholder}
              disabled={saving || savedLocally}
              aria-label={displayLabel}
              className={cn(ASK_FIELD, "min-w-[10rem] flex-1")}
            />
            <button type="submit" disabled={saving || (!value.trim() && !savedLocally)} className={ASK_PRIMARY_BUTTON}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <LockKeyhole size={14} />}
              {savedLocally ? "Continue task" : "Save securely"}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-tertiary">
            <span className="flex items-center gap-1">
              <LockKeyhole size={11} /> Stored securely by AIKINGBOT and never added to chat.
            </span>
            {trusted.helpUrl ? (
              <a
                href={trusted.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent-text hover:underline"
              >
                Where to get this key <ExternalLink size={11} />
              </a>
            ) : isCustom ? (
              <span className="text-ink-tertiary">Requested by the bot · vault ref only</span>
            ) : null}
          </div>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </AskCard>
  );
}
