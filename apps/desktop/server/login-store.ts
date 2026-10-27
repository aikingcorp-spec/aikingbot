// Sealed under a vault key of its own (OS keychain / secret-tool / fallback outside DATA_DIR), never the browser engine's,
// which every browser process gets in its environment. Neither ciphertext nor key is backed up or exported.
import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { HELD_SECRET_MASK } from "../shared/redact.ts";
import { LOGIN_FIELD_MAX, type LoginBots, type LoginSummary } from "../shared/logins.ts";
import { writeFileAtomic } from "./atomic.ts";
import { clearVaultDataKeyPrev, installVaultDataKey, readVaultDataKeyPrev, stashVaultDataKeyPrev, vaultDataKey, vaultDataKeyOrNull } from "./vault-key.ts";
import { decryptBrowserState, encryptBrowserState } from "./browser-sites.ts";
import type { TotpKey } from "./totp.ts";

export const LOGINS_FILE = "logins.json.enc";
export const LOGINS_KEY_FILE = "logins-key";
/** Durable ciphertext backup written before a vault-key rotate swap. Not a raw key. */
export const LOGINS_PREV_ENC = "vault.prev.enc";
/** Points at the vault prev-key slot name only — never stores key material. */
export const LOGINS_PREV_REF = "vault.prev.ref";
export const LOGINS_PREV_REF_VALUE = "logins-prev";

const totpSchema = z.object({
  secret: z.string().regex(/^[A-Z2-7]{16,}$/u),
  algorithm: z.enum(["SHA1", "SHA256", "SHA512"]),
  digits: z.number().int().min(6).max(8),
  period: z.number().int().min(10).max(300),
});

const loginSchema = z.object({
  id: z.string().min(1),
  host: z.string().min(1),
  username: z.string().max(LOGIN_FIELD_MAX),
  password: z.string().min(1).max(LOGIN_FIELD_MAX),
  totp: totpSchema.optional(),
  source: z.enum(["card", "settings"]),
  bots: z.union([z.literal("all"), z.array(z.string())]),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastUsedAt: z.number().optional(),
});

const fileSchema = z.object({
  version: z.literal(1),
  logins: z.array(loginSchema),
  onePassword: z.object({ token: z.string().min(1), connectedAt: z.number() }).optional(),
});

/** One saved login with its secrets. Server-only: no route returns this. */
export type StoredLogin = z.infer<typeof loginSchema>;
type StoreFile = z.infer<typeof fileSchema>;

export interface NewLogin {
  host: string;
  username: string;
  password: string;
  totp?: TotpKey | null;
  source: "card" | "settings";
  bots: LoginBots;
}

export interface LoginPatch {
  username?: string;
  password?: string;
  totp?: TotpKey | null;
  bots?: LoginBots;
}

const EMPTY: StoreFile = { version: 1, logins: [] };

export function summarizeLogin(login: StoredLogin): LoginSummary {
  return {
    id: login.id, host: login.host, username: login.username, hasTotp: Boolean(login.totp),
    source: login.source, bots: login.bots, createdAt: login.createdAt,
    ...(login.lastUsedAt === undefined ? {} : { lastUsedAt: login.lastUsedAt }),
  };
}

export class LoginStore {
  private readonly file: string;
  private readonly keyFile: string;
  private readonly prevEnc: string;
  private readonly prevRef: string;
  private readonly dataDir: string;
  private readonly now: () => number;
  private cache: StoreFile | null = null;
  private unreadableWarned = false;
  version = 0;

  constructor(options: { dataDir: string; now?: () => number }) {
    this.file = join(options.dataDir, LOGINS_FILE);
    this.keyFile = join(options.dataDir, LOGINS_KEY_FILE);
    this.prevEnc = join(options.dataDir, LOGINS_PREV_ENC);
    this.prevRef = join(options.dataDir, LOGINS_PREV_REF);
    this.dataDir = options.dataDir;
    this.now = options.now ?? Date.now;
    this.recoverRotateBackupIfNeeded();
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
    const verify = (key: string) => this.verifyKey(key);
    return create ? vaultDataKey("logins", this.keyFile, verify) : vaultDataKeyOrNull("logins", this.keyFile, verify);
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
        // Never log an unreadable file's contents.
        if (!this.unreadableWarned) console.warn("saved logins: the saved logins file could not be opened; it will be replaced on the next save");
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
    mkdirSync(join(this.file, ".."), { recursive: true });
    writeFileAtomic(this.file, encryptBrowserState(JSON.stringify(parsed), key), { mode: 0o600 });
    this.cache = parsed;
    this.version++;
  }

