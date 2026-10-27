/**
 * Vault-backed custom secrets requested through the secure credential card.
 * Values live under refs `secret:custom/<name>`; agents never see the value,
 * only the ref. Tools resolve refs server-side at call time.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { decryptBrowserState, encryptBrowserState } from "./browser-sites.ts";
import {
  clearVaultDataKeyPrev,
  installVaultDataKey,
  stashVaultDataKeyPrev,
  vaultDataKey,
  vaultDataKeyOrNull,
} from "./vault-key.ts";
import { randomBytes } from "node:crypto";

export const CUSTOM_SECRETS_FILE = "custom-secrets.json.enc";
export const CUSTOM_SECRETS_KEY_FILE = "custom-secrets-key";
export const CUSTOM_SECRET_NAME_RE = /^[a-z0-9_-]{1,40}$/u;
export const CUSTOM_SECRET_LABEL_MAX = 60;
export const SECRET_REF_PREFIX = "secret:";

const fileSchema = z.object({
  version: z.literal(1),
  secrets: z.record(z.string(), z.string().min(1).max(8_192)),
});

type StoreFile = z.infer<typeof fileSchema>;
const EMPTY: StoreFile = { version: 1, secrets: {} };

export function isCustomSecretName(value: unknown): value is string {
  return typeof value === "string" && CUSTOM_SECRET_NAME_RE.test(value);
}

export function parseCustomSecretLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim().slice(0, CUSTOM_SECRET_LABEL_MAX);
  return label.length > 0 ? label : null;
}

export function formatCustomSecretRef(name: string): string {
  return `${SECRET_REF_PREFIX}custom/${name}`;
}

/** Parse `secret:custom/<name>` (and reject anything else). */
export function parseSecretRef(ref: unknown): { kind: "custom"; name: string } | null {
  if (typeof ref !== "string" || !ref.startsWith(SECRET_REF_PREFIX)) return null;
  const body = ref.slice(SECRET_REF_PREFIX.length);
  const match = /^custom\/([a-z0-9_-]{1,40})$/u.exec(body);
  if (!match) return null;
  return { kind: "custom", name: match[1]! };
}

export class CustomSecretStore {
  private readonly file: string;
  private readonly keyFile: string;
  private readonly dataDir: string;
  private cache: StoreFile | null = null;
  private unreadableWarned = false;
  version = 0;

  constructor(options: { dataDir: string }) {
    this.dataDir = options.dataDir;
    this.file = join(options.dataDir, CUSTOM_SECRETS_FILE);
    this.keyFile = join(options.dataDir, CUSTOM_SECRETS_KEY_FILE);
  }

  private verifyKey(key: string): boolean {
    if (!existsSync(this.file)) return true;
    try {
      fileSchema.parse(JSON.parse(decryptBrowserState(readFileSync(this.file), key)));
      return true;
    } catch {
      return false;
    }
  }

  private key(create: boolean): string | null {
    const verify = (candidate: string) => this.verifyKey(candidate);
    return create
      ? vaultDataKey("custom-secrets", this.keyFile, verify)
      : vaultDataKeyOrNull("custom-secrets", this.keyFile, verify);
  }

  private read(): StoreFile {
    if (this.cache) return this.cache;
    let data: StoreFile = EMPTY;
    if (existsSync(this.file)) {
      const key = this.key(false);
      try {
        if (!key) throw new Error("missing key");
        data = fileSchema.parse(JSON.parse(decryptBrowserState(readFileSync(this.file), key)));
      } catch {
        if (!this.unreadableWarned) {
          console.warn("custom secrets: the vault file could not be opened; it will be replaced on the next save");
        }
        this.unreadableWarned = true;
        data = EMPTY;
      }
    }
    this.cache = data;
    this.version++;
    return data;
  }

  private write(data: StoreFile): void {
    const parsed = fileSchema.parse(data);
    const key = this.key(true)!;
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, encryptBrowserState(JSON.stringify(parsed), key), { mode: 0o600 });
    this.cache = parsed;
    this.version++;
  }

  has(name: string): boolean {
    if (!isCustomSecretName(name)) return false;
    return Object.prototype.hasOwnProperty.call(this.read().secrets, name);
  }

  get(name: string): string | null {
    if (!isCustomSecretName(name)) return null;
    return this.read().secrets[name] ?? null;
  }

  put(name: string, value: string): { ref: string } {
    if (!isCustomSecretName(name)) throw new Error("invalid custom secret name");
    const trimmed = value.trim();
    if (!trimmed) throw new Error("custom secret value required");
    if (trimmed.length > 8_192) throw new Error("custom secret value too long");
    const data = this.read();
    this.write({ ...data, secrets: { ...data.secrets, [name]: trimmed } });
    return { ref: formatCustomSecretRef(name) };
  }

  remove(name: string): boolean {
    if (!isCustomSecretName(name) || !this.has(name)) return false;
    const data = this.read();
    const next = { ...data.secrets };
    delete next[name];
    this.write({ ...data, secrets: next });
    return true;
  }

  /** Names only — never values. */
  list(): string[] {
    return Object.keys(this.read().secrets).sort();
  }

  secretValues(): string[] {
    return Object.values(this.read().secrets);
  }

  /** Resolve a `secret:…` ref to its value, or null if missing/unknown. */
  resolve(ref: string): string | null {
    const parsed = parseSecretRef(ref);
    if (!parsed) return null;
    return this.get(parsed.name);
  }

  rotateEncryptionKey(): void {
    const data = this.read();
    if (this.unreadableWarned && data === EMPTY && existsSync(this.file)) {
      throw new Error("custom secrets could not be opened; refusing to rotate the vault key");
    }
    const parsed = fileSchema.parse(data);
    const next = randomBytes(32).toString("hex");
    const ciphertext = encryptBrowserState(JSON.stringify(parsed), next);
    fileSchema.parse(JSON.parse(decryptBrowserState(ciphertext, next)));
    const previousKey = vaultDataKeyOrNull("custom-secrets");
    if (previousKey) stashVaultDataKeyPrev("custom-secrets", previousKey);
    writeFileAtomic(this.file, ciphertext, { mode: 0o600 });
    try {
      fileSchema.parse(JSON.parse(decryptBrowserState(readFileSync(this.file), next)));
      installVaultDataKey("custom-secrets", next);
      clearVaultDataKeyPrev("custom-secrets");
    } catch (error) {
      if (previousKey) {
        try {
          installVaultDataKey("custom-secrets", previousKey);
        } catch { /* leave prev slot */ }
      }
      throw error;
    }
    this.cache = parsed;
    this.version++;
  }
}

/**
 * Replace any string value that is a known secret ref with the vault value.
 * Unknown refs and missing names stay unresolved (caller decides).
 */
export function resolveSecretRefsInRecord(
  store: CustomSecretStore,
  incoming: Record<string, string>,
): { ok: true; values: Record<string, string> } | { ok: false; error: string } {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    const parsed = parseSecretRef(value);
    if (!parsed) {
      values[key] = value;
      continue;
    }
    const resolved = store.get(parsed.name);
    if (resolved === null) {
      return { ok: false, error: `Secret ref ${formatCustomSecretRef(parsed.name)} is not configured.` };
    }
    values[key] = resolved;
  }
  return { ok: true, values };
}
