import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { json, readBody } from "../harness/http.ts";
import { createModelCatalogRoutes } from "./model-catalog.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function serve(): Promise<string> {
  const routes = [createModelCatalogRoutes()];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      const handled = await dispatchRoutes(routes, {
        req, res, url, path: url.pathname, method: req.method ?? "GET",
        auth: { kind: "loopback", scopes: ["admin"] }, json, readBody,
      });
      if (!handled) json(res, 404, { from: "inline routes" });
    } catch (error) {
      json(res, 500, { error: String(error) });
    }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("model-catalog routes", () => {
  it("returns frozen providers and stats", async () => {
    const base = await serve();
    const res = await fetch(`${base}/api/model-catalog`);
    expect(res.status).toBe(200);
    const doc = await res.json() as {
      stats: { providers: number; models: number };
      source: { url: string; sha256: string; fetchedAt: string };
      providers: Array<{ id: string }>;
    };
    expect(doc.stats).toEqual({ providers: 220, models: 6859 });
    expect(doc.source.url).toBe("https://models.dev/api.json");
    expect(doc.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.source.fetchedAt).toBe("2026-09-30T05:32:26.000Z");
    expect(doc.providers).toHaveLength(220);
    expect(new Set(doc.providers.map((row) => row.id)).size).toBe(220);
  });

  it("searches the frozen catalog", async () => {
    const base = await serve();
    const res = await fetch(`${base}/api/model-catalog/search?q=claude-sonnet&limit=20`);
    expect(res.status).toBe(200);
    const doc = await res.json() as { hits: Array<{ modelId: string; key: string }> };
    expect(doc.hits.length).toBeGreaterThan(0);
    expect(doc.hits.some((hit) => hit.modelId.toLowerCase().includes("claude-sonnet"))).toBe(true);
    expect(doc.hits[0]!.key).toContain("/");
  });
});
