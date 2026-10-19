import { describe, it, expect } from "vitest";
import { rowToAccount } from "../../src/store/accountRepo.js";

describe("rowToAccount", () => {
  it("maps an OA account row", () => {
    const acc = rowToAccount({
      id: "5", label: "Shop OA", zalo_uid: null, zalo_oa_id: "oa987",
      chatwoot_inbox_identifier: "ident-9", chatwoot_inbox_id: "9",
      status: "connected", type: "oa",
    });
    expect(acc).toMatchObject({ id: 5, type: "oa", zaloOaId: "oa987", chatwootInboxId: 9 });
  });
  it("defaults a legacy row without type to personal", () => {
    const acc = rowToAccount({
      id: "1", label: "A", zalo_uid: "u1", zalo_oa_id: null,
      chatwoot_inbox_identifier: "ident-1", chatwoot_inbox_id: null, status: "connected", type: "personal",
    });
    expect(acc.type).toBe("personal");
  });
});
