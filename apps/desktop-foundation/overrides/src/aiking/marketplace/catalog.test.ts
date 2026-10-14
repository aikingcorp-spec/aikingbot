// Copyright (c) 2026 AIKING. The bundled catalog decodes through the stage 3
// contract, and a malformed remote document is rejected at the boundary.
import { describe, expect, it } from "vitest";
import { parseSkillMd } from "../../../shared/skill-md";
import { AIKING_CATALOG } from "./aiking-catalog";
import { BundledCatalogSource, CatalogDecodeError, HttpCatalogSource, decodeCatalog } from "./sources";

describe("AIKING catalog", () => {
  it("decodes, and every agent's pinned skills exist at the pinned version", async () => {
    const source = new BundledCatalogSource();
    const agents = await source.list({ kind: "agent" });
    expect(agents.items.length).toBeGreaterThanOrEqual(8);
    for (const agent of agents.items) {
      for (const pin of agent.skills) {
        const skill = await source.get(pin.id);
        expect(skill?.kind).toBe("skill");
        expect(skill?.version).toBe(pin.version);
      }
      for (const app of agent.apps) expect((await source.get(app))?.kind).toBe("app");
    }
  });

  it("ships SKILL.md text the host accepts, named as the listing says", async () => {
    const skills = await new BundledCatalogSource().list({ kind: "skill" });
    for (const skill of skills.items) {
      const parsed = parseSkillMd(skill.text);
      expect("error" in parsed ? parsed.error : parsed.name).toBe(skill.skillName);
    }
  });

  it("filters by text and category and lists categories", async () => {
    const source = new BundledCatalogSource();
    const media = await source.list({ kind: "agent", category: "Media" });
    expect(media.items.every((item) => item.category === "Media")).toBe(true);
    expect(media.categories).toContain("Research");
    const found = await source.list({ kind: "skill", text: "tiktok" });
    expect(found.items.map((item) => item.id)).toEqual(["tiktok-hook-writer"]);
  });

  it("rejects duplicate ids and malformed listings with a reason", () => {
    const copy = structuredClone(AIKING_CATALOG);
    copy.listings.push(copy.listings[0]!);
    expect(() => decodeCatalog(copy, "test")).toThrow(CatalogDecodeError);
    expect(() => decodeCatalog({ ...AIKING_CATALOG, schemaVersion: 2 }, "test")).toThrow(/schemaVersion/);
  });

  it("reads the same document over HTTP for stage 3", async () => {
    const fetcher = (async (url: URL | RequestInfo) => {
      const path = String(url);
      if (path.endsWith("/v1/catalog")) return new Response(JSON.stringify(AIKING_CATALOG), { status: 200 });
      if (path.includes("/v1/catalog/listings/missing")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(AIKING_CATALOG.listings[0]), { status: 200 });
    }) as typeof fetch;
    const remote = new HttpCatalogSource("https://core.example/api/", fetcher);
    expect((await remote.list({ kind: "app" })).items.length).toBeGreaterThan(5);
    expect(await remote.get("missing")).toBeNull();
    expect((await remote.get("tiktok-hook-writer"))?.id).toBe("tiktok-hook-writer");
  });
});