  list(): LoginSummary[] {
    return this.read().logins.map(summarizeLogin).sort((a, b) => a.host.localeCompare(b.host) || a.username.localeCompare(b.username));
  }

  get(id: string): StoredLogin | null {
    return this.read().logins.find((login) => login.id === id) ?? null;
  }

  create(input: NewLogin): LoginSummary {
    const data = this.read();
    const at = this.now();
    const same = data.logins.find((login) => login.host === input.host && login.username.toLowerCase() === input.username.toLowerCase());
    if (same) {
      const bots: LoginBots = same.bots === "all" || input.bots === "all" ? "all" : [...new Set([...same.bots, ...input.bots])];
      const updated: StoredLogin = { ...same, username: input.username, password: input.password, bots, updatedAt: at,
        ...(input.totp ? { totp: input.totp } : {}) };
      this.write({ ...data, logins: data.logins.map((login) => login.id === same.id ? updated : login) });
      return summarizeLogin(updated);
    }
    const login: StoredLogin = {
      id: randomUUID(), host: input.host, username: input.username, password: input.password,
      ...(input.totp ? { totp: input.totp } : {}),
      source: input.source, bots: input.bots, createdAt: at, updatedAt: at,
    };
    this.write({ ...data, logins: [...data.logins, login] });
    return summarizeLogin(login);
  }

  update(id: string, patch: LoginPatch): LoginSummary | null {
    const data = this.read();
    const current = data.logins.find((login) => login.id === id);
    if (!current) return null;
    const next: StoredLogin = {
      ...current,
      ...(patch.username === undefined ? {} : { username: patch.username }),
      ...(patch.password === undefined ? {} : { password: patch.password }),
      ...(patch.bots === undefined ? {} : { bots: patch.bots }),
      updatedAt: this.now(),
    };
    if (patch.totp === null) delete next.totp;
    else if (patch.totp) next.totp = patch.totp;
    this.write({ ...data, logins: data.logins.map((login) => login.id === id ? next : login) });
    return summarizeLogin(next);
  }

  remove(id: string): boolean {
    const data = this.read();
    if (!data.logins.some((login) => login.id === id)) return false;
    this.write({ ...data, logins: data.logins.filter((login) => login.id !== id) });
    return true;
  }

  usableFor(host: string, botId: string): StoredLogin[] {
    return this.read().logins.filter((login) => login.host === host && (login.bots === "all" || login.bots.includes(botId)));
  }

  hostsFor(botId: string): Array<{ host: string; username: string }> {
    return this.read().logins.filter((login) => login.bots === "all" || login.bots.includes(botId))
      .map((login) => ({ host: login.host, username: login.username }))
      .sort((a, b) => a.host.localeCompare(b.host) || a.username.localeCompare(b.username));
  }

  markUsed(id: string): void {
    const data = this.read();
    if (!data.logins.some((login) => login.id === id)) return;
    const at = this.now();
    this.write({ ...data, logins: data.logins.map((login) => login.id === id ? { ...login, lastUsedAt: at } : login) });
  }

  onePasswordToken(): string | null {
    return this.read().onePassword?.token ?? null;
  }

  setOnePasswordToken(token: string | null): void {
    const data = this.read();
    const { onePassword: _previous, ...rest } = data;
    this.write(token ? { ...rest, onePassword: { token, connectedAt: this.now() } } : rest);
  }


