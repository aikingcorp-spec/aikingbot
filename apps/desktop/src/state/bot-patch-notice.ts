// Copyright (c) 2026 AIKING.
import { at } from "@/aiking/strings";

/**
 * Notice for a bot save whose latest state could not be confirmed. Only a committed write says "saved";
 * a rejected/lost write returns null so the original rejection error stays the only message.
 */
export function unverifiedSaveNotice(info: { committed: boolean }): string | null {
  return info.committed ? at("bot.savedUnverified") : null;
}

/** Refuse to start work while this bot's approval/memory/model save is unconfirmed. Name/title/visual saves never trigger it. */
export function throwIfExecutionUnverified(queue: { isExecutionUnverified: (botId: string) => boolean }, botId: string): void {
  if (queue.isExecutionUnverified(botId)) throw new Error(at("bot.executionUnverified"));
}
