import { describe, it, expect, vi } from "vitest";
import { AdminUserRepo } from "../../src/store/adminUserRepo.js";

describe("AdminUserRepo", () => {
  it("hasAny reflects whether a row exists", async () => {
    const full = { query: vi.fn(async () => ({ rows: [{ x: 1 }], rowCount: 1 })) };
    expect(await new AdminUserRepo(full as any).hasAny()).toBe(true);
    const empty = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    expect(await new AdminUserRepo(empty as any).hasAny()).toBe(false);
  });

  it("findByUsername maps a row to camelCase", async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: "5", username: "admin", pass_hash: "h", salt: "s" }], rowCount: 1 })) };
    const u = await new AdminUserRepo(pool as any).findByUsername("admin");
    expect(u).toEqual({ id: 5, username: "admin", passHash: "h", salt: "s" });
  });

  it("findByUsername returns null when missing", async () => {
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    expect(await new AdminUserRepo(pool as any).findByUsername("x")).toBeNull();
  });

  it("create inserts username, hash, salt", async () => {
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };
    await new AdminUserRepo(pool as any).create("admin", "h", "s");
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO admin_users"), ["admin", "h", "s"]);
  });
});
