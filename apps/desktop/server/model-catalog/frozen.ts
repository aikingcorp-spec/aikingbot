/**
 * Frozen models.dev catalog: the bundled snapshot only — no network, no OpenCode
 * cache, no live refresh. Used by the model picker's show-all / search path and
 * as the prerequisite data for rc8 2.4 (custom keys for any catalog provider).
 *
 * Source: https://models.dev/api.json (MIT). Provenance lives in the snapshot's
 * `source` block (url, fetchedAt, sha256, commit, license).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODEL_CATALOG_SCHEMA,
  catalogStats,
  unpackCatalog,
  type CatalogProviders,
  type ModelCatalogDocument,
} from "./trim.ts";
import { SNAPSHOT_FILE } from "./catalog.ts";

export interface FrozenCatalogSource {
  name: "models.dev";
  url: string;
  /** ISO 8601 time the source api.json was fetched / frozen. */
  fetchedAt: string;
  /** SHA-256 (hex) of the frozen providers payload (canonical JSON). */
  sha256: string;
  repository?: string;
  commit?: string;
  license?: string;
}

export interface FrozenCatalog {
  schema: typeof MODEL_CATALOG_SCHEMA;
  updatedAt: string;
  source: FrozenCatalogSource;
  providers: CatalogProviders;
}

export interface FrozenCatalogHit {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  /** `providerId/modelId` — stable pick key for search results. */
  key: string;
}

export interface FrozenProviderSummary {
  id: string;
  name: string;
  modelCount: number;
  env: string[];
  api?: string;
  doc?: string;
}

function stripControls(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code <= 0x1f || code === 0x7f) continue;
    out += ch;
  }
  return out;
}
const SHA256_HEX = /^[0-9a-f]{64}$/;

let memo: FrozenCatalog | undefined;

/** Canonical UTF-8 of packed providers — the bytes `source.sha256` covers. */
export function providersChecksumPayload(providers: unknown): string {
  return JSON.stringify(providers);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function readBundledSnapshotText(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const path of [join(here, SNAPSHOT_FILE), join(here, "model-catalog", SNAPSHOT_FILE)]) {
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  throw new Error("bundled model catalog snapshot is missing");
}

function parseFrozenDocument(text: string): ModelCatalogDocument {
  let doc: ModelCatalogDocument;
  try {
    doc = JSON.parse(text) as ModelCatalogDocument;
  } catch {
    throw new Error("bundled model catalog snapshot is not valid JSON");
  }
  if (doc?.schema !== MODEL_CATALOG_SCHEMA) throw new Error(`bundled catalog schema must be ${MODEL_CATALOG_SCHEMA}`);
  if (Number.isNaN(new Date(doc?.updatedAt ?? "").getTime())) throw new Error("bundled catalog updatedAt must be an ISO time");
  if (doc?.source?.name !== "models.dev" || typeof doc.source.url !== "string" || !doc.source.url.startsWith("https://")) {
    throw new Error("bundled catalog source.url must be the models.dev https URL");
  }
  const fetchedAt = doc.source.fetchedAt ?? doc.updatedAt;
  if (Number.isNaN(new Date(fetchedAt).getTime())) throw new Error("bundled catalog source.fetchedAt must be an ISO time");
  const sha256 = doc.source.sha256;
  if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) {
    throw new Error("bundled catalog source.sha256 must be a 64-char lowercase hex digest");
  }
  const expected = sha256Hex(providersChecksumPayload(doc.providers));
  if (sha256 !== expected) throw new Error("bundled catalog source.sha256 does not match the providers payload");
  if (!doc.providers || typeof doc.providers !== "object") throw new Error("bundled catalog providers are missing");
  return doc;
}

