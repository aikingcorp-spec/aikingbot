import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { phonePairingSupported } from "@/aiking/product-availability";
import {
  ComingSoonBadge,
  PhonePairingComingSoonEntry,
  PhonePairingGatePanel,
  PhonePairingUnsupportedModal,
  PhonePairingUnsupportedNotice,
  blockPhonePairingAction,
} from "./PhonePairingComingSoon";
import { beatsFor } from "@/lib/onboarding";

describe("phone pairing feature gate", () => {
  it("reports pairing as unsupported in this build", () => {
    expect(phonePairingSupported()).toBe(false);
  });

  it("blocks pairing actions without calling through", () => {
    let blocked = false;
    expect(blockPhonePairingAction(() => { blocked = true; })).toBe(true);
    expect(blocked).toBe(true);
  });

  it("keeps the onboarding phone beat visible", () => {
    expect(beatsFor({ dictation: true, reel: false })).toContain("phone");
  });

  it("renders the Sắp có badge and exact unsupported notice", () => {
    const badge = renderToStaticMarkup(createElement(ComingSoonBadge));
    expect(badge).toContain('data-phone-pairing-soon="1"');

    const notice = renderToStaticMarkup(createElement(PhonePairingUnsupportedNotice));
    expect(notice).toContain('data-phone-pairing-unsupported="1"');

    const panel = renderToStaticMarkup(
      createElement(PhonePairingGatePanel, { title: "Pair phone", subtitle: "soon" }),
    );
    expect(panel).toContain('data-phone-pairing-gate="1"');
    expect(panel).toContain('data-phone-pairing-unsupported="1"');
  });

  it("entry reveals notice on tap without a pairing action attribute", () => {
    const html = renderToStaticMarkup(
      createElement(PhonePairingComingSoonEntry, {
        title: "Pair phone",
        detail: "Scan",
        actionLabel: "Show code",
      }),
    );
    expect(html).toContain('data-phone-pairing-entry="1"');
    expect(html).toContain('data-phone-pairing-soon-action="1"');
    expect(html).not.toContain("data-phone-pairing-action");
  });

  it("modal is hidden until open", () => {
    expect(renderToStaticMarkup(createElement(PhonePairingUnsupportedModal, { open: false, onClose: () => {} }))).toBe("");
    const open = renderToStaticMarkup(
      createElement(PhonePairingUnsupportedModal, { open: true, onClose: () => {} }),
    );
    expect(open).toContain('data-phone-pairing-modal="1"');
    expect(open).toContain('data-phone-pairing-unsupported="1"');
  });
});
