import { ChatwootClient } from "../chatwoot/client.js";
import { ContactInfo } from "../zalo-oa/sharedInfo.js";
import { EventLog, NOOP_LOG } from "../logging/eventLog.js";

type ContactUpdater = Pick<ChatwootClient, "updateContact">;

/** Persist parsed OA contact info to the Chatwoot contact. Best-effort: never throws. */
export async function applyContactInfo(
  chatwoot: ContactUpdater,
  identifier: string,
  sourceId: string,
  info: ContactInfo,
  log: EventLog = NOOP_LOG,
): Promise<void> {
  // NOTE: Chatwoot's contact PATCH replaces the whole `custom_attributes` object, it does
  // not merge. This bridge owns the `zalo_*` namespace and is currently the only writer of
  // contact custom_attributes — if another writer is ever added, switch to read-merge-write
  // here to avoid clobbering their keys.
  const customAttributes: Record<string, string> = {};
  if (info.address) customAttributes.zalo_address = info.address;
  if (info.city) customAttributes.zalo_city = info.city;
  if (info.district) customAttributes.zalo_district = info.district;
  try {
    await chatwoot.updateContact(identifier, sourceId, {
      name: info.name || undefined,
      phoneNumber: info.phone || undefined,
      customAttributes: Object.keys(customAttributes).length ? customAttributes : undefined,
    });
    log.info({ event: "contact_info_saved", sourceId, hasPhone: !!info.phone }, "OA contact info saved");
  } catch (err) {
    log.warn({ event: "contact_info_failed", sourceId, err }, "failed to save OA contact info");
  }
}
