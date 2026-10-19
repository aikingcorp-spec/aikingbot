import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { Readable } from "node:stream";
import { registerMediaRoute } from "../../src/media/mediaRoute.js";
import { signMediaToken } from "../../src/media/token.js";
import type { MediaArchive } from "../../src/media/archive.js";

const SECRET = "route-secret";

function fakeArchive(bytes: Buffer | null): MediaArchive {
  return {
    put: async () => {},
    urlFor: () => "unused",
    getStream: async () => bytes ? { stream: Readable.from([bytes]), contentType: "image/png", size: bytes.length } : null,
  };
}

async function build(archive: MediaArchive) {
  const app = Fastify();
  registerMediaRoute(app, archive, SECRET);
  await app.ready();
  return app;
}

describe("GET /media/:token", () => {
  it("streams the archived file for a valid token", async () => {
    const app = await build(fakeArchive(Buffer.from("PNGDATA")));
    const token = signMediaToken("1/user_9/m1_x.png", SECRET);
    const res = await app.inject({ method: "GET", url: `/media/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.body).toBe("PNGDATA");
    expect(res.headers["content-disposition"]).toContain('filename="m1_x.png"');
    await app.close();
  });

  it("returns 403 for a tampered token", async () => {
    const app = await build(fakeArchive(Buffer.from("x")));
    const res = await app.inject({ method: "GET", url: `/media/not-a-real-token` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("returns 410 for an expired token", async () => {
    const app = await build(fakeArchive(Buffer.from("x")));
    const token = signMediaToken("k", SECRET, 1, 1_000); // expired long ago
    const res = await app.inject({ method: "GET", url: `/media/${token}` });
    expect(res.statusCode).toBe(410);
    await app.close();
  });

  it("returns 404 when the file is gone but the token is valid", async () => {
    const app = await build(fakeArchive(null));
    const token = signMediaToken("1/user_9/missing.png", SECRET);
    const res = await app.inject({ method: "GET", url: `/media/${token}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
