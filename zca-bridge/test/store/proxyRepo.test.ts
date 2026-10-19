import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { createPool } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { ProxyRepo } from "../../src/store/proxyRepo.js";
import type { Pool } from "pg";

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: Pool;
const key = randomBytes(32);

beforeAll(async () => {
  if (!url) return;
  await runMigrations(url);
  pool = createPool(url);
  await pool.query("TRUNCATE zalo_accounts, proxies RESTART IDENTITY CASCADE");
});
afterAll(async () => { if (pool) await pool.end(); });

d("ProxyRepo", () => {
  it("creates and lists with the password masked", async () => {
    const repo = new ProxyRepo(pool, key);
    const created = await repo.create({ label: "P1", protocol: "socks5", host: "1.2.3.4", port: 1080, username: "u", password: "secret" });
    expect(created.id).toBeGreaterThan(0);
    const list = await repo.list();
    const row = list.find((p) => p.id === created.id)!;
    expect(row.label).toBe("P1");
    expect(row.protocol).toBe("socks5");
    expect((row as Record<string, unknown>).password).toBeUndefined();
    expect((row as Record<string, unknown>).passwordEnc).toBeUndefined();
    expect(row.hasPassword).toBe(true);
  });

  it("get() returns the decrypted password for internal use", async () => {
    const repo = new ProxyRepo(pool, key);
    const created = await repo.create({ label: "P2", protocol: "http", host: "h", port: 8080, username: "u2", password: "pw2" });
    const full = await repo.get(created.id);
    expect(full?.password).toBe("pw2");
    expect(full?.username).toBe("u2");
  });

  it("updates fields; omitting password keeps the stored one", async () => {
    const repo = new ProxyRepo(pool, key);
    const created = await repo.create({ label: "P3", protocol: "http", host: "h", port: 1, username: "u", password: "keepme" });
    await repo.update(created.id, { label: "P3-renamed", port: 3128 });
    const full = await repo.get(created.id);
    expect(full?.label).toBe("P3-renamed");
    expect(full?.port).toBe(3128);
    expect(full?.password).toBe("keepme");
  });

  it("deletes", async () => {
    const repo = new ProxyRepo(pool, key);
    const created = await repo.create({ label: "P4", protocol: "https", host: "h", port: 443, username: null, password: null });
    expect(await repo.delete(created.id)).toBe(true);
    expect(await repo.get(created.id)).toBeNull();
  });
});
