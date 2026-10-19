import type { Pool } from "pg";
import { DEFAULT_MATRIX, type PermissionMatrix } from "./permissions.js";

export interface RbacUser { id: number; username: string; role: string; }
interface UserRow { id: string; username: string; role: string; }
interface PermRow { role: string; permission: string; }

export class RbacRepo {
  constructor(private pool: Pool) {}

  /** Idempotent: thêm cột role (backfill owner), bảng role_permissions, seed ma trận mặc định 1 lần. */
  async ensureSchema(): Promise<void> {
    await this.pool.query(
      `ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'owner'
       CHECK (role IN ('owner','admin','operator'))`,
    );
    await this.pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS admin_users_username_uniq ON admin_users (username)`,
    );
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS role_permissions (
         role text NOT NULL, permission text NOT NULL, PRIMARY KEY (role, permission))`,
    );
    const seeded = await this.pool.query("SELECT 1 FROM role_permissions LIMIT 1");
    if ((seeded.rowCount ?? 0) === 0) {
      for (const [role, keys] of Object.entries(DEFAULT_MATRIX)) {
        for (const key of keys) {
          await this.pool.query(
            "INSERT INTO role_permissions (role, permission) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            [role, key],
          );
        }
      }
    }
  }

  async getRole(username: string): Promise<string | null> {
    const r = await this.pool.query<{ role: string }>(
      "SELECT role FROM admin_users WHERE username = $1", [username]);
    return r.rows[0]?.role ?? null;
  }

  async listUsers(): Promise<RbacUser[]> {
    const r = await this.pool.query<UserRow>("SELECT id, username, role FROM admin_users ORDER BY id");
    return r.rows.map((x) => ({ id: Number(x.id), username: x.username, role: x.role }));
  }

  async createUser(username: string, passHash: string, salt: string, role: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO admin_users (username, pass_hash, salt, role) VALUES ($1,$2,$3,$4)",
      [username, passHash, salt, role]);
  }

  async setRole(id: number, role: string): Promise<void> {
    await this.pool.query("UPDATE admin_users SET role = $2 WHERE id = $1", [id, role]);
  }

  async setPassword(id: number, passHash: string, salt: string): Promise<void> {
    await this.pool.query("UPDATE admin_users SET pass_hash = $2, salt = $3 WHERE id = $1", [id, passHash, salt]);
  }

  async deleteUser(id: number): Promise<boolean> {
    const r = await this.pool.query("DELETE FROM admin_users WHERE id = $1", [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async countOwners(): Promise<number> {
    const r = await this.pool.query<{ n: string }>("SELECT count(*)::int AS n FROM admin_users WHERE role = 'owner'");
    return Number(r.rows[0]?.n ?? 0);
  }

  async findById(id: number): Promise<RbacUser | null> {
    const r = await this.pool.query<UserRow>("SELECT id, username, role FROM admin_users WHERE id = $1", [id]);
    const x = r.rows[0];
    return x ? { id: Number(x.id), username: x.username, role: x.role } : null;
  }

  async getMatrix(): Promise<PermissionMatrix> {
    const r = await this.pool.query<PermRow>("SELECT role, permission FROM role_permissions");
    const out: PermissionMatrix = {};
    for (const row of r.rows) (out[row.role] ??= []).push(row.permission);
    return out;
  }

  /** Thay toàn bộ key của một role (transaction). */
  async setMatrix(role: string, keys: string[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM role_permissions WHERE role = $1", [role]);
      for (const key of keys) {
        await client.query("INSERT INTO role_permissions (role, permission) VALUES ($1,$2)", [role, key]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
