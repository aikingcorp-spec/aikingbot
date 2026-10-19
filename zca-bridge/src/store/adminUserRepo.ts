import type { Pool } from "pg";

export interface AdminUser { id: number; username: string; passHash: string; salt: string; }
interface Row { id: string; username: string; pass_hash: string; salt: string; }

export class AdminUserRepo {
  constructor(private pool: Pool) {}

  async hasAny(): Promise<boolean> {
    const r = await this.pool.query("SELECT 1 FROM admin_users LIMIT 1");
    return (r.rowCount ?? 0) > 0;
  }

  async create(username: string, passHash: string, salt: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO admin_users (username, pass_hash, salt) VALUES ($1, $2, $3)",
      [username, passHash, salt],
    );
  }

  async findByUsername(username: string): Promise<AdminUser | null> {
    const r = await this.pool.query<Row>("SELECT * FROM admin_users WHERE username = $1", [username]);
    const row = r.rows[0];
    return row ? { id: Number(row.id), username: row.username, passHash: row.pass_hash, salt: row.salt } : null;
  }
}
