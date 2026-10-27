// Data-at-rest keys for the vault (browser sessions, saved logins). Prefer an OS secret
// store; otherwise a 0600 file outside DATA_DIR. Never keep the key beside the ciphertext.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { writeFileAtomic } from "./atomic.ts";

export type VaultPurpose = "browser-engine" | "logins" | "custom-secrets";
/** Active key or the durable previous-key slot used during rotate recovery. Never next to DATA_DIR. */
export type VaultKeySlot = VaultPurpose | `${VaultPurpose}-prev`;

export function vaultPrevSlot(purpose: VaultPurpose): VaultKeySlot {
  return `${purpose}-prev`;
}
export type VaultBackend = "keychain" | "secret-tool" | "fallback";

export interface VaultStatus {
  backend: VaultBackend;
  /** Present while the OS keychain is not protecting the key. */
  banner?: string;
}

export interface VaultKeyIo {
  backend: VaultBackend;
  read(purpose: VaultKeySlot): string | null;
  write(purpose: VaultKeySlot, key: string): void;
  clear(purpose: VaultKeySlot): void;
}

const HEX64 = /^[0-9a-f]{64}$/u;
const SECRET_TOOL_ATTR = "com.aikingbot.vault";

export function vaultRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AIKING_VAULT_DIR?.trim()) return env.AIKING_VAULT_DIR.trim();
  if (env.AIKING_USER_DATA?.trim()) return join(env.AIKING_USER_DATA.trim(), "vault");
  const config = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(config, "aikingbot", "vault");
}

function filePath(root: string, purpose: VaultKeySlot): string {
  return join(root, `${purpose}.key`);
}

function readHexFile(path: string): string | null {
  try {
    const text = readFileSync(path, "utf8").trim();
    return HEX64.test(text) ? text : null;
  } catch {
    return null;
  }
}

function writeHexFile(path: string, key: string): void {
  if (!HEX64.test(key)) throw new Error("vault key must be 64 hex characters");
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileAtomic(path, `${key}\n`, { mode: 0o600 });
}

