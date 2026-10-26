import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { extractZip } from "./extract-zip.mjs";

function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data = Buffer.alloc(0), mode = 0o100644, deflate = true } of files) {
    const nameBuf = Buffer.from(name), body = deflate ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(deflate ? 8 : 0, 10); central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

let dir;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe("extractZip (no system unzip)", () => {
  it("extracts deflated and stored entries and keeps the executable bit", () => {
    dir = mkdtempSync(join(tmpdir(), "zip-test-"));
    const file = join(dir, "a.zip");
    writeFileSync(file, zip([
      { name: "platform-tools/", mode: 0o040755 },
      { name: "platform-tools/adb", data: Buffer.from("#!/bin/sh\necho adb\n".repeat(50)), mode: 0o100755 },
      { name: "platform-tools/NOTICE.txt", data: Buffer.from("notice"), deflate: false },
    ]));
    extractZip(file, join(dir, "out"));
    expect(readFileSync(join(dir, "out/platform-tools/adb"), "utf8")).toContain("echo adb");
    expect(readFileSync(join(dir, "out/platform-tools/NOTICE.txt"), "utf8")).toBe("notice");
    if (process.platform !== "win32") expect(statSync(join(dir, "out/platform-tools/adb")).mode & 0o111).not.toBe(0);
  });

  it("refuses entries that escape the destination", () => {
    dir = mkdtempSync(join(tmpdir(), "zip-test-"));
    const file = join(dir, "evil.zip");
    writeFileSync(file, zip([{ name: "../escape.txt", data: Buffer.from("x") }]));
    expect(() => extractZip(file, join(dir, "out"))).toThrow(/escapes/);
  });

  it("rejects non-zip input", () => {
    dir = mkdtempSync(join(tmpdir(), "zip-test-"));
    writeFileSync(join(dir, "x.zip"), "not a zip");
    expect(() => extractZip(join(dir, "x.zip"), join(dir, "out"))).toThrow(/not a zip/);
  });
});
