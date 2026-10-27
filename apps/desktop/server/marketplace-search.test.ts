import { describe, expect, it } from "vitest";
import { marketplaceSearchText, searchMarketplace } from "./marketplace-search.ts";

const catalog = [
  { slug: "gmail", label: "Gmail", blurb: "Read and send email", categories: ["Email"] },
  { slug: "googlesheets", label: "Google Sheets", blurb: "Spreadsheets: bảng tính" },
  { slug: "notion", label: "Notion", blurb: "Notes and docs" },
  { slug: "tavily", label: "Tavily", blurb: "Web search", noAuth: true },
];

describe("2.3 marketplace_search", () => {
  it("ranks a name match first and folds Vietnamese", () => {
    expect(searchMarketplace(catalog, "notion docs", new Set()).map((hit) => hit.slug)).toEqual(["notion"]);
    expect(searchMarketplace(catalog, "bang tinh", new Set()).map((hit) => hit.slug)).toEqual(["googlesheets"]);
    expect(searchMarketplace(catalog, "email", new Set(["gmail"]))[0]).toMatchObject({ slug: "gmail", connected: true });
    expect(searchMarketplace(catalog, "", new Set())).toEqual([]);
  });
  it("tells the agent to offer the install card, not Settings", () => {
    const text = marketplaceSearchText("search", searchMarketplace(catalog, "search", new Set()));
    expect(text).toContain("Tavily (slug tavily) — needs no sign-in");
    expect(text).toContain("marketplace_install");
    expect(text).not.toMatch(/Settings/);
    expect(marketplaceSearchText("zzz", [])).toMatch(/No service/);
  });
});
