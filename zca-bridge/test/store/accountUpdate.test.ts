import { describe, it, expect, vi } from "vitest";
import { AccountRepo } from "../../src/store/accountRepo.js";

const ROW = { id: "1", label: "New", type: "personal", zalo_uid: null, zalo_oa_id: null,
  chatwoot_inbox_identifier: "i9", chatwoot_inbox_id: "5", status: "connected" };

function stubPool(row: any) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  return { calls, query: vi.fn(async (sql: string, params: any[]) => { calls.push({ sql, params }); return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }; }) };
}

describe("AccountRepo.update", () => {
  it("updates only the provided fields", async () => {
    const pool = stubPool(ROW);
    const res = await new AccountRepo(pool as any).update(1, { label: "New", chatwootInboxIdentifier: "i9" });
    expect(pool.calls[0].sql).toContain("label = $2");
    expect(pool.calls[0].sql).toContain("chatwoot_inbox_identifier = $3");
    expect(pool.calls[0].params).toEqual([1, "New", "i9"]);
    expect(res?.label).toBe("New");
  });

  it("returns null when the row does not exist", async () => {
    const pool = stubPool(null);
    expect(await new AccountRepo(pool as any).update(99, { label: "X" })).toBeNull();
  });
});
