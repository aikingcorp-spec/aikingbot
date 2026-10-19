import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerAdminRoutes, registerAccountDeleteRoute } from "../../src/admin/routes.js";

const PASS: any = async () => {};

function buildApp(opts: {
  refreshInboxIndex?: any;
  applyProxy?: (id: number) => Promise<void>;
} = {}) {
  const app = Fastify();
  const accounts = {
    listAll: vi.fn(async () => [{ id: 1, label: "Sales", status: "connected", chatwootInboxIdentifier: "ident-1" }]),
    create: vi.fn(async (i: any) => ({ id: 2, label: i.label, status: "pending_qr", chatwootInboxIdentifier: i.chatwootInboxIdentifier, chatwootInboxId: i.chatwootInboxId })),
    createOa: vi.fn(async (i: any) => ({ id: 3, label: i.label, status: "pending_qr", type: "oa", chatwootInboxIdentifier: i.chatwootInboxIdentifier, chatwootInboxId: i.chatwootInboxId, zaloOaId: null })),
    update: vi.fn(async (id: number, p: any) => (id === 99 ? null : { id, label: p.label ?? "Sales", status: "connected", chatwootInboxIdentifier: p.chatwootInboxIdentifier ?? "ident-1", chatwootInboxId: p.chatwootInboxId ?? 9 })),
    setProxy: vi.fn(async () => null),
    findById: vi.fn(async (id: number) => (id === 99 ? null : { id, label: "Sales", status: "connected", chatwootInboxIdentifier: "ident-1", proxyId: null as number | null })),
  };
  const qr = { startLogin: vi.fn(async () => ({ qrImageBase64: "data:image/png;base64,AAA" })) };
  const refreshInboxIndex = opts.refreshInboxIndex ?? vi.fn(async () => {});
  registerAdminRoutes(app, accounts as any, qr as any, PASS, { refreshInboxIndex, applyProxy: opts.applyProxy });
  return { app, accounts, qr, refreshInboxIndex };
}

function buildDeleteApp() {
  const app = Fastify();
  const accounts = { delete: vi.fn(async (id: number) => id !== 99) };
  const supervisor = { remove: vi.fn(async () => {}) };
  const refreshIndex = vi.fn(async () => {});
  registerAccountDeleteRoute(app, accounts as any, supervisor, refreshIndex, PASS);
  return { app, accounts, supervisor, refreshIndex };
}

