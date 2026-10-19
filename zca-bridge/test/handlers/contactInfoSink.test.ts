import { describe, it, expect, vi } from "vitest";
import { applyContactInfo } from "../../src/handlers/contactInfoSink.js";

describe("applyContactInfo", () => {
  it("maps phone/name and address fields to custom_attributes", async () => {
    const chatwoot = { updateContact: vi.fn(async () => {}) };
    await applyContactInfo(chatwoot as any, "ident-1", "oa-user:u1", {
      name: "Nguyen A", phone: "0900", address: "1 Le Loi", city: "HCM", district: "Q1",
    });
    expect(chatwoot.updateContact).toHaveBeenCalledWith("ident-1", "oa-user:u1", {
      name: "Nguyen A", phoneNumber: "0900",
      customAttributes: { zalo_address: "1 Le Loi", zalo_city: "HCM", zalo_district: "Q1" },
    });
  });

  it("omits empty fields and sends no custom_attributes when none present", async () => {
    const chatwoot = { updateContact: vi.fn(async () => {}) };
    await applyContactInfo(chatwoot as any, "ident-1", "oa-user:u1", { phone: "0900" });
    expect(chatwoot.updateContact).toHaveBeenCalledWith("ident-1", "oa-user:u1", {
      name: undefined, phoneNumber: "0900", customAttributes: undefined,
    });
  });

  it("swallows updateContact errors (best-effort)", async () => {
    const chatwoot = { updateContact: vi.fn(async () => { throw new Error("404"); }) };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await expect(applyContactInfo(chatwoot as any, "ident-1", "oa-user:u1", { phone: "0900" }, log as any)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "contact_info_failed" }), expect.any(String));
  });
});
