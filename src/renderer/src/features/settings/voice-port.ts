import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/** What the Voice tab reaches in main: the dictation models and the dictation settings. */
export interface VoicePort {
  voice: AIKINGBOTDesktopApi["voice"];
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function voicePort(): VoicePort {
  return window.aikingbot;
}
