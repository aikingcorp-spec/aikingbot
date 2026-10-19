import type { OutgoingEvent } from "../chatwoot/webhookServer.js";
import type { AccountRepo } from "../store/accountRepo.js";
import type { ConversationRepo } from "../store/conversationRepo.js";
import type { AppClientFor } from "../chatwoot/appClientFactory.js";
import { EventLog, NOOP_LOG } from "../logging/eventLog.js";

/** Post a private note to the Chatwoot conversation behind an outbound event. */
export type OutboundNotifier = (evt: OutgoingEvent, message: string) => Promise<void>;

export function makeOutboundNotifier(
  inboxIdentifierForId: (inboxId: number) => string | null,
  accounts: Pick<AccountRepo, "findByInboxIdentifier">,
  conversations: Pick<ConversationRepo, "getChatwootId">,
  appClientFor: AppClientFor,
  log: EventLog = NOOP_LOG,
): OutboundNotifier {
  return async (evt, message) => {
    // Notifying must never break the send flow or crash the worker loop.
    try {
      const identifier = inboxIdentifierForId(evt.inboxId);
      if (!identifier) return;
      const acc = await accounts.findByInboxIdentifier(identifier);
      if (!acc) return;
      const convId = await conversations.getChatwootId(acc.id, evt.sourceId);
      if (convId) {
        const appClient = await appClientFor(acc.id);
        await appClient.postPrivateNote(convId, message);
      }
    } catch (err) {
      log.warn(
        { event: "outbound_notify_failed", chatwootMessageId: evt.chatwootMessageId, err },
        "failed to post outbound failure note",
      );
    }
  };
}
