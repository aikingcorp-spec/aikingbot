import { describe, it, expect, vi } from "vitest";

import { makeEnricher } from "../../src/handlers/enrichment.js";

describe("makeEnricher", () => {
  it("fetches the profile and updates the contact", async () => {
    const sessions = { getUserInfo: vi.fn(async () => ({ uid: "84900", displayName: "Nguyen Van A", avatar: "http://a/x.jpg" })) };
    const chatwoot = { updateContact: vi.fn(async () => {}) };
    const enrich = makeEnricher(sessions as any, chatwoot as any);
    await enrich(1, "user:84900", "ident-1", "84900");
    expect(chatwoot.updateContact).toHaveBeenCalledWith("ident-1", "user:84900", {
      name: "Nguyen Van A", avatarUrl: "http://a/x.jpg",
    });
  });

  it("swallows errors from getUserInfo", async () => {
    const sessions = { getUserInfo: vi.fn(async () => { throw new Error("zalo down"); }) };
    const chatwoot = { updateContact: vi.fn(async () => {}) };
    const enrich = makeEnricher(sessions as any, chatwoot as any);
    await expect(enrich(1, "user:1", "ident-1", "1")).resolves.toBeUndefined();
    expect(chatwoot.updateContact).not.toHaveBeenCalled();
  });

  it("falls back to the OA profile resolver when there is no zca session", async () => {
    const sessions = { getUserInfo: vi.fn(async () => { throw new Error("no session"); }) };
    const chatwoot = { updateContact: vi.fn(async () => {}) };
    const oaProfile = vi.fn(async () => ({ displayName: "Khách OA", avatar: "http://a/oa.jpg" }));
    const enrich = makeEnricher(sessions as any, chatwoot as any, oaProfile);
    await enrich(3, "oa-user:u1", "ident-oa", "u1");
    expect(oaProfile).toHaveBeenCalledWith(3, "u1");
    expect(chatwoot.updateContact).toHaveBeenCalledWith("ident-oa", "oa-user:u1", {
      name: "Khách OA", avatarUrl: "http://a/oa.jpg",
    });
  });

  it("leaves the contact as-is when the OA resolver returns null", async () => {
    const sessions = { getUserInfo: vi.fn(async () => { throw new Error("no session"); }) };
    const chatwoot = { updateContact: vi.fn(async () => {}) };
    const oaProfile = vi.fn(async () => null);
    const enrich = makeEnricher(sessions as any, chatwoot as any, oaProfile);
    await enrich(3, "oa-user:u1", "ident-oa", "u1");
    expect(chatwoot.updateContact).not.toHaveBeenCalled();
  });

  it("logs contact_enriched after updating the contact", async () => {
    const sessions = { getUserInfo: vi.fn(async () => ({ uid: "1", displayName: "A", avatar: "x" })) };
    const chatwoot = { updateContact: vi.fn(async () => {}) };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const enrich = makeEnricher(sessions as any, chatwoot as any, undefined, log as any);
    await enrich(2, "user:1", "ident-1", "1");
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "contact_enriched", accountId: 2 }),
      expect.any(String),
    );
  });

  it("persists sharedInfo from the OA profile to the contact (passive)", async () => {
    const sessions = { getUserInfo: vi.fn(async () => { throw new Error("no session"); }) };
    const updateContact = vi.fn(async () => {});
    const chatwoot = { updateContact };
    const oaProfile = vi.fn(async () => ({ displayName: "Khách OA", avatar: "http://a/oa.jpg", sharedInfo: { phone: "0900", address: "1 Le Loi" } }));
    const enrich = makeEnricher(sessions as any, chatwoot as any, oaProfile);
    await enrich(3, "oa-user:u1", "ident-oa", "u1");
    expect(updateContact).toHaveBeenCalledWith("ident-oa", "oa-user:u1", { name: "Khách OA", avatarUrl: "http://a/oa.jpg" });
    expect(updateContact).toHaveBeenCalledWith("ident-oa", "oa-user:u1", { name: undefined, phoneNumber: "0900", customAttributes: { zalo_address: "1 Le Loi" } });
  });
});
