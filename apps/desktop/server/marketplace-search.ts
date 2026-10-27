// 2.3: marketplace_search. The agent finds a service in the connector catalog (folded vi/en match on name, slug, blurb,
// categories) and offers an "Install and connect" card; the person's click on that card is the install.
import { foldVietnamese, foldedTerms } from "./vi-fold.ts";

export interface MarketplaceEntry { slug: string; label: string; blurb: string; categories?: string[]; noAuth?: boolean }
export interface MarketplaceHit { slug: string; label: string; blurb: string; connected: boolean; noAuth: boolean }

export const SEARCH_LIMIT = 8;
export const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function searchMarketplace(entries: readonly MarketplaceEntry[], query: unknown, connected: ReadonlySet<string>, limit = SEARCH_LIMIT): MarketplaceHit[] {
  const terms = typeof query === "string" ? foldedTerms(query) : [];
  if (!terms.length) return [];
  const scored = entries.map((entry) => {
    const name = foldVietnamese(`${entry.label} ${entry.slug}`);
    const rest = foldVietnamese(`${entry.blurb} ${(entry.categories ?? []).join(" ")}`);
    let score = 0;
    for (const term of terms) {
      if (name.split(/[^a-z0-9]+/).includes(term)) score += 4;
      else if (name.includes(term)) score += 2;
      else if (rest.includes(term)) score += 1;
    }
    return { entry, score };
  }).filter((item) => item.score > 0);
  scored.sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label));
  return scored.slice(0, Math.max(1, Math.min(limit, 20))).map(({ entry }) => ({
    slug: entry.slug, label: entry.label, blurb: entry.blurb.slice(0, 160), connected: connected.has(entry.slug), noAuth: entry.noAuth === true,
  }));
}

export function marketplaceSearchText(query: string, hits: readonly MarketplaceHit[]): string {
  if (!hits.length) return `No service in the catalog matches "${query}". Try another name or a broader word.`;
  const rows = hits.map((hit) => `- ${hit.label} (slug ${hit.slug})${hit.connected ? " — already connected" : hit.noAuth ? " — needs no sign-in" : ""}: ${hit.blurb}`);
  return `Catalog matches for "${query}":\n${rows.join("\n")}\nTo install one the person needs, call marketplace_install with its slug: they get an "Install and connect" card in this chat. Then end your turn.`;
}
