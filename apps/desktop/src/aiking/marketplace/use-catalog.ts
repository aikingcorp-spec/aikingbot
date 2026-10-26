// Copyright (c) 2026 AIKING. Loads one catalog page for the marketplace grid.
import { useCallback, useEffect, useState } from "react";
import type { CatalogPage, Listing, ListingKind } from "./contract";
import { catalogSource, classifyCatalogError, type CatalogFailure } from "./sources";

/** A failure plus a counter, so a second identical failure is still a new event (focus moves back to Retry). */
export type CatalogLoadFailure = CatalogFailure & { seq: number };

// A result is only valid for the request that produced it: kind, query and
// category travel with the page/error, so a page loaded for another tab can
// never reach the current tab's grid (not even for one render).
type CatalogResult<K extends ListingKind> = { key: string; page: CatalogPage<Extract<Listing, { kind: K }>> | null; error: CatalogLoadFailure | null };

let failures = 0;

export function useCatalog<K extends ListingKind>(kind: K, text: string, category: string | null) {
  const key = JSON.stringify([kind, text, category]);
  const [result, setResult] = useState<CatalogResult<K>>({ key, page: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    let alive = true;
    catalogSource().list({ kind, text, category })
      .then((page) => { if (alive) { setResult({ key, page, error: null }); setRetrying(false); } })
      .catch((cause: unknown) => { if (alive) { setResult({ key, page: null, error: { ...classifyCatalogError(cause), seq: ++failures } }); setRetrying(false); } });
    return () => { alive = false; };
  }, [key, attempt]);
  const current = result.key === key ? result : null;
  // The error stays on screen while the retry runs, so the focused Retry button is never unmounted.
  const retry = useCallback(() => { setRetrying(true); setAttempt((n) => n + 1); }, []);
  return { page: current?.page ?? null, error: current?.error ?? null, retrying: Boolean(current?.error) && retrying, retry };
}
