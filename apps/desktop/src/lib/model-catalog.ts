/** Client helpers for the frozen models.dev catalog (show-all / search). */

export type FrozenCatalogHit = {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  key: string;
};

export type FrozenCatalogSearchResponse = {
  q: string;
  providerId: string | null;
  hits: FrozenCatalogHit[];
};

/** Search the bundled frozen catalog via the local API (no network to models.dev). */
export async function searchModelCatalog(
  q: string,
  opts: { provider?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<FrozenCatalogHit[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const params = new URLSearchParams({ q: trimmed });
  if (opts.provider) params.set("provider", opts.provider);
  if (opts.limit != null) params.set("limit", String(opts.limit));
  const res = await fetch(`/api/model-catalog/search?${params}`, { signal: opts.signal });
  if (!res.ok) return [];
  const body = (await res.json()) as FrozenCatalogSearchResponse;
  return Array.isArray(body.hits) ? body.hits : [];
}

/** Map catalog hits into ModelPicker option shape (marked custom so they stay selectable). */
export function catalogHitsToOptions(hits: FrozenCatalogHit[]): Array<{
  id: string;
  label: string;
  custom: true;
  provider?: string;
}> {
  return hits.map((hit) => ({
    id: hit.modelId,
    label: hit.modelName === hit.modelId ? hit.modelId : `${hit.modelName} (${hit.modelId})`,
    custom: true as const,
    ...(hit.providerName ? { provider: hit.providerName } : {}),
  }));
}
