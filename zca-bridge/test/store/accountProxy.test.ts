import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { createPool } from "../../src/store/db.js";
import { runMigrations } from "../../src/store/migrate.js";
import { AccountRepo } from "../../src/store/accountRepo.js";
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

d("AccountRepo proxy", () => {
  it("defaults to no proxy and not pending", async () => {
    const acc = await new AccountRepo(pool).create({ label: "A", chatwootInboxIdentifier: "ci-a" });
    expect(acc.proxyId).toBeNull();
    expect(acc.proxyPending).toBe(false);
  });

  it("setProxy assigns and marks pending; clearProxyPending resets", async () => {
    const accounts = new AccountRepo(pool);
    const proxy = await new ProxyRepo(pool, key).create({ label: "P", protocol: "socks5", host: "h", port: 1080, username: null, password: null });
    const acc = await accounts.create({ label: "B", chatwootInboxIdentifier: "ci-b" });
    const after = await accounts.setProxy(acc.id, proxy.id);
    expect(after?.proxyId).toBe(proxy.id);
    expect(after?.proxyPending).toBe(true);
    await accounts.clearProxyPending(acc.id);
    const cleared = await accounts.findById(acc.id);
    expect(cleared?.proxyPending).toBe(false);
  });

  it("listByProxy returns accounts using a proxy", async () => {
    const accounts = new AccountRepo(pool);
    const proxy = await new ProxyRepo(pool, key).create({ label: "P2", protocol: "http", host: "h", port: 8080, username: null, password: null });
    const a1 = await accounts.create({ label: "C1", chatwootInboxIdentifier: "ci-c1" });
    await accounts.setProxy(a1.id, proxy.id);
    const using = await accounts.listByProxy(proxy.id);
    expect(using.map((a) => a.id)).toContain(a1.id);
  });

  it("detaching (setProxy null) clears the proxy and marks pending", async () => {
    const accounts = new AccountRepo(pool);
    const proxy = await new ProxyRepo(pool, key).create({ label: "P3", protocol: "http", host: "h", port: 8080, username: null, password: null });
    const acc = await accounts.create({ label: "D", chatwootInboxIdentifier: "ci-d" });
    await accounts.setProxy(acc.id, proxy.id);
    await accounts.clearProxyPending(acc.id);
    const detached = await accounts.setProxy(acc.id, null);
    expect(detached?.proxyId).toBeNull();
    expect(detached?.proxyPending).toBe(true);
  });
});
