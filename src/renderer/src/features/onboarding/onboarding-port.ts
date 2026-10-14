import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/**
 * What onboarding reaches in main: the saved setup, and the preview of an invite before the user
 * joins.
 */
export interface OnboardingPort {
  getSetupState: AIKINGBOTDesktopApi["getSetupState"];
  saveSetup: AIKINGBOTDesktopApi["saveSetup"];
  servers: Pick<AIKINGBOTDesktopApi["servers"], "previewInvite">;
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function onboardingPort(): OnboardingPort {
  return window.aikingbot;
}
