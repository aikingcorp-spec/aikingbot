import { IncomingMessage } from "../zalo/types.js";
import { RecentChat } from "./historyClient.js";
import { toIncomingMessage } from "./backfillMessage.js";
import { EventLog, NOOP_LOG } from "../logging/eventLog.js";

export interface HistoryClient {
  listRecentChat(oaId: string, offset: number, count: number): Promise<RecentChat[]>;
  getConversationMessages(userId: string, offset: number, count: number): Promise<unknown[]>;
}

export interface BackfillCaps { maxConversations: number; maxMessagesPerConversation: number; pageSize: number }
export interface BackfillResult { enqueued: number; maxTimeMs: number; capped: boolean }

export const DEFAULT_CAPS: BackfillCaps = { maxConversations: 50, maxMessagesPerConversation: 100, pageSize: 10 };

/** Collect up to `maxConversations` recent conversations (no early stop — order is not guaranteed). */
async function collectConversations(client: HistoryClient, oaId: string, caps: BackfillCaps): Promise<RecentChat[]> {
  const out: RecentChat[] = [];
  let offset = 0;
  while (out.length < caps.maxConversations) {
    const page = await client.listRecentChat(oaId, offset, caps.pageSize);
    if (page.length === 0) break;
    out.push(...page);
    offset += page.length;
    if (page.length < caps.pageSize) break;
  }
  return out.slice(0, caps.maxConversations);
}

/** Pull messages newer than `sinceMs` across recent conversations and enqueue them. */
export async function runBackfill(
  client: HistoryClient,
  oaId: string,
  sinceMs: number,
  enqueue: (msg: IncomingMessage) => void,
  caps: BackfillCaps,
  log: EventLog = NOOP_LOG,
): Promise<BackfillResult> {
  const conversations = await collectConversations(client, oaId, caps);
  let enqueued = 0;
  let maxTimeMs = sinceMs;
  // LIMITATION: `listrecentchat` order is not guaranteed, so when the conversation cap is hit
  // the truncated tail may contain a NEWER conversation than the ones we scanned. The caller
  // advances the watermark to `maxTimeMs` on success, which can then skip those unscanned
  // conversations permanently. `capped` is surfaced as a warning so an operator can react; if
  // `backfill_capped` ever fires in practice, raise DEFAULT_CAPS.maxConversations.
  let capped = conversations.length >= caps.maxConversations;

  for (const conv of conversations) {
    if (conv.lastTimeMs <= sinceMs) continue; // whole conversation is old — skip, keep scanning others
    let offset = 0;
    let seen = 0;
    let stop = false;
    while (!stop && seen < caps.maxMessagesPerConversation) {
      const page = await client.getConversationMessages(conv.userId, offset, caps.pageSize);
      if (page.length === 0) break;
      for (const raw of page) {
        const conv2 = toIncomingMessage(raw, conv.userId);
        if (!conv2) continue;
        if (conv2.timeMs <= sinceMs) { stop = true; break; } // within a conversation, order IS guaranteed
        enqueue(conv2.msg);
        enqueued += 1;
        if (conv2.timeMs > maxTimeMs) maxTimeMs = conv2.timeMs;
        seen += 1;
        if (seen >= caps.maxMessagesPerConversation) { capped = true; stop = true; break; }
      }
      offset += page.length;
      if (page.length < caps.pageSize) break;
    }
  }

  log.info({ event: "backfill_done", oaId, enqueued, maxTimeMs, capped }, "OA backfill complete");
  return { enqueued, maxTimeMs, capped };
}
