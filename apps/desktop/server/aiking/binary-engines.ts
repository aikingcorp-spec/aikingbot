// Copyright (c) 2026 AIKING.
// One-click install of official single-binary engine CLIs, without a shell installer, Node or a terminal: the binary
// comes over HTTPS from the vendor's own release origin into an app-owned directory, its integrity is checked
// against the hash the origin publishes, and it must start before the engine is offered for sign-in.
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";
import { findCliCandidates, registerPathDir, resetPathCache } from "../env-path.ts";
import { execCli } from "../procs.ts";

const MAX_BINARY_BYTES = 400 * 1024 * 1024;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9._]+)?$/;

export interface BinaryEngine {
  label: string;
  cli: string;
  /** Plain-text latest stable version. */
  channelUrl: string;
  artifactUrl(version: string, platform: string): string;
}

/** xAI's installer (https://x.ai/cli/install.sh) resolves the same channel file and artifact names. */
export const BINARY_ENGINES: Record<string, BinaryEngine> = {
  grok: {
    label: "Grok CLI from x.ai",
    cli: "grok",
    channelUrl: "https://x.ai/cli/stable",
    artifactUrl: (version, platform) => `https://x.ai/cli/grok-${version}-${platform}${platform.startsWith("windows-") ? ".exe" : ""}`,
  },
};

export function binaryPlatform(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | null {
  const os = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : platform === "linux" ? "linux" : null;
  const cpu = arch === "x64" ? "x86_64" : arch === "arm64" ? "aarch64" : null;
  return os && cpu ? `${os}-${cpu}` : null;
}

/** Provider driver kinds whose CLI is one of these engines. */
const ENGINE_OF_DRIVER: Record<string, string> = { grokAgent: "grok" };

export function binaryEngineFor(driverKind: string | undefined): (BinaryEngine & { id: string }) | null {
  const id = driverKind ? ENGINE_OF_DRIVER[driverKind] : undefined;
  return id && binaryPlatform() ? { id, ...BINARY_ENGINES[id]! } : null;
}

export function binaryEnginesDir(baseDir = DATA_DIR): string {
  return join(baseDir, "tools", "bin");
}

/** Called once at boot, like the npm engines directory: engines installed here are on every turn's PATH. */
export function registerBinaryEnginesDir(baseDir = DATA_DIR): void {
  registerPathDir(binaryEnginesDir(baseDir));
}

/** GCS-backed origins send `x-goog-hash: md5=<base64>`; a mismatch means a truncated or altered download. */
function publishedMd5(headers: Headers): string | null {
  for (const part of (headers.get("x-goog-hash") ?? "").split(",")) {
    const match = /^\s*md5=([A-Za-z0-9+/=]+)\s*$/.exec(part);
    if (match) return match[1]!;
  }
  return null;
}

const running = new Map<string, Promise<string>>();

/** Installs or updates one binary engine; concurrent clicks share one download. Resolves to the installed path. */
export function installBinaryEngine(kind: string, options: { baseDir?: string; fetchImpl?: typeof fetch; platform?: string } = {}): Promise<string> {
  const key = `${options.baseDir ?? DATA_DIR} ${kind}`;
  const existing = running.get(key);
  if (existing) return existing;
  const run = installOnce(kind, options).finally(() => running.delete(key));
  running.set(key, run);
  return run;
}

async function installOnce(kind: string, options: { baseDir?: string; fetchImpl?: typeof fetch; platform?: string }): Promise<string> {
  const engine = BINARY_ENGINES[kind];
  const platform = options.platform ?? binaryPlatform();
  if (!engine || !platform) throw new Error(`${kind} cannot be installed automatically on this system.`);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const get = async (url: string, timeoutMs: number) => {
    try {
      return await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new Error(`Could not reach ${new URL(url).host} to download ${engine.label}. Check this computer's internet connection, then try again.`);
    }
  };
  const channel = await get(engine.channelUrl, 30_000);
  const version = channel.ok ? (await channel.text()).trim().split(/\s+/)[0] ?? "" : "";
  if (!VERSION.test(version)) throw new Error(`${engine.label}: the release channel did not return a version (HTTP ${channel.status}). Try again later.`);
  const response = await get(engine.artifactUrl(version, platform), 15 * 60_000);
  if (response.status === 404) throw new Error(`${engine.label} ${version} is not published for ${platform}.`);
  if (!response.ok || !response.body) throw new Error(`${engine.label} download failed (HTTP ${response.status}). Try again.`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BINARY_BYTES) throw new Error(`${engine.label} download is unexpectedly large; refusing it.`);
  const chunks: Buffer[] = []; let size = 0;
  const md5 = createHash("md5");
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_BINARY_BYTES) throw new Error(`${engine.label} download is unexpectedly large; refusing it.`);
    chunks.push(Buffer.from(chunk)); md5.update(chunk);
  }
  if (declared && size !== declared) throw new Error(`${engine.label} download was cut short. Try again.`);
  const expected = publishedMd5(response.headers);
  if (expected && md5.digest("base64") !== expected) throw new Error(`${engine.label} download did not match the hash its origin published; nothing was installed.`);

  const dir = binaryEnginesDir(options.baseDir);
  mkdirSync(dir, { recursive: true });
  const name = platform.startsWith("windows-") ? `${engine.cli}.exe` : engine.cli;
  const target = join(dir, name);
  const staged = `${target}.download-${process.pid}`;
  writeFileSync(staged, Buffer.concat(chunks), { mode: 0o755 });
  try {
    chmodSync(staged, 0o755);
    try { renameSync(staged, target); } catch {
      // Windows keeps a running .exe locked; move it aside first, as xAI's installer does.
      rmSync(`${target}.old`, { force: true }); renameSync(target, `${target}.old`); renameSync(staged, target);
    }
  } finally { rmSync(staged, { force: true }); }
  registerPathDir(dir);
  resetPathCache();
  const installed = findCliCandidates(engine.cli).find((path) => path.startsWith(dir)) ?? target;
  await new Promise<void>((resolve, reject) => {
    execCli(installed, ["--version"], { timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 }, (error) =>
      error ? reject(new Error(`${engine.label} ${version} was downloaded but does not start: ${error.message.slice(0, 300)}`)) : resolve());
  });
  return installed;
}
