import type { Pool } from "pg";

export class ConversationRepo {
  constructor(private pool: Pool) {}

  async getChatwootId(accountId: number, sourceId: string): Promise<number | null> {
    const res = await this.pool.query<{ chatwoot_conversation_id: string }>(
      "SELECT chatwoot_conversation_id FROM zalo_conversations WHERE zalo_account_id = $1 AND source_id = $2",
      [accountId, sourceId]
    );
    return res.rows[0] ? Number(res.rows[0].chatwoot_conversation_id) : null;
  }

  /** Persist the conversation id. If one already exists for (account, source_id), keep it. */
  async saveChatwootId(accountId: number, sourceId: string, conversationId: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO zalo_conversations (zalo_account_id, source_id, chatwoot_conversation_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (zalo_account_id, source_id) DO NOTHING`,
      [accountId, sourceId, conversationId]
    );
  }

  /** Forget the Chatwoot conversation mapping (e.g. it was deleted in Chatwoot). */
  async clear(accountId: number, sourceId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM zalo_conversations WHERE zalo_account_id = $1 AND source_id = $2",
      [accountId, sourceId],
    );
  }

  async markInbound(accountId: number, sourceId: string): Promise<void> {
    await this.pool.query(
      "UPDATE zalo_conversations SET last_inbound_at = now(), cs_sent_count = 0 WHERE zalo_account_id = $1 AND source_id = $2",
      [accountId, sourceId],
    );
  }

  async getWindow(accountId: number, sourceId: string): Promise<{ lastInboundAt: Date | null; sentCount: number }> {
    const res = await this.pool.query<{ last_inbound_at: Date | null; cs_sent_count: number }>(
      "SELECT last_inbound_at, cs_sent_count FROM zalo_conversations WHERE zalo_account_id = $1 AND source_id = $2",
      [accountId, sourceId],
    );
    const row = res.rows[0];
    return row ? { lastInboundAt: row.last_inbound_at, sentCount: Number(row.cs_sent_count) } : { lastInboundAt: null, sentCount: 0 };
  }

  async setCsCount(accountId: number, sourceId: string, count: number): Promise<void> {
    await this.pool.query(
      "UPDATE zalo_conversations SET cs_sent_count = $3 WHERE zalo_account_id = $1 AND source_id = $2",
      [accountId, sourceId, count],
    );
  }

  async getInfoRequestedAt(accountId: number, sourceId: string): Promise<Date | null> {
    const res = await this.pool.query<{ info_requested_at: Date | null }>(
      "SELECT info_requested_at FROM zalo_conversations WHERE zalo_account_id = $1 AND source_id = $2",
      [accountId, sourceId],
    );
    return res.rows[0]?.info_requested_at ?? null;
  }

  /** Atomically claim the info-request slot. Returns true iff this call set it (row exists and was unclaimed). */
  async claimInfoRequest(accountId: number, sourceId: string, when: Date): Promise<boolean> {
    const res = await this.pool.query(
      "UPDATE zalo_conversations SET info_requested_at = $3 WHERE zalo_account_id = $1 AND source_id = $2 AND info_requested_at IS NULL",
      [accountId, sourceId, when],
    );
    return res.rowCount === 1;
  }

  /** Release a previously-claimed slot, used to roll back after a transient send failure. */
  async releaseInfoRequest(accountId: number, sourceId: string): Promise<void> {
    await this.pool.query(
      "UPDATE zalo_conversations SET info_requested_at = NULL WHERE zalo_account_id = $1 AND source_id = $2",
      [accountId, sourceId],
    );
  }
}
