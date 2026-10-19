import type { Pool } from "pg";

export interface InfoCardRow {
  enabled: boolean;
  title: string;
  subtitle: string;
  imageUrl: string;
}

const DEFAULTS: InfoCardRow = {
  enabled: false,
  title: "Cập nhật thông tin liên hệ",
  subtitle: "Vui lòng chia sẻ thông tin để chúng tôi hỗ trợ bạn nhanh và chính xác hơn.",
  imageUrl: "",
};

export class InfoCardRepo {
  constructor(private pool: Pool) {}

  async get(accountId: number): Promise<InfoCardRow> {
    const res = await this.pool.query<{ enabled: boolean; title: string; subtitle: string; image_url: string }>(
      "SELECT enabled, title, subtitle, image_url FROM oa_info_card WHERE account_id = $1",
      [accountId],
    );
    const row = res.rows[0];
    if (!row) return { ...DEFAULTS };
    return { enabled: !!row.enabled, title: row.title, subtitle: row.subtitle, imageUrl: row.image_url };
  }

  async upsert(accountId: number, row: InfoCardRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO oa_info_card (account_id, enabled, title, subtitle, image_url, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (account_id) DO UPDATE
         SET enabled = $2, title = $3, subtitle = $4, image_url = $5, updated_at = now()`,
      [accountId, row.enabled, row.title, row.subtitle, row.imageUrl],
    );
  }
}
