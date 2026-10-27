import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  frozenCatalogStats,
  frozenModelOptions,
  frozenProviderIdForApiUrl,
  listFrozenProviders,
  loadFrozenCatalog,
  providersChecksumPayload,
  resetFrozenCatalogMemo,
  searchFrozenCatalog,
  sha256Hex,
} from "./frozen.ts";
import { MODEL_CATALOG_SCHEMA } from "./trim.ts";

beforeEach(() => resetFrozenCatalogMemo());

describe("frozen model catalog", () => {
  it("loads the bundled snapshot with provenance and expected counts", () => {
    const catalog = loadFrozenCatalog();
    expect(catalog.schema).toBe(MODEL_CATALOG_SCHEMA);
    expect(catalog.source).toMatchObject({
      name: "models.dev",
      url: "https://models.dev/api.json",
      commit: "7f91a155297c92203cc1111dac7f0ca42d478f22",
      license: "MIT",
    });
    expect(catalog.source.fetchedAt).toBe("2026-09-30T05:32:26.000Z");
    expect(catalog.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(catalog.source.sha256).toBe(sha256Hex(providersChecksumPayload(
      JSON.parse(readFileSync(join(import.meta.dirname, "models-dev.snapshot.json"), "utf8")).providers,
    )));

    const stats = frozenCatalogStats(catalog);
    expect(stats.providers).toBe(220);
    expect(stats.models).toBe(6859);
  });

  it("has unique provider ids and unique model ids within each provider", () => {
    const catalog = loadFrozenCatalog();
    const providerIds = Object.keys(catalog.providers);
    expect(new Set(providerIds).size).toBe(providerIds.length);
    for (const provider of Object.values(catalog.providers)) {
      const modelIds = Object.keys(provider.models);
      expect(new Set(modelIds).size).toBe(modelIds.length);
      expect(provider.id).toBeTruthy();
      expect(provider.name).toBeTruthy();
    }
  });

  it("rejects a tampered checksum", () => {
    const raw = readFileSync(join(import.meta.dirname, "models-dev.snapshot.json"), "utf8");
    const doc = JSON.parse(raw);
    doc.source.sha256 = createHash("sha256").update("tampered").digest("hex");
    expect(() => loadFrozenCatalog(() => JSON.stringify(doc))).toThrow(/sha256/);
  });

  it("lists every provider without duplicates", () => {
    const rows = listFrozenProviders();
    expect(rows.length).toBe(220);
    expect(new Set(rows.map((row) => row.id)).size).toBe(220);
    expect(rows.reduce((n, row) => n + row.modelCount, 0)).toBe(6859);
  });

  it("searches providers and models for the picker show-all path", () => {
    const byProvider = searchFrozenCatalog("openrouter", { limit: 50 });
    expect(byProvider.length).toBeGreaterThan(0);
    expect(byProvider.every((hit) => hit.providerId === "openrouter" || hit.modelId.toLowerCase().includes("openrouter") || hit.modelName.toLowerCase().includes("openrouter") || hit.providerName.toLowerCase().includes("openrouter"))).toBe(true);

    const byModel = searchFrozenCatalog("claude-sonnet", { limit: 20 });
    expect(byModel.length).toBeGreaterThan(0);
    expect(byModel.some((hit) => hit.modelId.toLowerCase().includes("claude-sonnet"))).toBe(true);

    const scoped = searchFrozenCatalog("claude", { providerId: "openrouter", limit: 30 });
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((hit) => hit.providerId === "openrouter")).toBe(true);

    expect(searchFrozenCatalog("   ")).toEqual([]);
    expect(searchFrozenCatalog("")).toEqual([]);
  });

  it("maps OpenAI-compatible URLs onto frozen provider ids and model options", () => {
    expect(frozenProviderIdForApiUrl("https://openrouter.ai/api/v1")).toBe("openrouter");
    expect(frozenProviderIdForApiUrl("https://api.openai.com/v1")).toBe("openai");
    const options = frozenModelOptions("openrouter");
    expect(options.length).toBeGreaterThan(100);
    expect(new Set(options.map((option) => option.id)).size).toBe(options.length);
    expect(options[0]).toMatchObject({ id: expect.any(String), label: expect.any(String) });
  });
});
