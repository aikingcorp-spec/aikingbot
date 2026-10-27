// Dependency-free .zip extraction (stored + deflate) with node:zlib, so packaging
// never needs a system `unzip`. Keeps Unix mode bits (adb must stay executable),
// refuses paths that escape the destination, and rejects zip64/encrypted entries.
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

function endOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let i = buffer.length - 22; i >= min; i--) if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  throw new Error("not a zip archive (no end of central directory)");
}

export function zipEntries(buffer) {
  const eocd = endOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new Error("zip64 archives are not supported");
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const madeBy = buffer.readUInt16LE(offset + 4) >> 8;
    const external = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (flags & 1) throw new Error(`encrypted zip entry: ${name}`);
    const mode = madeBy === 3 ? (external >>> 16) & 0xffff : 0;
    entries.push({ name, method, compressedSize, size, mode, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function entryData(buffer, entry) {
  const at = entry.localOffset;
  if (buffer.readUInt32LE(at) !== 0x04034b50) throw new Error(`corrupt local header: ${entry.name}`);
  const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
  const raw = buffer.subarray(start, start + entry.compressedSize);
  const data = entry.method === 0 ? raw : entry.method === 8 ? inflateRawSync(raw) : null;
  if (!data) throw new Error(`unsupported zip compression method ${entry.method}: ${entry.name}`);
  if (data.length !== entry.size) throw new Error(`zip entry size mismatch: ${entry.name}`);
  return data;
}

export function extractZip(zipFile, destination) {
  const buffer = readFileSync(zipFile);
  const root = resolve(destination);
  mkdirSync(root, { recursive: true });
  for (const entry of zipEntries(buffer)) {
    const target = resolve(root, entry.name);
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`zip entry escapes destination: ${entry.name}`);
    const type = entry.mode & 0o170000;
    if (entry.name.endsWith("/") || type === 0o040000) { mkdirSync(target, { recursive: true }); continue; }
    mkdirSync(dirname(target), { recursive: true });
    const data = entryData(buffer, entry);
    if (type === 0o120000) {
      const link = data.toString("utf8");
      const linkRel = relative(root, resolve(dirname(target), link));
      if (linkRel.startsWith("..") || isAbsolute(link)) throw new Error(`zip symlink escapes destination: ${entry.name}`);
      symlinkSync(link, target);
      continue;
    }
    writeFileSync(target, data);
    if (process.platform !== "win32" && entry.mode & 0o777) chmodSync(target, entry.mode & 0o777);
  }
}
