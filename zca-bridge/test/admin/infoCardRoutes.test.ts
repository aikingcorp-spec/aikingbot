import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerInfoCardRoutes } from "../../src/admin/infoCardRoutes.js";

function build(stored = { enabled: false, title: "D", subtitle: "DS", imageUrl: "" }) {
  const app = Fastify();
  const infoCard = {
    get: vi.fn(async () => stored),
    upsert: vi.fn(async () => {}),
  };
  registerInfoCardRoutes(app, infoCard as any, async () => {});
  return { app, infoCard };
}

describe("info-card routes", () => {
  it("GET returns the card config", async () => {
    const { app } = build();
    const res = await app.inject({ method: "GET", url: "/admin/api/accounts/5/info-card" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false, title: "D", subtitle: "DS", imageUrl: "" });
  });

  it("PUT validates and upserts", async () => {
    const { app, infoCard } = build();
    const res = await app.inject({ method: "PUT", url: "/admin/api/accounts/5/info-card",
      payload: { enabled: true, title: "T", subtitle: "S", imageUrl: "https://x/y.png" } });
    expect(res.statusCode).toBe(200);
    expect(infoCard.upsert).toHaveBeenCalledWith(5, { enabled: true, title: "T", subtitle: "S", imageUrl: "https://x/y.png" });
  });

  it("PUT rejects enabling without an image", async () => {
    const { app, infoCard } = build();
    const res = await app.inject({ method: "PUT", url: "/admin/api/accounts/5/info-card",
      payload: { enabled: true, title: "T", subtitle: "S", imageUrl: "" } });
    expect(res.statusCode).toBe(400);
    expect(infoCard.upsert).not.toHaveBeenCalled();
  });

  it("PUT rejects a non-http image url and an over-long title", async () => {
    const { app } = build();
    expect((await app.inject({ method: "PUT", url: "/admin/api/accounts/5/info-card",
      payload: { enabled: false, title: "T", subtitle: "S", imageUrl: "ftp://x" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/admin/api/accounts/5/info-card",
      payload: { enabled: false, title: "x".repeat(101), subtitle: "S", imageUrl: "" } })).statusCode).toBe(400);
  });

  it("guard blocks unauthorized requests", async () => {
    const app = Fastify();
    const infoCard = { get: vi.fn(), upsert: vi.fn() };
    registerInfoCardRoutes(app, infoCard as any, async (_req, reply) => { await reply.code(401).send({ ok: false }); });
    const res = await app.inject({ method: "GET", url: "/admin/api/accounts/5/info-card" });
    expect(res.statusCode).toBe(401);
    expect(infoCard.get).not.toHaveBeenCalled();
  });
});
