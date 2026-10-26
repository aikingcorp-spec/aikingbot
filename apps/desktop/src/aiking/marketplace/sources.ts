// Copyright (c) 2026 AIKING. Catalog sources. Both decode documents through
// contract.ts, so a bad listing is rejected at the boundary with a reason.
import { AIKING_CATALOG } from "./aiking-catalog";
import {
  catalogDocumentSchema, listingSchema,
  type CatalogDocument, type CatalogPage, type CatalogQuery, type CatalogSource, type Listing, type ListingKind,
} from "./contract";

export class CatalogDecodeError extends Error {}
export class CatalogTimeoutError extends Error {}
/** A hung server must not leave the grid on a spinner forever; 8s is above a slow link's round trip and below "the app froze". */
export const CATALOG_TIMEOUT_MS = 8_000;

export function decodeCatalog(raw: unknown, origin: string): CatalogDocument {
  const parsed = catalogDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CatalogDecodeError(`${origin}: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid catalog"}`);
  }
  const ids = new Set<string>();
  for (const listing of parsed.data.listings) {
    const key = `${listing.kind}:${listing.id}`;
    if (ids.has(key)) throw new CatalogDecodeError(`${origin}: duplicate ${key}`);
    ids.add(key);
  }
  return parsed.data;
}

function matches(listing: Listing, query: CatalogQuery): boolean {
  if (listing.kind !== query.kind) return false;
  if (query.category && listing.category !== query.category) return false;
  if (query.featuredOnly && !listing.featured) return false;
  const text = query.text?.trim().toLowerCase();
  if (!text) return true;
  // An agent is also found by the skills it ships with ("tiktok" finds the agent with the TikTok hook writer).
  const pinned = listing.kind === "agent" ? listing.skills.map((pin) => pin.id.replaceAll("-", " ")) : [];
  return [listing.name, listing.summary, listing.category, listing.publisher.name, ...listing.tags, ...pinned]
    .some((field) => field.toLowerCase().includes(text));
}

function page<K extends ListingKind>(listings: Listing[], query: CatalogQuery & { kind: K }): CatalogPage<Extract<Listing, { kind: K }>> {
  const ofKind = listings.filter((listing): listing is Extract<Listing, { kind: K }> => listing.kind === query.kind);
  const items = ofKind
    .filter((listing) => matches(listing, query))
    .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || a.name.localeCompare(b.name));
  const categories = [...new Set(ofKind.map((listing) => listing.category))].sort((a, b) => a.localeCompare(b));
  return { items, categories, total: items.length };
}

/** The catalog bundled with the app. */
export class BundledCatalogSource implements CatalogSource {
  readonly id = "aiking-bundled";
  private readonly document: CatalogDocument;
  constructor(raw: unknown = AIKING_CATALOG) {
    this.document = decodeCatalog(raw, this.id);
  }
  get catalogVersion() {
    return this.document.catalogVersion;
  }
  async list<K extends ListingKind>(query: CatalogQuery & { kind: K }) {
    return page(this.document.listings, query);
  }
  async get(id: string) {
    return this.document.listings.find((listing) => listing.id === id) ?? null;
  }
}

/**
 * Stage 3: AIKING Core (or a marketplace server) serves
 *   GET  {base}/v1/catalog                → CatalogDocument (schemaVersion 1)
 *   GET  {base}/v1/catalog/listings/{id}  → Listing
 * The same decoder guards both. Not used in stage 2.
 */
export class HttpCatalogSource implements CatalogSource {
  readonly id: string;
  constructor(
    private readonly base: string,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly timeoutMs = CATALOG_TIMEOUT_MS,
  ) {
    this.id = `http:${new URL(base).host}`;
  }
  /** Request plus body read share one deadline; the timer is always cleared. */
  private async withDeadline<T>(url: URL, read: (response: Response) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await read(await this.fetcher(url, { signal: controller.signal }));
    } catch (error) {
      if (controller.signal.aborted) throw new CatalogTimeoutError(`${this.id}: request timed out after ${this.timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  private document: Promise<CatalogDocument> | null = null;
  private load() {
    this.document ??= this.withDeadline(new URL("v1/catalog", this.base), async (response) => {
        if (!response.ok) throw new Error(`${this.id}: catalog request failed with ${response.status}`);
        return decodeCatalog(await response.json(), this.id);
      })
      .catch((error) => {
        this.document = null;
        throw error;
      });
    return this.document;
  }
  async list<K extends ListingKind>(query: CatalogQuery & { kind: K }) {
    return page((await this.load()).listings, query);
  }
  async get(id: string) {
    return this.withDeadline(new URL(`v1/catalog/listings/${encodeURIComponent(id)}`, this.base), async (response) => {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`${this.id}: listing request failed with ${response.status}`);
      const parsed = listingSchema.safeParse(await response.json());
      if (!parsed.success) throw new CatalogDecodeError(`${this.id}: listing ${id} is invalid`);
      return parsed.data;
    });
  }
}

let active: CatalogSource | null = null;
/** The catalog the marketplace reads. Stage 3 swaps in an HttpCatalogSource here. */
export function catalogSource(): CatalogSource {
  active ??= new BundledCatalogSource();
  return active;
}
export function setCatalogSource(source: CatalogSource) {
  active = source;
}
