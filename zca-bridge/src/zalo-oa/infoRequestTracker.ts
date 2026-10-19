import { ConversationRepo } from "../store/conversationRepo.js";
import { InfoCardRepo } from "../store/infoCardRepo.js";
import { InfoCard, InfoSendResult } from "./requestInfoSender.js";
import { decodeSourceId } from "../routing/sourceId.js";
import { EventLog, NOOP_LOG } from "../logging/eventLog.js";

type RequestStateRepo = Pick<ConversationRepo, "getInfoRequestedAt" | "claimInfoRequest" | "releaseInfoRequest">;
type CardRepo = Pick<InfoCardRepo, "get">;
type SendCard = (accountId: number, userId: string, card: InfoCard) => Promise<InfoSendResult>;

/** Sends the request_user_info card at most once per OA conversation. */
export class InfoRequestTracker {
  constructor(
    private conversations: RequestStateRepo,
    private infoCard: CardRepo,
    private send: SendCard,
    private log: EventLog = NOOP_LOG,
    private now: () => Date = () => new Date(),
  ) {}

  async onInbound(accountId: number, sourceId: string): Promise<void> {
    if (await this.conversations.getInfoRequestedAt(accountId, sourceId)) return;

    const card = await this.infoCard.get(accountId);
    if (!card.enabled || !card.imageUrl) {
      this.log.info({ event: "info_request_not_configured", accountId, sourceId }, "OA info card disabled or missing image");
      return;
    }

    // Atomically claim the slot before sending so concurrent inbounds can't double-send.
    // A lost claim (row already claimed, or conversation row absent) means: do nothing.
    if (!(await this.conversations.claimInfoRequest(accountId, sourceId, this.now()))) return;

    const { threadId: userId } = decodeSourceId(sourceId);
    try {
      const r = await this.send(accountId, userId, { title: card.title, subtitle: card.subtitle, imageUrl: card.imageUrl });
      if (!r.ok) {
        // Delivered but Zalo refused (e.g. quota). Keep the claim — ask-once, never re-ask.
        this.log.warn({ event: "info_request_failed", accountId, sourceId, code: r.code, message: r.message }, "OA info request returned error");
      }
    } catch (err) {
      // Network/transport failure: release the claim so the next inbound retries.
      this.log.warn({ event: "info_request_failed", accountId, sourceId, err }, "OA info request send threw");
      await this.conversations.releaseInfoRequest(accountId, sourceId).catch(() => {});
    }
  }
}
