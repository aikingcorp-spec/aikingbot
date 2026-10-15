// Copyright (c) 2026 AIKING.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { binaryEngineFor, binaryPlatform, BINARY_ENGINES, installBinaryEngine } from "./binary-engines.ts";

const script = Buffer.from("#!/bin/sh\necho 'grok 9.9.9'\n");
function origin(options: { md5?: string; status?: number; body?: Buffer } = {}) {
  const body = options.body ?? script;
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    if (String(url).endsWith("/stable")) return new Response("9.9.9\n");
    if (options.status) return new Response("missing", { status: options.status });
    return new Response(body, { headers: { "content-length": String(body.length), "x-goog-hash": `crc32c=AAAAAA==,md5=${options.md5 ?? createHash("md5").update(body).digest("base64")}` } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("binary engine installs", () => {
  it("maps platforms to the vendor's artifact names", () => {
    expect(binaryPlatform("win32", "x64")).toBe("windows-x86_64");
    expect(binaryPlatform("linux", "arm64")).toBe("linux-aarch64");
    expect(binaryPlatform("aix" as NodeJS.Platform, "x64")).toBeNull();
    expect(binaryEngineFor("grokAgent")?.id).toBe("grok");
    expect(binaryEngineFor("codex")).toBeNull();
    expect(BINARY_ENGINES.grok!.artifactUrl("1.0.52", "windows-x86_64")).toBe("https://x.ai/cli/grok-1.0.52-windows-x86_64.exe");
    expect(BINARY_ENGINES.grok!.artifactUrl("1.0.52", "linux-x86_64")).toBe("https://x.ai/cli/grok-1.0.52-linux-x86_64");
  });

  it.skipIf(process.platform === "win32")("installs the latest release into the app directory and proves it starts", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "aiking-binary-"));
    try {
      const { fetchImpl, calls } = origin();
      const installed = await installBinaryEngine("grok", { baseDir, fetchImpl, platform: "linux-x86_64" });
      expect(installed).toBe(join(baseDir, "tools", "bin", "grok"));
      expect(calls).toEqual(["https://x.ai/cli/stable", "https://x.ai/cli/grok-9.9.9-linux-x86_64"]);
    } finally { rmSync(baseDir, { recursive: true, force: true }); }
  });

  it("refuses a download that does not match the published hash, and a missing platform build", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "aiking-binary-"));
    try {
      await expect(installBinaryEngine("grok", { baseDir, fetchImpl: origin({ md5: "AAAAAAAAAAAAAAAAAAAAAA==" }).fetchImpl, platform: "linux-x86_64" })).rejects.toThrow(/did not match the hash/);
      expect(existsSync(join(baseDir, "tools", "bin", "grok"))).toBe(false);
      await expect(installBinaryEngine("grok", { baseDir, fetchImpl: origin({ status: 404 }).fetchImpl, platform: "linux-x86_64" })).rejects.toThrow(/not published for linux-x86_64/);
      await expect(installBinaryEngine("unknown", { baseDir })).rejects.toThrow(/cannot be installed automatically/);
    } finally { rmSync(baseDir, { recursive: true, force: true }); }
  });
});
