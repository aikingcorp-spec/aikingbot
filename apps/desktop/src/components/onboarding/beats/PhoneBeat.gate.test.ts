import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({
  useStore: () => ({ state: { config: { profile: { email: "" } } }, dispatch: () => {} }),
}));

vi.mock("@/lib/analytics", () => ({ track: () => {} }));

import { PhoneBeat } from "./PhoneBeat";

describe("onboarding phone beat gate", () => {
  it("shows Sắp có / Coming soon and the unsupported notice, not the setup flow", () => {
    const html = renderToStaticMarkup(
      createElement(PhoneBeat, {
        onNext: () => {},
        onSkip: () => {},
        setMascot: () => {},
        bump: () => {},
      }),
    );
    expect(html).toContain("data-onboarding-phone-gate");
    expect(html).toContain("data-phone-pairing-gate");
    expect(html).toContain("data-phone-pairing-unsupported");
    expect(html).toContain("data-phone-pairing-soon");
    expect(html).not.toContain("data-phone-pairing-action");
  });
});