  /** Re-seal every login under a fresh vault key. Fails closed if the current file cannot be opened.
   * Order: durable prev ciphertext + prev-key slot → encrypt under next → verify in memory →
   * atomic swap of ciphertext → install the key → delete the backup. If install or restore fails,
   * the on-disk backup + prev-key slot keep logins recoverable on the next startup. */
  rotateEncryptionKey(): void {
    const data = this.read();
    if (this.unreadableWarned && data === EMPTY && existsSync(this.file)) {
      throw new Error("saved logins could not be opened; refusing to rotate the vault key");
    }
    const parsed = fileSchema.parse(data);
    const next = randomBytes(32).toString("hex");
    const ciphertext = encryptBrowserState(JSON.stringify(parsed), next);
    // Prove the new blob opens before we touch the durable key or replace the file.
    const verified = fileSchema.parse(JSON.parse(decryptBrowserState(ciphertext, next)));
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const previousCiphertext = existsSync(this.file) ? readFileSync(this.file) : null;
    const previousKey = vaultDataKeyOrNull("logins");

    // Durable backup BEFORE the swap: ciphertext beside the vault, previous key only in the vault backend.
    this.writeRotateBackup(previousCiphertext, previousKey);

    writeFileAtomic(this.file, ciphertext, { mode: 0o600 });
    try {
      // Confirm the on-disk blob still opens with next (guards a silent mis-write).
      fileSchema.parse(JSON.parse(decryptBrowserState(readFileSync(this.file), next)));
      installVaultDataKey("logins", next);
    } catch (error) {
      // Best-effort restore for the still-running process; leave the durable backup for startup recovery.
      try {
        if (previousCiphertext !== null) writeFileAtomic(this.file, previousCiphertext, { mode: 0o600 });
        else if (existsSync(this.file)) unlinkSync(this.file);
      } catch {
        /* restore may itself fail — backup remains */
      }
      try {
        if (previousKey && vaultDataKeyOrNull("logins") !== previousKey) {
          installVaultDataKey("logins", previousKey);
        }
      } catch {
        /* key rollback may itself fail — prev slot remains */
      }
      throw error;
    }
    this.clearRotateBackup();
    this.cache = verified;
    this.version++;
  }

