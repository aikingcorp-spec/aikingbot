import type { Pool } from "pg";
import type { QuoteSource } from "../zalo/types.js";

export class MappingRepo {
  constructor(private pool: Pool) {}

  /** Insert a message mapping. Returns false if (account, msgId) already existed. */
  async recordIfNew(input: {
    zaloAccountId: number;
    zaloMsgId: string;
    zaloThreadId: string;
    direction: "in" | "out";
    chatwootMessageId?: number;
    quoteSrc?: QuoteSource;
  }): Promise<boolean> {
    const res = await this.pool.query(
      `INSERT INTO message_map (zalo_account_id, zalo_msg_id, zalo_thread_id, direction, chatwoot_message_id, quote_src)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (zalo_account_id, zalo_msg_id) DO NOTHING`,
      [
        input.zaloAccountId,
        input.zaloMsgId,
        input.zaloThreadId,
        input.direction,
        input.chatwootMessageId ?? null,
        input.quoteSrc ? JSON.stringify(input.quoteSrc) : null,
      ],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** Reverse lookup by Zalo msg id. Used to detect self-event echoes. */
  async findByZaloMsgId(
    zaloAccountId: number,
    zaloMsgId: string,
  ): Promise<{ chatwootMessageId: number | null; direction: "in" | "out" } | null> {
    const res = await this.pool.query<{ chatwoot_message_id: string | null; direction: "in" | "out" }>(
      "SELECT chatwoot_message_id, direction FROM message_map WHERE zalo_account_id = $1 AND zalo_msg_id = $2",
      [zaloAccountId, zaloMsgId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      chatwootMessageId: row.chatwoot_message_id === null ? null : Number(row.chatwoot_message_id),
      direction: row.direction,
    };
  }

  /** Reverse lookup by Chatwoot message id. Used to skip re-sending native-origin messages and
   * to fetch the quote source when an agent replies to this message from Chatwoot. */
  async findByChatwootMessageId(chatwootMessageId: number): Promise<{ zaloMsgId: string; quoteSrc: QuoteSource | null } | null> {
    const res = await this.pool.query<{ zalo_msg_id: string; quote_src: QuoteSource | null }>(
      "SELECT zalo_msg_id, quote_src FROM message_map WHERE chatwoot_message_id = $1 LIMIT 1",
      [chatwootMessageId],
    );
    const row = res.rows[0];
    return row ? { zaloMsgId: row.zalo_msg_id, quoteSrc: row.quote_src ?? null } : null;
  }

  async saveCredentials(zaloAccountId: number, encrypted: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO zalo_sessions (zalo_account_id, encrypted_credentials, last_login_at)
       VALUES ($1, $2, now())
       ON CONFLICT (zalo_account_id)
       DO UPDATE SET encrypted_credentials = EXCLUDED.encrypted_credentials, last_login_at = now()`,
      [zaloAccountId, encrypted],
    );
  }

  async loadCredentials(zaloAccountId: number): Promise<string | null> {
    const res = await this.pool.query<{ encrypted_credentials: string }>(
      "SELECT encrypted_credentials FROM zalo_sessions WHERE zalo_account_id = $1",
      [zaloAccountId],
    );
    return res.rows[0]?.encrypted_credentials ?? null;
  }
}
