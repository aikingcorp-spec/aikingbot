import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskArchive } from "../../src/media/archive.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "archive-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function drain(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

describe("LocalDiskArchive", () => {
  it("round-trips bytes and content-type through put/getStream", async () => {
    const a = new LocalDiskArchive(root, "https://bridge.test", "secret");
    await a.put("1/user_9/m1_x.jpg", Buffer.from("hello"), "image/jpeg");
    const got = await a.getStream("1/user_9/m1_x.jpg");
    expect(got).not.toBeNull();
    expect(got!.contentType).toBe("image/jpeg");
    expect(got!.size).toBe(5);
    expect((await drain(got!.stream)).toString()).toBe("hello");
  });

  it("returns null for a missing key", async () => {
    const a = new LocalDiskArchive(root, "https://bridge.test", "secret");
    expect(await a.getStream("nope/missing")).toBeNull();
  });

  it("overwrites idempotently on the same key", async () => {
    const a = new LocalDiskArchive(root, "https://bridge.test", "secret");
    await a.put("k/v", Buffer.from("one"), "text/plain");
    await a.put("k/v", Buffer.from("two-longer"), "text/plain");
    const got = await a.getStream("k/v");
    expect((await drain(got!.stream)).toString()).toBe("two-longer");
  });

  it("builds a urlFor pointing at the public /media endpoint", async () => {
    const a = new LocalDiskArchive(root, "https://bridge.test", "secret");
    const url = a.urlFor("1/user_9/m1_x.jpg");
    expect(url).toMatch(/^https:\/\/bridge\.test\/media\/.+\..+$/);
  });

  it("rejects a path-traversal key", async () => {
    const a = new LocalDiskArchive(root, "https://bridge.test", "secret");
    await expect(a.put("../escape", Buffer.from("x"), "text/plain")).rejects.toThrow(/invalid archive key/);
  });

  it("falls back to application/octet-stream when the .meta sidecar is missing", async () => {
    const { unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const a = new LocalDiskArchive(root, "https://bridge.test", "secret");
    await a.put("k/v", Buffer.from("data"), "image/png");
    await unlink(join(root, "k/v.meta"));
    const got = await a.getStream("k/v");
    expect(got!.contentType).toBe("application/octet-stream");
    expect(got!.size).toBe(4);
  });
});
