import { describe, it, expect } from "vitest";
import { parseSharedInfo } from "../../src/zalo-oa/sharedInfo.js";

describe("parseSharedInfo", () => {
  it("parses a user_submit_info webhook (info object)", () => {
    const event = { event_name: "user_submit_info", sender: { id: "u1" },
      info: { name: "Nguyen A", phone: "0900000000", address: "1 Le Loi", city: "HCM", district: "Q1" } };
    expect(parseSharedInfo(event)).toEqual({ name: "Nguyen A", phone: "0900000000", address: "1 Le Loi", city: "HCM", district: "Q1" });
  });

  it("parses a user/detail shared_info block under data", () => {
    const detail = { data: { display_name: "A", shared_info: { name: "B", phone: "0911", address: "X" } } };
    expect(parseSharedInfo(detail)).toEqual({ name: "B", phone: "0911", address: "X" });
  });

  it("parses a top-level shared_info block", () => {
    expect(parseSharedInfo({ shared_info: { phone: "0922" } })).toEqual({ phone: "0922" });
  });

  it("trims whitespace and drops empty fields", () => {
    expect(parseSharedInfo({ info: { name: "  C  ", phone: "", address: "   " } })).toEqual({ name: "C" });
  });

  it("returns null when nothing usable is present", () => {
    expect(parseSharedInfo({ event_name: "user_submit_info", sender: { id: "u1" } })).toBeNull();
    expect(parseSharedInfo(null)).toBeNull();
    expect(parseSharedInfo("nope")).toBeNull();
  });
});
