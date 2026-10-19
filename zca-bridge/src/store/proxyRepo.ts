import type { Pool } from "pg";
import { encryptCredentials, decryptCredentials } from "../crypto/credentials.js";
import type { ProxyProtocol } from "../zalo/proxyOptions.js";

/** API-safe shape: never includes the password. */
export interface Proxy {
  id: number;
  label: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string | null;
  hasPassword: boolean;
}

/** Internal shape with the decrypted password, for building the proxy agent. */
export interface ProxyWithSecret extends Omit<Proxy, "hasPassword"> {
  password: string | null;
}

export interface ProxyInput {
  label: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

interface Row {
  id: string;
  label: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string | null;
  password_enc: string | null;
}

function toProxy(r: Row): Proxy {
  return {
    id: Number(r.id),
    label: r.label,
    protocol: r.protocol,
    host: r.host,
    port: Number(r.port),
    username: r.username,
    hasPassword: r.password_enc != null,
  };
}

export class ProxyRepo {
  constructor(private pool: Pool, private key: Buffer) {}

  async create(input: ProxyInput): Promise<Proxy> {
    const enc = input.password ? encryptCredentials(input.password, this.key) : null;
    const res = await this.pool.query<Row>(
      `INSERT INTO proxies (label, protocol, host, port, username, password_enc)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.label, input.protocol, input.host, input.port, input.username, enc],
    );
    return toProxy(res.rows[0]);
  }

  async list(): Promise<Proxy[]> {
    const res = await this.pool.query<Row>("SELECT * FROM proxies ORDER BY id");
    return res.rows.map(toProxy);
  }

  /** Decrypted, for internal use (building the agent). Never expose over the API. */
  async get(id: number): Promise<ProxyWithSecret | null> {
    const res = await this.pool.query<Row>("SELECT * FROM proxies WHERE id = $1", [id]);
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      label: r.label,
      protocol: r.protocol,
      host: r.host,
      port: Number(r.port),
      username: r.username,
      password: r.password_enc ? decryptCredentials<string>(r.password_enc, this.key) : null,
    };
  }

  /** Patch. Omit `password` to keep the stored one; pass `null` to clear it. */
  async update(
    id: number,
    patch: Partial<Omit<ProxyInput, "password">> & { password?: string | null },
  ): Promise<Proxy | null> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const push = (col: string, val: unknown) => { sets.push(`${col} = $${++i}`); vals.push(val); };
    if (patch.label !== undefined) push("label", patch.label);
    if (patch.protocol !== undefined) push("protocol", patch.protocol);
    if (patch.host !== undefined) push("host", patch.host);
    if (patch.port !== undefined) push("port", patch.port);
    if (patch.username !== undefined) push("username", patch.username);
    if (patch.password !== undefined) push("password_enc", patch.password ? encryptCredentials(patch.password, this.key) : null);
    if (!sets.length) {
      const cur = await this.pool.query<Row>("SELECT * FROM proxies WHERE id = $1", [id]);
      return cur.rows[0] ? toProxy(cur.rows[0]) : null;
    }
    const res = await this.pool.query<Row>(
      `UPDATE proxies SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...vals],
    );
    return res.rows[0] ? toProxy(res.rows[0]) : null;
  }

  async delete(id: number): Promise<boolean> {
    const r = await this.pool.query("DELETE FROM proxies WHERE id = $1", [id]);
    return (r.rowCount ?? 0) > 0;
  }
}