/** Load the bundled frozen catalog once. Never fetches. Throws if the snapshot is missing or corrupt. */
export function loadFrozenCatalog(readText: () => string = readBundledSnapshotText): FrozenCatalog {
  if (memo) return memo;
  const doc = parseFrozenDocument(readText());
  const providers = unpackCatalog(doc.providers) as CatalogProviders;
  const trimmed = catalogStats(providers);
  if (trimmed.providers < 1 || trimmed.models < 1) throw new Error("bundled catalog held no usable providers");
  const fetchedAt = doc.source.fetchedAt ?? doc.updatedAt;
  memo = {
    schema: MODEL_CATALOG_SCHEMA,
    updatedAt: doc.updatedAt,
    source: {
      name: "models.dev",
      url: doc.source.url,
      fetchedAt,
      sha256: doc.source.sha256!,
      ...(doc.source.repository ? { repository: doc.source.repository } : {}),
      ...(doc.source.commit ? { commit: doc.source.commit } : {}),
      ...(doc.source.license ? { license: doc.source.license } : {}),
    },
    providers,
  };
  return memo;
}

/** Test helper: drop the memo so the next load re-reads. */
export function resetFrozenCatalogMemo(): void {
  memo = undefined;
}

export function frozenCatalogStats(catalog: FrozenCatalog = loadFrozenCatalog()): { providers: number; models: number } {
  return catalogStats(catalog.providers);
}

/** Provider rows with no duplicate ids; sorted by name then id. */
export function listFrozenProviders(catalog: FrozenCatalog = loadFrozenCatalog()): FrozenProviderSummary[] {
  const rows: FrozenProviderSummary[] = [];
  for (const provider of Object.values(catalog.providers)) {
    const row: FrozenProviderSummary = {
      id: provider.id,
      name: provider.name,
      modelCount: Object.keys(provider.models).length,
      env: provider.env,
    };
    if (provider.api) row.api = provider.api;
    if (provider.doc) row.doc = provider.doc;
    rows.push(row);
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

function normalizeQuery(query: string): string {
  return stripControls(query).trim().toLowerCase();
}

/**
 * Search providers and models in the frozen catalog for the model picker's
 * show-all + search path. Empty query returns nothing (caller uses suggested).
 */
export function searchFrozenCatalog(
  query: string,
  options: { limit?: number; catalog?: FrozenCatalog; providerId?: string } = {},
): FrozenCatalogHit[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const catalog = options.catalog ?? loadFrozenCatalog();
  const hits: FrozenCatalogHit[] = [];
  const providers = options.providerId
    ? Object.values(catalog.providers).filter((p) => p.id === options.providerId)
    : Object.values(catalog.providers);

  for (const provider of providers) {
    const providerMatch = provider.id.toLowerCase().includes(q) || provider.name.toLowerCase().includes(q);
    for (const model of Object.values(provider.models)) {
      if (
        providerMatch
        || model.id.toLowerCase().includes(q)
        || model.name.toLowerCase().includes(q)
      ) {
        hits.push({
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          modelName: model.name,
          key: `${provider.id}/${model.id}`,
        });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}

/** Match an OpenAI-compatible base URL to a frozen provider id (hostname / api URL). */
export function frozenProviderIdForApiUrl(url: string, catalog: FrozenCatalog = loadFrozenCatalog()): string | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (host === "openrouter.ai" || host.endsWith(".openrouter.ai")) return catalog.providers.openrouter ? "openrouter" : undefined;
  if (host === "api.openai.com") return catalog.providers.openai ? "openai" : undefined;

  for (const provider of Object.values(catalog.providers)) {
    if (!provider.api) continue;
    try {
      if (new URL(provider.api).hostname.toLowerCase() === host) return provider.id;
    } catch {
      /* skip bad api */
    }
  }
  return undefined;
}

/** Model picker options for one frozen provider (official, not custom). */
export function frozenModelOptions(
  providerId: string,
  catalog: FrozenCatalog = loadFrozenCatalog(),
): Array<{ id: string; label: string; provider?: string }> {
  const provider = catalog.providers[providerId];
  if (!provider) return [];
  return Object.values(provider.models)
    .map((model) => ({ id: model.id, label: model.name, provider: provider.name }))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}
