import { useState, type ReactNode } from "react";
import { Info, Smartphone } from "lucide-react";

import { phonePairingSupported } from "@/aiking/product-availability";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export { phonePairingSupported };

/** Warning-tint “Sắp có” / “Coming soon” pill. */
export function ComingSoonBadge({ className }: { className?: string }) {
  return (
    <span
      data-phone-pairing-soon="1"
      className={cn(
        "inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning",
        className,
      )}
    >
      {t("phone.pairing.comingSoon")}
    </span>
  );
}

/** Exact unsupported notice card (VI/EN via locale). */
export function PhonePairingUnsupportedNotice({ className }: { className?: string }) {
  return (
    <div
      role="status"
      data-phone-pairing-unsupported="1"
      className={cn(
        "rounded-xl border border-warning/25 bg-warning/5 px-4 py-3.5 text-left",
        className,
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <Info size={16} className="shrink-0 text-warning" aria-hidden="true" />
        <span className="text-[13.5px] font-semibold text-ink">{t("phone.pairing.unsupportedTitle")}</span>
      </div>
      <p className="text-[13px] leading-relaxed text-ink">{t("phone.pairing.unsupported")}</p>
    </div>
  );
}

/** Inline gate used by onboarding phone + companion pair. */
export function PhonePairingGatePanel({
  title,
  subtitle,
  className,
  showNotice = true,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  showNotice?: boolean;
}) {
  return (
    <div data-phone-pairing-gate="1" className={cn("flex flex-col items-center text-center", className)}>
      <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-control text-ink-secondary">
        <Smartphone size={28} aria-hidden="true" />
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
        <span className="text-[15px] font-semibold text-ink">{title}</span>
        <ComingSoonBadge />
      </div>
      {subtitle ? <p className="mb-3 max-w-[390px] text-[13px] leading-relaxed text-ink-secondary">{subtitle}</p> : null}
      {showNotice ? <PhonePairingUnsupportedNotice className="w-full max-w-[390px]" /> : null}
    </div>
  );
}

/**
 * Entry row that stays visible with Sắp có. Tapping reveals the notice and
 * never starts a pairing action.
 */
export function PhonePairingComingSoonEntry({
  title,
  detail,
  actionLabel,
  className,
}: {
  title: string;
  detail?: string;
  actionLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-phone-pairing-entry="1" className={cn("flex flex-col gap-3", className)}>
      <button
        type="button"
        data-phone-pairing-soon-action="1"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-hairline/40 bg-card px-4 py-3.5 text-left hover:bg-raised/60"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-control text-ink-secondary">
          <Smartphone size={18} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-ink">{title}</span>
            <ComingSoonBadge />
          </span>
          {detail ? <span className="mt-0.5 block text-[12.5px] text-ink-secondary">{detail}</span> : null}
        </span>
        {actionLabel ? (
          <span className="shrink-0 rounded-lg border border-hairline/50 px-2.5 py-1 text-[12px] text-ink-tertiary opacity-60">
            {actionLabel}
          </span>
        ) : null}
      </button>
      {open ? <PhonePairingUnsupportedNotice /> : null}
    </div>
  );
}

/** Modal overlay for the dedicated pairing entry (Mai `pairing` screen). */
export function PhonePairingUnsupportedModal({
  open,
  onClose,
  title,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
}) {
  if (!open) return null;
  return (
    <div
      data-phone-pairing-modal="1"
      className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="phone-pairing-unsupported-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[440px] rounded-2xl border border-hairline/40 bg-panel p-7 text-center shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2.5 flex flex-wrap items-center justify-center gap-2">
          <h2 id="phone-pairing-unsupported-title" className="text-[18px] font-semibold text-ink">
            {title ?? t("phone.pairing.deviceTitle")}
          </h2>
          <ComingSoonBadge />
        </div>
        <div className="my-3 flex justify-center text-ink-secondary">
          <Smartphone size={40} aria-hidden="true" />
        </div>
        <PhonePairingUnsupportedNotice />
        <div className="mt-4 flex justify-end">
          <button type="button" className="ui-button ui-button-primary" onClick={onClose}>
            {t("onboarding.spot.gotIt")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Guard: if unsupported, run `onBlocked` (show notice) and return true; else false. */
export function blockPhonePairingAction(onBlocked?: () => void): boolean {
  if (phonePairingSupported()) return false;
  onBlocked?.();
  return true;
}

export function PhonePairingGateOr({ children }: { children: ReactNode }) {
  if (phonePairingSupported()) return <>{children}</>;
  return (
    <PhonePairingComingSoonEntry
      title={t("phone.pairing.entryTitle")}
      detail={t("phone.pairing.entryDetail")}
      actionLabel={t("phone.pairing.showCode")}
    />
  );
}
