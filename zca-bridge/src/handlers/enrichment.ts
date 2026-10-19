import { SessionManager } from "../zalo/sessionManager.js";
import { ChatwootClient } from "../chatwoot/client.js";
import { EventLog, NOOP_LOG } from "../logging/eventLog.js";
import { ContactInfo } from "../zalo-oa/sharedInfo.js";
import { applyContactInfo } from "./contactInfoSink.js";
import { decodeSourceId, ThreadKind } from "../routing/sourceId.js";

export interface ContactProfile { displayName: string; avatar?: string; sharedInfo?: ContactInfo; }

/** Resolve a contact's profile for OA accounts (which have no zca session). */
export type OaProfileResolver = (accountId: number, userId: string) => Promise<ContactProfile | null>;

export function makeEnricher(
  sessions: SessionManager,
  chatwoot: ChatwootClient,
  oaProfile?: OaProfileResolver,
  log: EventLog = NOOP_LOG,
) {
  return async function enrich(
    accountId: number,
    sourceId: string,
    identifier: string,
    senderUid: string,
  ): Promise<void> {
    const { kind, threadId } = decodeSourceId(sourceId);
    if (kind === ThreadKind.Group) {
      try {
        const group = await sessions.getGroupInfo(accountId, threadId);
        await chatwoot.updateContact(identifier, sourceId, { name: group.name, avatarUrl: group.avatar });
        log.info({ event: "contact_enriched", accountId, sourceId, source: "zca-group" }, "group contact enriched");
      } catch {
        // No zca session or the group lookup failed — leave the current name in place.
      }
      return;
    }
    try {
      const profile = await sessions.getUserInfo(accountId, senderUid);
      await chatwoot.updateContact(identifier, sourceId, { name: profile.displayName, avatarUrl: profile.avatar });
      log.info({ event: "contact_enriched", accountId, sourceId, source: "zca" }, "contact enriched");
      return;
    } catch {
      // No zca session (e.g. an OA account) or the zalo lookup failed — fall back to the OA API.
    }
    if (!oaProfile) return;
    try {
      const p = await oaProfile(accountId, senderUid);
      if (p?.displayName) {
        await chatwoot.updateContact(identifier, sourceId, { name: p.displayName, avatarUrl: p.avatar });
        log.info({ event: "contact_enriched", accountId, sourceId, source: "oa" }, "contact enriched");
        if (p.sharedInfo) await applyContactInfo(chatwoot, identifier, sourceId, p.sharedInfo, log);
      }
    } catch {
      // best-effort; leave the temporary name in place
    }
  };
}
