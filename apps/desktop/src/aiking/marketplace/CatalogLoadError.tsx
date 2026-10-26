// Copyright (c) 2026 AIKING. What a failed catalog load says: the reason in the
// person's language, the next step, and Retry already focused.
import { useEffect, useRef } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { at, type AikingKey } from "../strings";
import type { CatalogLoadFailure } from "./use-catalog";

export function catalogErrorText(error: Pick<CatalogLoadFailure, "kind" | "status">): string {
  const reason = at(`market.loadFailed.${error.kind}` as AikingKey);
  return error.status ? `${reason} ${at("market.loadFailedCode", { status: error.status })}` : reason;
}

// Solid text-ink on the surface with a danger border and icon: the red-on-red box did not reach WCAG AA.
export const ALERT_BOX = "rounded-xl border border-danger/60 bg-panel px-3 py-3 text-[13px] text-ink";
export const ALERT_BUTTON = "rounded-lg border border-hairline bg-raised px-3 py-1 font-medium text-ink hover:bg-raised-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export function CatalogLoadError({ error, retrying, onRetry, onClose }: { error: CatalogLoadFailure; retrying: boolean; onRetry: () => void; onClose: () => void }) {
  const retryRef = useRef<HTMLButtonElement>(null);
  // Each failure (the first one and every failed retry) puts the keyboard on Retry, so Enter tries again.
  useEffect(() => { retryRef.current?.focus({ preventScroll: true }); }, [error.seq]);
  return (
    <div role="alert" className={ALERT_BOX} data-error-kind={error.kind}>
      <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={14} aria-hidden="true" className="shrink-0 text-danger" />{at("market.loadFailed")}</p>
      <p className="mt-1">{catalogErrorText(error)}</p>
      <p className="mt-1 text-ink-secondary">{at("market.loadFailedHint")}</p>
      <div className="mt-3 flex gap-2">
        {/* aria-disabled, not disabled: a disabled button drops focus, and the next failure must find it still there. */}
        <button ref={retryRef} type="button" className={ALERT_BUTTON} aria-disabled={retrying || undefined} aria-busy={retrying || undefined} onClick={() => { if (!retrying) onRetry(); }}>
          {retrying ? <span className="inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" aria-hidden="true" />{at("market.retrying")}</span> : at("market.retry")}
        </button>
        <button type="button" className={ALERT_BUTTON} onClick={onClose}>{at("market.close")}</button>
      </div>
    </div>
  );
}
