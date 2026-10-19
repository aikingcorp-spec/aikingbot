import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerProxyRoutes } from "../../src/admin/proxyRoutes.js";

function fakeProxyRepo() {
  const store = new Map<number, any>();
  let seq = 0;
  return {
    store,
    create: async (input: any) => { const id = ++seq; const p = { id, ...input }; store.set(id, p); return { id, label: p.label, protocol: p.protocol, host: p.host, port: p.port, username: p.username, hasPassword: !!p.password }; },
    list: async () => [...store.values()].map((p) => ({ id: p.id, label: p.label, protocol: p.protocol, host: p.host, port: p.port, username: p.username, hasPassword: !!p.password })),
    update: async (id: number, patch: any) => { const p = store.get(id); if (!p) return null; Object.assign(p, patch); return { id, label: p.label, protocol: p.protocol, host: p.host, port: p.port, username: p.username, hasPassword: !!p.password }; },
    delete: async (id: number) => store.delete(id),
  };
}

function build(usingByProxy: Record<number, any[]> = {}) {
  const proxies = fakeProxyRepo();
  const accounts = { listByProxy: async (id: number) => usingByProxy[id] ?? [], setProxy: async () => null };
  const app = Fastify();
  const guard = async () => {};
  registerProxyRoutes(app, proxies as any, accounts as any, guard);
  return { app, proxies, accounts };
}

describe("proxyRoutes", () => {
  it("creates a proxy and never returns the password", async () => {
    const { app } = build();
    const res = await app.inject({ method: "POST", url: "/admin/api/proxies", payload: { label: "P", protocol: "socks5", host: "1.2.3.4", port: 1080, username: "u", password: "secret" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.proxy.hasPassword).toBe(true);
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("rejects an invalid protocol", async () => {
    const { app } = build();
    const res = await app.inject({ method: "POST", url: "/admin/api/proxies", payload: { label: "P", protocol: "ftp", host: "h", port: 1, username: null, password: null } });
    expect(res.statusCode).toBe(400);
  });

  it("blocks delete when accounts use the proxy and no confirm is given, returning the affected list", async () => {
    const { app } = build({ 1: [{ id: 7, label: "Zalo A" }] });
    // seed a proxy with id 1
    await app.inject({ method: "POST", url: "/admin/api/proxies", payload: { label: "P", protocol: "http", host: "h", port: 8080, username: null, password: null } });
    const res = await app.inject({ method: "DELETE", url: "/admin/api/proxies/1" });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe("proxy_in_use");
    expect(body.accounts).toEqual([{ id: 7, label: "Zalo A" }]);
  });

  it("deletes with confirm=1, detaching affected accounts first", async () => {
    const detached: number[] = [];
    const { app, accounts } = build({ 1: [{ id: 7, label: "Zalo A" }] });
    accounts.setProxy = (async (id: number, proxyId: number | null) => { detached.push(id); expect(proxyId).toBeNull(); return null; }) as any;
    await app.inject({ method: "POST", url: "/admin/api/proxies", payload: { label: "P", protocol: "http", host: "h", port: 8080, username: null, password: null } });
    const res = await app.inject({ method: "DELETE", url: "/admin/api/proxies/1?confirm=1" });
    expect(res.statusCode).toBe(200);
    expect(detached).toEqual([7]);
  });
});
