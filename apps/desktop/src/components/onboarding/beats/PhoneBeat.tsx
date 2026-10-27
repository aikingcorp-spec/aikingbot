import { useEffect } from "react";
import { PhonePairingGatePanel, phonePairingSupported } from "@/components/PhonePairingComingSoon";
import { PhoneSetupFlow } from "@/components/PhoneSetupFlow";
import { track } from "@/lib/analytics";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import type { BeatProps } from "./shared";

export function PhoneBeat({ onNext, onSkip, setMascot, bump }: BeatProps) {
  const { state } = useStore();
  useEffect(() => {
    setMascot("sending");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!phonePairingSupported()) {
    return (
      <div className="animate-rise flex min-h-0 flex-col" data-onboarding-phone-gate="1">
        <PhonePairingGatePanel
          title={t("phone.pairing.entryTitle")}
          subtitle={t("phone.pairing.onboardingSubtitle")}
        />
        <div className="mt-5 flex flex-col items-stretch gap-2">
          <button
            type="button"
            className="w-full rounded-lg bg-accent py-2.5 text-[14px] font-medium text-white hover:opacity-90"
            onClick={() => {
              track("phone_setup_skipped");
              onNext();
            }}
          >
            {t("onboarding.continue")}
          </button>
          <button
            type="button"
            className="self-center text-[12.5px] text-ink-secondary hover:text-ink"
            onClick={() => {
              track("phone_setup_skipped");
              onSkip();
            }}
          >
            {t("phone.intro.notNow")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-rise flex min-h-0 flex-col">
      <PhoneSetupFlow
        variant="onboarding"
        compactHeader
        profileEmail={state.config?.profile?.email ?? ""}
        onSkip={() => {
          track("phone_setup_skipped");
          onSkip();
        }}
        onComplete={() => {
          track("phone_setup_completed");
          bump("celebrate");
          onNext();
        }}
      />
    </div>
  );
}
