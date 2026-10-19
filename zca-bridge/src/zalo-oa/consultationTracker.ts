import { ConversationRepo } from "../store/conversationRepo.js";
import { evaluate } from "./consultationWindow.js";

type ConvWindowRepo = Pick<ConversationRepo, "markInbound" | "getWindow" | "setCsCount">;

/** Tracks the OA 48h consultation window per conversation and posts threshold warnings. */
export class ConsultationTracker {
  constructor(
    private conversations: ConvWindowRepo,
    private postNote: (accountId: number, sourceId: string, text: string) => Promise<void>,
  ) {}

  async onInbound(accountId: number, sourceId: string): Promise<void> {
    await this.conversations.markInbound(accountId, sourceId);
  }

  async onOutbound(accountId: number, sourceId: string): Promise<void> {
    const state = await this.conversations.getWindow(accountId, sourceId);
    const d = evaluate(state, new Date());
    if (d.newCount !== state.sentCount) await this.conversations.setCsCount(accountId, sourceId, d.newCount);
    if (d.warning) await this.postNote(accountId, sourceId, d.warning);
  }
}
