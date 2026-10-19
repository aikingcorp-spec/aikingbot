import { createReadStream } from "node:fs";
import { mkdir, rename, stat, writeFile, readFile, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import type { BinaryLike } from "node:crypto";
import { signMediaToken } from "./token.js";

export interface ArchivedStream { stream: Readable; contentType: string; size: number; }

export interface MediaArchive {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  getStream(key: string): Promise<ArchivedStream | null>;
  urlFor(key: string): string;
}

/** Durable media archive backed by a mounted local directory. */
export class LocalDiskArchive implements MediaArchive {
  constructor(
    private root: string,
    private publicBaseUrl: string,
    private tokenSecret: BinaryLike,
    private tokenTtlDays = 0,
  ) {}

  private pathFor(key: string): string {
    const base = resolve(this.root);
    const full = resolve(base, key);
    if (full !== base && !full.startsWith(base + sep)) throw new Error("invalid archive key");
    return full;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const dataTmp = `${path}.tmp`;
    const metaTmp = `${path}.meta.tmp`;
    try {
      await writeFile(dataTmp, data);
      await writeFile(metaTmp, contentType);
      await rename(metaTmp, `${path}.meta`); // publish meta first
      await rename(dataTmp, path);           // then publish data (atomic, observed last)
    } finally {
      await unlink(dataTmp).catch(() => {});
      await unlink(metaTmp).catch(() => {});
    }
  }

  async getStream(key: string): Promise<ArchivedStream | null> {
    const path = this.pathFor(key);
    let s;
    try {
      s = await stat(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    let contentType = "application/octet-stream";
    try { contentType = (await readFile(`${path}.meta`, "utf8")).trim() || contentType; } catch { /* default */ }
    return { stream: createReadStream(path), contentType, size: s.size };
  }

  urlFor(key: string): string {
    const token = signMediaToken(key, this.tokenSecret, this.tokenTtlDays);
    return `${this.publicBaseUrl}/media/${token}`;
  }
}
