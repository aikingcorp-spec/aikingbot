import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/**
 * What turn state reaches in main: the queue, the routine ids, and the answers to prompts,
 * approvals and browser takeovers.
 */
export interface TurnsPort {
  agent: Pick<
    AIKINGBOTDesktopApi["agent"],
    | "cancelQueuedMessage"
    | "cancelWait"
    | "clearContext"
    | "interrupt"
    | "listQueue"
    | "listRoutines"
    | "listWaits"
    | "reorderQueue"
    | "respondToApproval"
    | "respondToBrowserTakeover"
    | "respondToPrompt"
    | "steerQueuedMessage"
    | "updateQueuedMessage"
  >;
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function turnsPort(): TurnsPort {
  return window.aikingbot;
}
