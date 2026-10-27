import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { phonePairingSupported } from "@/aiking/product-availability";
import { PhonePairingComingSoonEntry } from "./PhonePairingComingSoon";

vi.mock("./PhoneSetupFlow", async () => {
  const actual = await vi.importActual<typeof import("./PhoneSetupFlow")>("./PhoneSetupFlow");
  return {
    ...actual,
    usePhoneSetupController: () => ({
      state: { enabled: false, devices: [], pairing: null, endpoints: [], port: 0 },
      phase: "intro",
      busy: false,
      accountBusy: false,
      account: null,
      accountError: null,
      error: null,
      email: "",
      setEmail: () => {},
      hostedReady: false,
      localFallback: false,
      tailscaleFallback: false,
      tailscaleAvailable: false,
      pairingLink: null,
      start: () => {},
      skip: () => {},
      act: async () => {},
    }),
  };
});

describe("companion phone pairing gate", () => {
  it("is unsupported in this build", () => {
    expect(phonePairingSupported()).toBe(false);
  });

  it("renders the coming-soon entry instead of a pairing action", () => {
    const html = renderToStaticMarkup(
      createElement(PhonePairingComingSoonEntry, {
        title: "Ghép điện thoại",
        detail: "Quét mã",
        actionLabel: "Hiện mã",
      }),
    );
    expect(html).toContain("data-phone-pairing-entry");
    expect(html).toContain("data-phone-pairing-soon");
    expect(html).not.toContain("data-phone-pairing-action");
  });
});