describe("admin routes", () => {
  it("GET /admin/api/accounts lists accounts", async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: "GET", url: "/admin/api/accounts" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("POST /admin/api/accounts creates an account with an existing inbox", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/accounts",
      payload: { label: "Support", chatwootInboxIdentifier: "ident-9", chatwootInboxId: 9 },
    });
    expect(res.statusCode).toBe(200);
    expect(accounts.create).toHaveBeenCalledWith({ label: "Support", chatwootInboxIdentifier: "ident-9", chatwootInboxId: 9, proxyId: null, chatwootAccountId: null });
  });

  it("POST /admin/api/accounts forwards existing chatwootInboxId when provided", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/accounts",
      payload: { label: "Sales", chatwootInboxIdentifier: "ident-5", chatwootInboxId: 5 },
    });
    expect(res.statusCode).toBe(200);
    expect(accounts.create).toHaveBeenCalledWith({ label: "Sales", chatwootInboxIdentifier: "ident-5", chatwootInboxId: 5, proxyId: null, chatwootAccountId: null });
  });

  it("POST /admin/api/accounts returns 400 on invalid existing chatwootInboxId", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/accounts",
      payload: { label: "Sales", inboxMode: "existing", chatwootInboxIdentifier: "ident-5", chatwootInboxId: "abc" },
    });
    expect(res.statusCode).toBe(400);
    expect(accounts.create).not.toHaveBeenCalled();
  });

  it("POST /admin/api/accounts returns 400 when existing inbox is missing chatwootInboxId", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/accounts",
      payload: { label: "Sales", inboxMode: "existing", chatwootInboxIdentifier: "ident-5" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: "chatwoot_inbox_id_required" });
    expect(accounts.create).not.toHaveBeenCalled();
  });

  it("POST /admin/api/accounts returns 400 for legacy existing inbox payload missing chatwootInboxId", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/accounts",
      payload: { label: "Sales", chatwootInboxIdentifier: "ident-5" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: "chatwoot_inbox_id_required" });
    expect(accounts.create).not.toHaveBeenCalled();
  });

  it("POST /admin/api/accounts returns 400 on decimal existing chatwootInboxId", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/accounts",
      payload: { label: "Sales", inboxMode: "existing", chatwootInboxIdentifier: "ident-5", chatwootInboxId: "1.5" },
    });
    expect(res.statusCode).toBe(400);
    expect(accounts.create).not.toHaveBeenCalled();
  });

  it("POST /admin/api/accounts returns 400 on exponent-string existing chatwootInboxId", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/accounts",
      payload: { label: "Sales", inboxMode: "existing", chatwootInboxIdentifier: "ident-5", chatwootInboxId: "1e2" },
    });
    expect(res.statusCode).toBe(400);
    expect(accounts.create).not.toHaveBeenCalled();
  });

  it("POST /admin/api/accounts/oa creates an OA account with an existing inbox", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/accounts/oa",
      payload: { label: "OA Support", chatwootInboxIdentifier: "oa-ident-1", chatwootInboxId: 7 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(accounts.createOa).toHaveBeenCalledWith({ label: "OA Support", chatwootInboxIdentifier: "oa-ident-1", chatwootInboxId: 7, proxyId: null, chatwootAccountId: null });
  });

  it("POST /admin/api/accounts/oa returns 400 when existing inbox is missing chatwootInboxId", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/accounts/oa",
      payload: { label: "OA Support", inboxMode: "existing", chatwootInboxIdentifier: "oa-ident-1" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: "chatwoot_inbox_id_required" });
    expect(accounts.createOa).not.toHaveBeenCalled();
  });

  it("POST /admin/api/accounts still succeeds when refreshInboxIndex fails", async () => {
    const refreshInboxIndex = vi.fn(async () => {
      throw new Error("refresh failed");
    });
    const { app, accounts } = buildApp({ refreshInboxIndex });
    const res = await app.inject({ method: "POST", url: "/admin/api/accounts", payload: { label: "Support", chatwootInboxIdentifier: "ident-9", chatwootInboxId: 9 } });
    expect(res.statusCode).toBe(200);
    expect(accounts.create).toHaveBeenCalledWith({ label: "Support", chatwootInboxIdentifier: "ident-9", chatwootInboxId: 9, proxyId: null, chatwootAccountId: null });
    expect(refreshInboxIndex).toHaveBeenCalled();
  });

  it("POST /admin/api/accounts/oa still succeeds when refreshInboxIndex fails", async () => {
    const refreshInboxIndex = vi.fn(async () => {
      throw new Error("refresh failed");
    });
    const { app, accounts } = buildApp({ refreshInboxIndex });
    const res = await app.inject({ method: "POST", url: "/admin/api/accounts/oa", payload: { label: "OA Support", chatwootInboxIdentifier: "oa-ident-1", chatwootInboxId: 7 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(accounts.createOa).toHaveBeenCalledWith({ label: "OA Support", chatwootInboxIdentifier: "oa-ident-1", chatwootInboxId: 7, proxyId: null, chatwootAccountId: null });
    expect(refreshInboxIndex).toHaveBeenCalled();
  });

  it("POST /admin/api/accounts/oa returns 400 when label is missing", async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: "POST", url: "/admin/api/accounts/oa", payload: { chatwootInboxIdentifier: "oa-ident-1" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
  });

  it("PATCH /admin/api/accounts/:id updates inbox fields", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({ method: "PATCH", url: "/admin/api/accounts/2", payload: { label: "Renamed", chatwootInboxIdentifier: "ident-x", chatwootInboxId: 11 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(accounts.update).toHaveBeenCalledWith(2, { label: "Renamed", chatwootInboxIdentifier: "ident-x", chatwootInboxId: 11 });
  });

  it("PATCH /admin/api/accounts/:id returns 400 on nonnumeric path id", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({ method: "PATCH", url: "/admin/api/accounts/abc", payload: { label: "Renamed" } });
    expect(res.statusCode).toBe(400);
    expect(accounts.update).not.toHaveBeenCalled();
  });

  it("PATCH /admin/api/accounts/:id returns 400 on decimal path id", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({ method: "PATCH", url: "/admin/api/accounts/1.5", payload: { label: "Renamed" } });
    expect(res.statusCode).toBe(400);
    expect(accounts.update).not.toHaveBeenCalled();
  });

  it("PATCH /admin/api/accounts/:id returns 400 on exponent-string path id", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({ method: "PATCH", url: "/admin/api/accounts/1e2", payload: { label: "Renamed" } });
    expect(res.statusCode).toBe(400);
    expect(accounts.update).not.toHaveBeenCalled();
  });

  it("PATCH /admin/api/accounts/:id returns 400 on empty inbox identifier", async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: "PATCH", url: "/admin/api/accounts/2", payload: { chatwootInboxIdentifier: "  " } });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /admin/api/accounts/:id requires chatwootInboxId when changing inbox identifier", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({ method: "PATCH", url: "/admin/api/accounts/2", payload: { chatwootInboxIdentifier: "ident-x" } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: "chatwoot_inbox_id_required" });
    expect(accounts.update).not.toHaveBeenCalled();
  });

  it("PATCH /admin/api/accounts/:id returns 400 on invalid chatwootInboxId", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({ method: "PATCH", url: "/admin/api/accounts/2", payload: { chatwootInboxId: "abc" } });
    expect(res.statusCode).toBe(400);
    expect(accounts.update).not.toHaveBeenCalled();
  });

  it("PATCH /admin/api/accounts/:id returns 400 when chatwootInboxId is null", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({ method: "PATCH", url: "/admin/api/accounts/2", payload: { chatwootInboxId: null } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: "chatwoot_inbox_id_required" });
    expect(accounts.update).not.toHaveBeenCalled();
  });

  it("PATCH /admin/api/accounts/:id returns 400 on decimal chatwootInboxId", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({ method: "PATCH", url: "/admin/api/accounts/2", payload: { chatwootInboxId: 1.5 } });
    expect(res.statusCode).toBe(400);
    expect(accounts.update).not.toHaveBeenCalled();
  });

  it("PATCH /admin/api/accounts/:id allows label-only updates without chatwootInboxId", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({ method: "PATCH", url: "/admin/api/accounts/2", payload: { label: "Renamed" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, account: { id: 2, label: "Renamed", chatwootInboxId: 9 } });
    expect(accounts.update).toHaveBeenCalledWith(2, { label: "Renamed" });
  });

  it("PATCH /admin/api/accounts/:id accepts a positive safe integer chatwootInboxId", async () => {
    const { app, accounts } = buildApp();
    const res = await app.inject({ method: "PATCH", url: "/admin/api/accounts/2", payload: { chatwootInboxId: "42" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, account: { id: 2, chatwootInboxId: 42 } });
    expect(accounts.update).toHaveBeenCalledWith(2, { chatwootInboxId: 42 });
  });

  it("PATCH /admin/api/accounts/:id returns 404 when account missing", async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: "PATCH", url: "/admin/api/accounts/99", payload: { label: "X" } });
    expect(res.statusCode).toBe(404);
  });

  it("POST /admin/api/accounts/:id/login returns a QR image", async () => {
    const { app, qr } = buildApp();
    const res = await app.inject({ method: "POST", url: "/admin/api/accounts/1/login" });
    expect(res.statusCode).toBe(200);
    expect(res.json().qrImageBase64).toContain("base64");
    expect(qr.startLogin).toHaveBeenCalledWith(1);
  });

  it("POST /admin/api/accounts/:id/login returns 400 on nonnumeric path id", async () => {
    const { app, qr } = buildApp();
    const res = await app.inject({ method: "POST", url: "/admin/api/accounts/abc/login" });
    expect(res.statusCode).toBe(400);
    expect(qr.startLogin).not.toHaveBeenCalled();
  });

  it("POST /admin/api/accounts/:id/login returns 400 on decimal path id", async () => {
    const { app, qr } = buildApp();
    const res = await app.inject({ method: "POST", url: "/admin/api/accounts/1.5/login" });
    expect(res.statusCode).toBe(400);
    expect(qr.startLogin).not.toHaveBeenCalled();
  });

  it("POST /admin/api/accounts/:id/login returns 400 on hex-string path id", async () => {
    const { app, qr } = buildApp();
    const res = await app.inject({ method: "POST", url: "/admin/api/accounts/0x10/login" });
    expect(res.statusCode).toBe(400);
    expect(qr.startLogin).not.toHaveBeenCalled();
  });

  it("DELETE /admin/api/accounts/:id returns 400 on nonnumeric path id", async () => {
    const { app, accounts, supervisor } = buildDeleteApp();
    const res = await app.inject({ method: "DELETE", url: "/admin/api/accounts/abc" });
    expect(res.statusCode).toBe(400);
    expect(supervisor.remove).not.toHaveBeenCalled();
    expect(accounts.delete).not.toHaveBeenCalled();
  });

  it("DELETE /admin/api/accounts/:id returns 400 on decimal path id", async () => {
    const { app, accounts, supervisor } = buildDeleteApp();
    const res = await app.inject({ method: "DELETE", url: "/admin/api/accounts/1.5" });
    expect(res.statusCode).toBe(400);
    expect(supervisor.remove).not.toHaveBeenCalled();
    expect(accounts.delete).not.toHaveBeenCalled();
  });

  it("DELETE /admin/api/accounts/:id returns 400 on prefixed-string path id", async () => {
    const { app, accounts, supervisor } = buildDeleteApp();
    const res = await app.inject({ method: "DELETE", url: "/admin/api/accounts/+1" });
    expect(res.statusCode).toBe(400);
    expect(supervisor.remove).not.toHaveBeenCalled();
    expect(accounts.delete).not.toHaveBeenCalled();
  });

  it("apply-proxy route calls opts.applyProxy with the id", async () => {
    const applied: number[] = [];
    const { app } = buildApp({ applyProxy: async (id) => { applied.push(id); } });
    const res = await app.inject({ method: "POST", url: "/admin/api/accounts/5/apply-proxy" });
    expect(res.statusCode).toBe(200);
    expect(applied).toEqual([5]);
  });

  it("apply-proxy route returns 400 when applyProxy is not configured", async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: "POST", url: "/admin/api/accounts/5/apply-proxy" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: "apply_proxy_unavailable" });
  });

  it("apply-proxy route returns 400 on nonnumeric path id", async () => {
    const applied: number[] = [];
    const { app } = buildApp({ applyProxy: async (id) => { applied.push(id); } });
    const res = await app.inject({ method: "POST", url: "/admin/api/accounts/abc/apply-proxy" });
    expect(res.statusCode).toBe(400);
    expect(applied).toHaveLength(0);
  });

  it("PATCH /admin/api/accounts/:id calls setProxy when proxy actually changes", async () => {
    const { app, accounts } = buildApp();
    // findById returns proxyId: null; patching with proxyId: 7 is a real change
    accounts.findById.mockResolvedValueOnce({ id: 2, label: "Sales", status: "connected", chatwootInboxIdentifier: "ident-1", proxyId: null });
    const res = await app.inject({ method: "PATCH", url: "/admin/api/accounts/2", payload: { label: "Sales", proxyId: 7 } });
    expect(res.statusCode).toBe(200);
    expect(accounts.setProxy).toHaveBeenCalledWith(2, 7);
  });

  it("PATCH /admin/api/accounts/:id does NOT call setProxy when proxy is unchanged", async () => {
    const { app, accounts } = buildApp();
    // findById returns proxyId: 7; patching with the same proxyId: 7 is not a change
    accounts.findById.mockResolvedValueOnce({ id: 2, label: "Sales", status: "connected", chatwootInboxIdentifier: "ident-1", proxyId: 7 });
    const res = await app.inject({ method: "PATCH", url: "/admin/api/accounts/2", payload: { label: "Renamed", proxyId: 7 } });
    expect(res.statusCode).toBe(200);
    expect(accounts.setProxy).not.toHaveBeenCalled();
  });
});
