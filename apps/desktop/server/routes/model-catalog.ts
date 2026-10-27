import {
  frozenCatalogStats,
  listFrozenProviders,
  loadFrozenCatalog,
  searchFrozenCatalog,
} from "../model-catalog/frozen.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Read-only frozen models.dev catalog for the model picker's show-all / search. */
export function createModelCatalogRoutes(): RouteHandler {
  return async ({ res, url, path, method, json }) => {
    if (method !== "GET") return PASS;
    if (path !== "/api/model-catalog" && path !== "/api/model-catalog/search") return PASS;

    let catalog;
    try {
      catalog = loadFrozenCatalog();
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }

    res.setHeader("cache-control", "no-store");

    if (path === "/api/model-catalog") {
      const stats = frozenCatalogStats(catalog);
      return json(res, 200, {
        schema: catalog.schema,
        updatedAt: catalog.updatedAt,
        source: catalog.source,
        stats,
        providers: listFrozenProviders(catalog),
      });
    }

    const q = url.searchParams.get("q") ?? "";
    const providerId = url.searchParams.get("provider") ?? undefined;
    const limitRaw = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
    const hits = searchFrozenCatalog(q, { catalog, providerId: providerId || undefined, limit });
    return json(res, 200, {
      q,
      providerId: providerId || null,
      source: catalog.source,
      hits,
    });
  };
}
