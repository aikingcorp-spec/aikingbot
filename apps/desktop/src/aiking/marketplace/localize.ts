// Copyright (c) 2026 AIKING. Listing text in the person's language, from the
// listing's own `locales` (catalog data), falling back to the English fields.
import { activeLocale } from "@/lib/i18n";
import type { CatalogPage, Listing } from "./contract";

const lang = () => activeLocale().split("-")[0] ?? "en";

export function listingSummary(listing: Listing): string {
  return listing.locales?.[lang()]?.summary ?? listing.summary;
}

export function listingCategory(listing: Listing): string {
  return listing.locales?.[lang()]?.category ?? listing.category;
}

/** A category key as shown in the filter menu. */
export function categoryLabel(category: string, page: Pick<CatalogPage, "categoryLabels"> | null): string {
  return page?.categoryLabels?.[category]?.[lang()] ?? category;
}