  private syncDataDir(): void {
    if (process.platform === "win32") return;
    const fd = openSync(this.dataDir, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }

  /** Ciphertext backup in DATA_DIR + previous key in the vault backend prev slot; ref file names the slot only. */
  private writeRotateBackup(previousCiphertext: Buffer | null, previousKey: string | null): void {
    if (previousCiphertext !== null) {
      writeFileAtomic(this.prevEnc, previousCiphertext, { mode: 0o600 });
    } else if (existsSync(this.prevEnc)) {
      try { unlinkSync(this.prevEnc); } catch { /* absent */ }
    }
    if (previousKey) stashVaultDataKeyPrev("logins", previousKey);
    else clearVaultDataKeyPrev("logins");
    writeFileAtomic(this.prevRef, `${LOGINS_PREV_REF_VALUE}\n`, { mode: 0o600 });
    this.syncDataDir();
  }

  private clearRotateBackup(): void {
    try { if (existsSync(this.prevEnc)) unlinkSync(this.prevEnc); } catch { /* absent */ }
    try { if (existsSync(this.prevRef)) unlinkSync(this.prevRef); } catch { /* absent */ }
    clearVaultDataKeyPrev("logins");
  }

  /**
   * If a rotate left vault.prev.enc / vault.prev.ref behind, try every ciphertext×key pair,
   * keep the one that decrypts, clean up, and log a Vietnamese reason.
   */
  private recoverRotateBackupIfNeeded(): void {
    if (!existsSync(this.prevEnc) && !existsSync(this.prevRef)) return;
    const currentKey = vaultDataKeyOrNull("logins");
    const prevKey = readVaultDataKeyPrev("logins");
    const blobs: { label: string; bytes: Buffer }[] = [];
    if (existsSync(this.file)) {
      try { blobs.push({ label: "current", bytes: readFileSync(this.file) }); } catch { /* unreadable */ }
    }
    if (existsSync(this.prevEnc)) {
      try { blobs.push({ label: "prev", bytes: readFileSync(this.prevEnc) }); } catch { /* unreadable */ }
    }
    const keys: { label: string; value: string }[] = [];
    if (currentKey) keys.push({ label: "current", value: currentKey });
    if (prevKey && prevKey !== currentKey) keys.push({ label: "prev", value: prevKey });

    let recovered: StoreFile | null = null;
    let winningBlob: Buffer | null = null;
    let winningKey: string | null = null;
    for (const blob of blobs) {
      for (const key of keys) {
        try {
          const parsed = fileSchema.parse(JSON.parse(decryptBrowserState(blob.bytes, key.value)));
          recovered = parsed;
          winningBlob = blob.bytes;
          winningKey = key.value;
          break;
        } catch {
          /* try next pair */
        }
      }
      if (recovered) break;
    }

    if (!recovered || !winningBlob || !winningKey) {
      console.warn("saved logins: có bản sao rotate nhưng không giải mã được; giữ nguyên để người vận hành xử lý");
      return;
    }

    try {
      writeFileAtomic(this.file, winningBlob, { mode: 0o600 });
      if (vaultDataKeyOrNull("logins") !== winningKey) installVaultDataKey("logins", winningKey);
      this.clearRotateBackup();
      this.cache = recovered;
      this.version++;
      // Vietnamese reason for operators / support: rotate double-fault recovery.
      console.warn("saved logins: đã khôi phục từ bản sao trước khi xoay khóa (lỗi kép lúc rotate)");
    } catch {
      console.warn("saved logins: khôi phục bản sao rotate thất bại; giữ nguyên bản sao trên đĩa");
    }
  }


  secretValues(): string[] {
    const data = this.read();
    return [
      ...data.logins.flatMap((login) => [login.password, ...(login.totp ? [login.totp.secret] : [])]),
      ...(data.onePassword ? [data.onePassword.token] : []),
    ];
  }
}

// Saved secrets, passwords filled this run and recent one-time codes are masked wherever text crosses to a bot or a
// transcript. A screenshot cannot be scrubbed.

const MIN_SECRET = 4;
const CODE_MEMORY_MS = 5 * 60_000;
const FILLED_LIMIT = 500;

function htmlEscaped(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&#39;");
}

export function secretForms(value: string): string[] {
  const forms = new Set([value, JSON.stringify(value).slice(1, -1), htmlEscaped(value)]);
  try {
    forms.add(encodeURIComponent(value));
    forms.add(encodeURIComponent(value).replace(/%20/gu, "+"));
  } catch {}
  return [...forms].filter((form) => form.length >= MIN_SECRET);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export class HeldSecrets {
  private readonly filled = new Set<string>();
  private readonly codes = new Map<string, number>();
  private forms: string[] = [];
  private builtFor = -1;
  private filledVersion = 0;
  private builtFilled = -1;
  private readonly stored: { version: number; secretValues(): string[] };
  private readonly now: () => number;

  constructor(stored: { version: number; secretValues(): string[] }, now: () => number = Date.now) {
    this.stored = stored;
    this.now = now;
  }

  remember(value: string, kind: "password" | "code"): void {
    if (!value) return;
    if (kind === "code") {
      this.codes.set(value, this.now() + CODE_MEMORY_MS);
      return;
    }
    if (value.length < MIN_SECRET || this.filled.has(value)) return;
    if (this.filled.size >= FILLED_LIMIT) this.filled.delete(this.filled.values().next().value!);
    this.filled.add(value);
    this.filledVersion++;
  }

  private currentForms(): string[] {
    // Reading the store may load it, which bumps its version: read first.
    const values = this.stored.secretValues();
    if (this.builtFor !== this.stored.version || this.builtFilled !== this.filledVersion) {
      const all = new Set([...values, ...this.filled].flatMap(secretForms));
      // Longest first, so a password that contains another is masked whole.
      this.forms = [...all].sort((a, b) => b.length - a.length);
      this.builtFor = this.stored.version;
      this.builtFilled = this.filledVersion;
    }
    return this.forms;
  }

  scrub(text: string): string {
    if (!text) return text;
    let out = text;
    for (const form of this.currentForms()) if (out.includes(form)) out = out.split(form).join(HELD_SECRET_MASK);
    if (this.codes.size) {
      const now = this.now();
      for (const [code, until] of this.codes) {
        if (until <= now) { this.codes.delete(code); continue; }
        if (out.includes(code)) out = out.replace(new RegExp(`(?<!\\d)${escapeRegExp(code)}(?!\\d)`, "gu"), HELD_SECRET_MASK);
      }
    }
    return out;
  }
}
