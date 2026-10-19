import type { Pool } from "pg";

export type AccountStatus = "pending_qr" | "connected" | "reconnecting" | "expired" | "logged_out";
export type AccountType = "personal" | "oa";

export interface ZaloAccount {
  id: number;
  label: string;
  type: AccountType;
  zaloUid: string | null;
  zaloOaId: string | null;
  chatwootInboxIdentifier: string;
  chatwootInboxId: number | null;
  chatwootAccountId: number | null;
  status: AccountStatus;
  proxyId: number | null;
  proxyPending: boolean;
}

interface Row {
  id: string;
  label: string;
  type: AccountType;
  zalo_uid: string | null;
  zalo_oa_id: string | null;
  chatwoot_inbox_identifier: string;
  chatwoot_inbox_id: string | null;
  chatwoot_account_id: string | null;
  status: AccountStatus;
  proxy_id: string | null;
  proxy_pending: boolean;
}

export function rowToAccount(r: Row): ZaloAccount {
  return {
    id: Number(r.id),
    label: r.label,
    type: r.type,
    zaloUid: r.zalo_uid,
    zaloOaId: r.zalo_oa_id,
    chatwootInboxIdentifier: r.chatwoot_inbox_identifier,
    chatwootInboxId: r.chatwoot_inbox_id == null ? null : Number(r.chatwoot_inbox_id),
    chatwootAccountId: r.chatwoot_account_id == null ? null : Number(r.chatwoot_account_id),
    status: r.status,
    proxyId: r.proxy_id == null ? null : Number(r.proxy_id),
    proxyPending: r.proxy_pending,
  };
}

export class AccountRepo {
  constructor(private pool: Pool) {}

  async create(input: {
    label: string;
    chatwootInboxIdentifier: string;
    chatwootInboxId?: number;
    proxyId?: number | null;
    chatwootAccountId?: number | null;
  }): Promise<ZaloAccount> {
    const res = await this.pool.query<Row>(
      `INSERT INTO zalo_accounts (label, chatwoot_inbox_identifier, chatwoot_inbox_id, proxy_id, chatwoot_account_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.label, input.chatwootInboxIdentifier, input.chatwootInboxId ?? null, input.proxyId ?? null, input.chatwootAccountId ?? null],
    );
    return rowToAccount(res.rows[0]);
  }

  async createOa(input: { label: string; chatwootInboxIdentifier: string; chatwootInboxId?: number; chatwootAccountId?: number | null }): Promise<ZaloAccount> {
    const res = await this.pool.query<Row>(
      `INSERT INTO zalo_accounts (label, type, status, chatwoot_inbox_identifier, chatwoot_inbox_id, chatwoot_account_id)
       VALUES ($1, 'oa', 'pending_qr', $2, $3, $4) RETURNING *`,
      [input.label, input.chatwootInboxIdentifier, input.chatwootInboxId ?? null, input.chatwootAccountId ?? null],
    );
    return rowToAccount(res.rows[0]);
  }

  async findById(id: number): Promise<ZaloAccount | null> {
    const res = await this.pool.query<Row>(
      "SELECT * FROM zalo_accounts WHERE id = $1",
      [id],
    );
    return res.rows[0] ? rowToAccount(res.rows[0]) : null;
  }

  async findByInboxIdentifier(identifier: string): Promise<ZaloAccount | null> {
    const res = await this.pool.query<Row>(
      "SELECT * FROM zalo_accounts WHERE chatwoot_inbox_identifier = $1",
      [identifier],
    );
    return res.rows[0] ? rowToAccount(res.rows[0]) : null;
  }

  async findByOaId(oaId: string): Promise<ZaloAccount | null> {
    const res = await this.pool.query<Row>("SELECT * FROM zalo_accounts WHERE zalo_oa_id = $1", [oaId]);
    return res.rows[0] ? rowToAccount(res.rows[0]) : null;
  }

  async listAll(): Promise<ZaloAccount[]> {
    const res = await this.pool.query<Row>(
      "SELECT * FROM zalo_accounts ORDER BY id",
    );
    return res.rows.map(rowToAccount);
  }

  async updateStatus(id: number, status: AccountStatus, zaloUid?: string): Promise<void> {
    await this.pool.query(
      `UPDATE zalo_accounts
       SET status = $2, zalo_uid = COALESCE($3, zalo_uid), updated_at = now()
       WHERE id = $1`,
      [id, status, zaloUid ?? null],
    );
  }

  async setProxy(id: number, proxyId: number | null): Promise<ZaloAccount | null> {
    const res = await this.pool.query<Row>(
      `UPDATE zalo_accounts
       SET proxy_id = $2, proxy_pending = true, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, proxyId],
    );
    return res.rows[0] ? rowToAccount(res.rows[0]) : null;
  }

  async clearProxyPending(id: number): Promise<void> {
    await this.pool.query(
      "UPDATE zalo_accounts SET proxy_pending = false, updated_at = now() WHERE id = $1",
      [id],
    );
  }

  async listByProxy(proxyId: number): Promise<ZaloAccount[]> {
    const res = await this.pool.query<Row>("SELECT * FROM zalo_accounts WHERE proxy_id = $1 ORDER BY id", [proxyId]);
    return res.rows.map(rowToAccount);
  }

  async setOaId(id: number, oaId: string): Promise<void> {
    await this.pool.query("UPDATE zalo_accounts SET zalo_oa_id = $2, updated_at = now() WHERE id = $1", [id, oaId]);
  }

  async getWatermark(id: number): Promise<number | null> {
    const r = await this.pool.query<{ backfill_watermark_ms: string | null }>(
      "SELECT backfill_watermark_ms FROM zalo_accounts WHERE id = $1",
      [id],
    );
    const v = r.rows[0]?.backfill_watermark_ms;
    return v == null ? null : Number(v);
  }

  async advanceWatermark(id: number, ms: number): Promise<void> {
    await this.pool.query(
      "UPDATE zalo_accounts SET backfill_watermark_ms = GREATEST(COALESCE(backfill_watermark_ms, 0), $2), updated_at = now() WHERE id = $1",
      [id, ms],
    );
  }

  async update(
    id: number,
    patch: { label?: string; chatwootInboxIdentifier?: string; chatwootInboxId?: number | null; chatwootAccountId?: number | null },
  ): Promise<ZaloAccount | null> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (patch.label !== undefined) { sets.push(`label = $${++i}`); vals.push(patch.label); }
    if (patch.chatwootInboxIdentifier !== undefined) { sets.push(`chatwoot_inbox_identifier = $${++i}`); vals.push(patch.chatwootInboxIdentifier); }
    if (patch.chatwootInboxId !== undefined) { sets.push(`chatwoot_inbox_id = $${++i}`); vals.push(patch.chatwootInboxId); }
    if (patch.chatwootAccountId !== undefined) { sets.push(`chatwoot_account_id = $${++i}`); vals.push(patch.chatwootAccountId); }
    if (!sets.length) return this.findById(id);
    const res = await this.pool.query<Row>(
      `UPDATE zalo_accounts SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...vals],
    );
    return res.rows[0] ? rowToAccount(res.rows[0]) : null;
  }

  /** Hard-delete an account. DB ON DELETE CASCADE removes sessions, conversations,
   *  message_map, and oa_tokens. Returns false if no row matched. */
  async delete(id: number): Promise<boolean> {
    const r = await this.pool.query("DELETE FROM zalo_accounts WHERE id = $1", [id]);
    return (r.rowCount ?? 0) > 0;
  }
}
