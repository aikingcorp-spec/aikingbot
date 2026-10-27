import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { at } from "../strings";
import { BundledCatalogSource } from "./sources";
import served from "../../../aiking/catalog.json" with { type: "json" };
import { AIKING_CATALOG } from "./aiking-catalog";
import { categoryLabel, listingCategory, listingSummary } from "./localize";

afterEach(() => setLocale("en"));

describe("Apps tab in Vietnamese", () => {
  it("every app listing has a Vietnamese summary and category, and the filter labels follow", async () => {
    const page = await new BundledCatalogSource().list({ kind: "app" });
    expect(page.items.length).toBeGreaterThan(10);
    setLocale("vi");
    for (const listing of page.items) {
      expect(listing.locales?.vi?.summary, listing.id).toBeTruthy();
      expect(listingSummary(listing)).not.toBe(listing.summary);
      expect(listingCategory(listing), listing.id).not.toBe(listing.category);
    }
    expect(categoryLabel("Developer tools", page)).toBe("Công cụ lập trình");
    expect(categoryLabel("Communication", page)).toBe("Giao tiếp");
    expect(at("market.official")).toBe("Chính thức");
    expect(at("market.updateSkillFor", { name: "Notion", bot: "Mai" })).toBe("Cập nhật Notion cho Mai");
    setLocale("en");
    const slack = page.items.find((l) => l.id === "slack")!;
    expect(listingCategory(slack)).toBe("Communication");
    expect(categoryLabel("Communication", page)).toBe("Communication");
    expect(at("market.official")).toBe("Official");
  });

  it("finds Vietnamese summaries by search", async () => {
    setLocale("vi");
    const page = await new BundledCatalogSource().list({ kind: "app", text: "bảng tính" });
    expect(page.items.map((l) => l.id)).toContain("googlesheets");
  });

  it("the catalog the server serves (aiking/catalog.json) carries the same Vietnamese text", () => {
    expect(served).toEqual(JSON.parse(JSON.stringify(AIKING_CATALOG)));
    expect((served as typeof AIKING_CATALOG).listings.filter((l) => l.locales?.vi).length).toBeGreaterThanOrEqual(14);
  });
});
