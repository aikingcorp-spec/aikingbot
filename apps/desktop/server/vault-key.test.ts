import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearVaultDataKeyPrev,
  migrateLegacyKeyFile,
  readVaultDataKeyPrev,
  resetVaultKeyIoForTests,
  rotateVaultDataKey,
  stashVaultDataKeyPrev,
  vaultDataKey,
  vaultStatus,
} from "./vault-key.ts";

let vaultDir: string;
let dataDir: string;
beforeEach(() => {
  vaultDir = mkdtempSync(join(tmpdir(), "vault-"));
  dataDir = mkdtempSync(join(tmpdir(), "data-"));
  resetVaultKeyIoForTests();
  process.env.AIKING_VAULT_DIR = vaultDir;
  process.env.AIKING_VAULT_BACKEND = "fallback";
});
afterEach(() => {
  rmSync(vaultDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  resetVaultKeyIoForTests();
  delete process.env.AIKING_VAULT_DIR;
  delete process.env.AIKING_VAULT_BACKEND;
});

describe("vault-key", () => {
  it("stores the key outside DATA_DIR and reuses it", () => {
    const key = vaultDataKey("browser-engine");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(vaultDataKey("browser-engine")).toBe(key);
    expect(existsSync(join(dataDir, "browser-engine-key"))).toBe(false);
    expect(readFileSync(join(vaultDir, "browser-engine.key"), "utf8").trim()).toBe(key);
    expect(vaultStatus().backend).toBe("fallback");
    expect(vaultStatus().banner).toMatch(/keychain unavailable/i);
  });

  it("migrates a legacy DATA_DIR key only after a verified round-trip", () => {
    const legacy = "a".repeat(64);
    const legacyFile = join(dataDir, "browser-engine-key");
    writeFileSync(legacyFile, `${legacy}\n`, { mode: 0o600 });
    expect(vaultDataKey("browser-engine", legacyFile)).toBe(legacy);
    expect(existsSync(legacyFile)).toBe(false);
    expect(readFileSync(join(vaultDir, "browser-engine.key"), "utf8").trim()).toBe(legacy);
  });

  it("leaves a mismatched legacy file alone when the vault already has a different key", () => {
    const vaulted = vaultDataKey("logins");
    const legacyFile = join(dataDir, "logins-key");
    writeFileSync(legacyFile, `${"b".repeat(64)}\n`);
    migrateLegacyKeyFile("logins", legacyFile, vaulted);
    expect(existsSync(legacyFile)).toBe(true);
    expect(vaultDataKey("logins")).toBe(vaulted);
  });

  it("rotates to a new key", () => {
    const previous = vaultDataKey("browser-engine");
    const rotated = rotateVaultDataKey("browser-engine");
    expect(rotated.previous).toBe(previous);
    expect(rotated.next).not.toBe(previous);
    expect(vaultDataKey("browser-engine")).toBe(rotated.next);
  });

  it("stashes the previous key in a prev slot outside DATA_DIR", () => {
    const key = vaultDataKey("logins");
    stashVaultDataKeyPrev("logins", key);
    expect(readVaultDataKeyPrev("logins")).toBe(key);
    expect(existsSync(join(vaultDir, "logins-prev.key"))).toBe(true);
    expect(existsSync(join(dataDir, "logins-prev.key"))).toBe(false);
    expect(existsSync(join(dataDir, "vault.prev.enc"))).toBe(false);
    clearVaultDataKeyPrev("logins");
    expect(readVaultDataKeyPrev("logins")).toBeNull();
    expect(existsSync(join(vaultDir, "logins-prev.key"))).toBe(false);
  });
});
