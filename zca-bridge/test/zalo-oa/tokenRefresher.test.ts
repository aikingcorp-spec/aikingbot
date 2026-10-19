import { describe, it, expect, vi } from "vitest";
import { refreshDueTokens } from "../../src/zalo-oa/tokenRefresher.js";

describe("refreshDueTokens", () => {
  it("refreshes each expiring account and persists the new pair", async () => {
    const tokens = {
      listExpiring: vi.fn(async () => [5]),
      load: vi.fn(async () => ({ accessToken: "AT", refreshToken: "RT", accessExpiresAt: new Date(0) })),
      save: vi.fn(async () => {}),
    };
    const oauth = { refresh: vi.fn(async () => ({ accessToken: "AT2", refreshToken: "RT2", expiresInSec: 3600 })) };
    const accounts = { updateStatus: vi.fn(async () => {}) };
    await refreshDueTokens({ tokens: tokens as any, oauth: oauth as any, accounts: accounts as any, log: { error: () => {} } }, new Date(1_000_000));
    expect(oauth.refresh).toHaveBeenCalledWith("RT");
    expect(tokens.save).toHaveBeenCalledWith(5, { accessToken: "AT2", refreshToken: "RT2" }, expect.any(Date));
  });

  it("marks the account expired when refresh fails", async () => {
    const tokens = { listExpiring: vi.fn(async () => [5]), load: vi.fn(async () => ({ accessToken: "AT", refreshToken: "RT", accessExpiresAt: new Date(0) })), save: vi.fn() };
    const oauth = { refresh: vi.fn(async () => { throw new Error("revoked"); }) };
    const accounts = { updateStatus: vi.fn(async () => {}) };
    await refreshDueTokens({ tokens: tokens as any, oauth: oauth as any, accounts: accounts as any, log: { error: () => {} } }, new Date(1_000_000));
    expect(accounts.updateStatus).toHaveBeenCalledWith(5, "expired");
  });
});