function secretToolAvailable(): boolean {
  try {
    execFileSync("secret-tool", ["--version"], { stdio: "ignore", timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

function secretToolLookup(purpose: VaultKeySlot): string | null {
  try {
    const text = execFileSync("secret-tool", ["lookup", SECRET_TOOL_ATTR, purpose], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return HEX64.test(text) ? text : null;
  } catch {
    return null;
  }
}

function secretToolStore(purpose: VaultKeySlot, key: string): void {
  execFileSync("secret-tool", ["store", "--label", `AIKINGBOT ${purpose}`, SECRET_TOOL_ATTR, purpose], {
    input: key, encoding: "utf8", timeout: 5_000, stdio: ["pipe", "ignore", "ignore"],
  });
}

function secretToolClear(purpose: VaultKeySlot): void {
  try {
    execFileSync("secret-tool", ["clear", SECRET_TOOL_ATTR, purpose], {
      timeout: 5_000, stdio: "ignore",
    });
  } catch {
  }
}

export function resolveVaultBackend(env: NodeJS.ProcessEnv = process.env): VaultBackend {
  const forced = env.AIKING_VAULT_BACKEND?.trim();
  if (forced === "keychain" || forced === "secret-tool" || forced === "fallback") return forced;
  // Prefer libsecret when the binary is on PATH; a missing session bus falls back at write time.
  if (secretToolAvailable()) return "secret-tool";
  return "fallback";
}

export function createVaultKeyIo(env: NodeJS.ProcessEnv = process.env): VaultKeyIo {
  const backend = resolveVaultBackend(env);
  const root = vaultRoot(env);
  if (backend === "secret-tool") {
    return {
      backend,
      read: (purpose) => secretToolLookup(purpose) ?? readHexFile(filePath(root, purpose)),
      write: (purpose, key) => {
        try { secretToolStore(purpose, key); }
        catch {
          // libsecret/dbus unavailable at write time: durable fallback, still outside DATA_DIR.
          writeHexFile(filePath(root, purpose), key);
        }
      },
      clear: (purpose) => {
        secretToolClear(purpose);
        try { unlinkSync(filePath(root, purpose)); } catch { /* absent */ }
      },
    };
  }
  // keychain (Electron-managed dir) and fallback share the same on-disk shape outside DATA_DIR.
  return {
    backend,
    read: (purpose) => readHexFile(filePath(root, purpose)),
    write: (purpose, key) => writeHexFile(filePath(root, purpose), key),
    clear: (purpose) => { try { unlinkSync(filePath(root, purpose)); } catch { /* absent */ } },
  };
}

let io: VaultKeyIo | undefined;

export function resetVaultKeyIoForTests(): void {
  io = undefined;
}

export function setVaultKeyIoForTests(next: VaultKeyIo | undefined): void {
  io = next;
}

function activeIo(): VaultKeyIo {
  return (io ??= createVaultKeyIo());
}

export type VaultMigrateVerify = (key: string) => boolean;

/** Read the key without creating one. Still migrates a legacy file when the vault is empty. */
export function vaultDataKeyOrNull(purpose: VaultPurpose, legacyFile?: string, verify?: VaultMigrateVerify): string | null {
  const store = activeIo();
  const existing = store.read(purpose);
  if (existing) {
    if (legacyFile && existsSync(legacyFile)) migrateLegacyKeyFile(purpose, legacyFile, existing, verify);
    return existing;
  }
  if (legacyFile) {
    const legacy = readHexFile(legacyFile);
    if (legacy) {
      if (verify && !verify(legacy)) throw new Error(`vault migration refused: ${purpose} ciphertext did not decrypt`);
      store.write(purpose, legacy);
      if (store.read(purpose) !== legacy) throw new Error(`vault migration could not verify the ${purpose} key`);
      unlinkSync(legacyFile);
      return legacy;
    }
  }
  return null;
}

/** Load or create the key for `purpose`. Migrates a legacy DATA_DIR key file when present. */
export function vaultDataKey(purpose: VaultPurpose, legacyFile?: string, verify?: VaultMigrateVerify): string {
  const store = activeIo();
  const existing = store.read(purpose);
  if (existing) {
    if (legacyFile && existsSync(legacyFile)) migrateLegacyKeyFile(purpose, legacyFile, existing, verify);
    return existing;
  }
  if (legacyFile) {
    const legacy = readHexFile(legacyFile);
    if (legacy) {
      if (verify && !verify(legacy)) throw new Error(`vault migration refused: ${purpose} ciphertext did not decrypt`);
      store.write(purpose, legacy);
      const verified = store.read(purpose);
      if (verified !== legacy) throw new Error(`vault migration could not verify the ${purpose} key`);
      unlinkSync(legacyFile);
      return legacy;
    }
  }
  const key = randomBytes(32).toString("hex");
  store.write(purpose, key);
  return key;
}

/** Move a legacy key file into the vault only after optional ciphertext verify and a round-trip read match. */
export function migrateLegacyKeyFile(purpose: VaultPurpose, legacyFile: string, expected?: string, verify?: VaultMigrateVerify): void {
  if (!existsSync(legacyFile)) return;
  const legacy = readHexFile(legacyFile);
  if (!legacy) return;
  if (expected && expected !== legacy) {
    // Vault already has a different key; leave the legacy file for an operator.
    return;
  }
  if (verify && !verify(legacy)) throw new Error(`vault migration refused: ${purpose} ciphertext did not decrypt`);
  const store = activeIo();
  const current = store.read(purpose);
  if (current && current !== legacy) return;
  if (!current) store.write(purpose, legacy);
  if (store.read(purpose) !== legacy) throw new Error(`vault migration could not verify the ${purpose} key`);
  unlinkSync(legacyFile);
}

/** Replace the key. Caller must re-encrypt every sealed blob before discarding the old key. */
export function rotateVaultDataKey(purpose: VaultPurpose): { previous: string | null; next: string } {
  const store = activeIo();
  const previous = store.read(purpose);
  const next = randomBytes(32).toString("hex");
  store.write(purpose, next);
  if (store.read(purpose) !== next) throw new Error(`vault rotate could not verify the ${purpose} key`);
  return { previous, next };
}

/** Persist a predetermined key. Used after ciphertext has already been re-sealed under it.
 * If the post-write verify fails, the previous key is written back (or cleared) so callers are not
 * left with a half-installed key. */
export function installVaultDataKey(purpose: VaultPurpose, key: string): void {
  if (!HEX64.test(key)) throw new Error("vault key must be 64 hex characters");
  const store = activeIo();
  const previous = store.read(purpose);
  store.write(purpose, key);
  if (store.read(purpose) !== key) {
    try {
      if (previous) store.write(purpose, previous);
      else store.clear(purpose);
    } catch {
      /* best-effort rollback */
    }
    throw new Error(`vault install could not verify the ${purpose} key`);
  }
}

/** Stash the previous key in the same backend under the prev slot (outside DATA_DIR). */
export function stashVaultDataKeyPrev(purpose: VaultPurpose, key: string): void {
  if (!HEX64.test(key)) throw new Error("vault key must be 64 hex characters");
  const store = activeIo();
  const slot = vaultPrevSlot(purpose);
  store.write(slot, key);
  if (store.read(slot) !== key) throw new Error(`vault could not verify the ${slot} key`);
}

export function readVaultDataKeyPrev(purpose: VaultPurpose): string | null {
  return activeIo().read(vaultPrevSlot(purpose));
}

export function clearVaultDataKeyPrev(purpose: VaultPurpose): void {
  activeIo().clear(vaultPrevSlot(purpose));
}

export function revokeVaultDataKey(purpose: VaultPurpose): void {
  activeIo().clear(purpose);
}

export function vaultStatus(env: NodeJS.ProcessEnv = process.env): VaultStatus {
  const backend = (io ?? createVaultKeyIo(env)).backend;
  if (backend === "fallback") {
    return {
      backend,
      banner: "No system keyring was found, so the key that protects saved logins is kept in a private file outside the data folder. On a server without a screen this is normal.",
    };
  }
  return { backend };
}
