import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addHeldSecretScrubber, redactSecretsInText } from "../shared/redact.ts";
import { HeldSecrets, LOGINS_FILE, LOGINS_PREV_ENC, LOGINS_PREV_REF, LoginStore, secretForms } from "./login-store.ts";
import { parseTotpKey } from "./totp.ts";
import { readVaultDataKeyPrev, resetVaultKeyIoForTests, vaultDataKeyOrNull } from "./vault-key.ts";
import * as vaultKey from "./vault-key.ts";
import * as atomicMod from "./atomic.ts";

// Obvious fakes only: nothing here is anyone's real login.
const PASSWORD = "fake-Pa55word&<\"quoted\">";
const TOTP = parseTotpKey("JBSWY3DPEHPK3PXP")!;

let dir: string;
let vaultDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aiking-logins-"));
  vaultDir = mkdtempSync(join(tmpdir(), "aiking-vault-"));
  resetVaultKeyIoForTests();
  process.env.AIKING_VAULT_DIR = vaultDir;
  process.env.AIKING_VAULT_BACKEND = "fallback";
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(vaultDir, { recursive: true, force: true });
  resetVaultKeyIoForTests();
  delete process.env.AIKING_VAULT_DIR;
  delete process.env.AIKING_VAULT_BACKEND;
});

describe("the saved logins store", () => {
  it("round-trips a login and keeps nothing readable on disk", () => {
    const store = new LoginStore({ dataDir: dir, now: () => 1_000 });
    const saved = store.create({ host: "accounts.example.com", username: "alice@example.com", password: PASSWORD, totp: TOTP, source: "settings", bots: "all" });
    expect(saved).toEqual({ id: saved.id, host: "accounts.example.com", username: "alice@example.com", hasTotp: true, source: "settings", bots: "all", createdAt: 1_000 });
    expect(JSON.stringify(saved)).not.toContain(PASSWORD);

    const reopened = new LoginStore({ dataDir: dir });
    expect(reopened.list()).toEqual([saved]);
    expect(reopened.usableFor("accounts.example.com", "any-bot")[0]).toMatchObject({ password: PASSWORD, totp: TOTP });

    expect(readdirSync(dir)).toEqual([LOGINS_FILE]);
    expect(readdirSync(vaultDir)).toEqual(["logins.key"]);
    const sealed = readFileSync(join(dir, LOGINS_FILE));
    for (const word of [PASSWORD, "fake-Pa55word", "alice@example.com", "accounts.example.com", TOTP.secret, "password", "username"]) {
      expect(sealed.includes(Buffer.from(word)), word).toBe(false);
    }
    if (process.platform !== "win32") {
      expect(statSync(join(dir, LOGINS_FILE)).mode & 0o777).toBe(0o600);
      expect(statSync(join(vaultDir, "logins.key")).mode & 0o777).toBe(0o600);
    }
  });

  it("makes no key and no file until something is saved", () => {
    const store = new LoginStore({ dataDir: dir });
    expect(store.list()).toEqual([]);
    expect(store.secretValues()).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("opens nothing, and says so once, when the vault key does not fit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    new LoginStore({ dataDir: dir }).create({ host: "example.com", username: "a", password: PASSWORD, source: "card", bots: ["b1"] });
    writeFileSync(join(vaultDir, "logins.key"), `${"0".repeat(64)}\n`);
    resetVaultKeyIoForTests();
    const store = new LoginStore({ dataDir: dir });
    expect(store.list()).toEqual([]);
    expect(store.list()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).not.toContain(PASSWORD);
    warn.mockRestore();
  });

  it("fills only on the exact host, for the bots allowed", () => {
    const store = new LoginStore({ dataDir: dir });
    store.create({ host: "example.com", username: "card-user", password: PASSWORD, source: "card", bots: ["pepper"] });
    store.create({ host: "example.com", username: "shared", password: "fake-other-1", source: "settings", bots: "all" });
    expect(store.usableFor("example.com", "pepper").map((login) => login.username).sort()).toEqual(["card-user", "shared"]);
    expect(store.usableFor("example.com", "quill").map((login) => login.username)).toEqual(["shared"]);
    for (const host of ["accounts.example.com", "www.example.com", "example.com.evil.test", "ample.com"]) expect(store.usableFor(host, "pepper")).toEqual([]);
    expect(store.hostsFor("quill")).toEqual([{ host: "example.com", username: "shared" }]);
  });

  it("saving the same host and username again replaces the password and widens who may use it", () => {
    const store = new LoginStore({ dataDir: dir });
    const first = store.create({ host: "example.com", username: "Alice", password: "fake-old-pass", source: "card", bots: ["pepper"] });
    const second = store.create({ host: "example.com", username: "alice", password: "fake-new-pass", source: "card", bots: ["quill"] });
    expect(second.id).toBe(first.id);
    expect(store.list()).toHaveLength(1);
    expect(store.get(first.id)).toMatchObject({ password: "fake-new-pass", bots: ["pepper", "quill"] });
    expect(store.secretValues()).not.toContain("fake-old-pass");
  });

  it("replaces a password or 2FA key, changes who may use it, and forgets a deleted login's secrets", () => {
    const store = new LoginStore({ dataDir: dir });
    const login = store.create({ host: "example.com", username: "a", password: "fake-one-pass", totp: TOTP, source: "settings", bots: "all" });
    expect(store.update(login.id, { password: "fake-two-pass", bots: ["pepper"] })).toMatchObject({ hasTotp: true, bots: ["pepper"] });
    expect(store.update(login.id, { totp: null })).toMatchObject({ hasTotp: false });
    expect(store.secretValues()).toEqual(["fake-two-pass"]);
    expect(store.remove(login.id)).toBe(true);
    expect(store.secretValues()).toEqual([]);
    expect(store.update("missing", { password: "x-x-x-x" })).toBeNull();
  });

  it("keeps the 1Password token in the same sealed file", () => {
    const store = new LoginStore({ dataDir: dir });
    store.setOnePasswordToken("ops_fake-service-account-token");
    expect(new LoginStore({ dataDir: dir }).onePasswordToken()).toBe("ops_fake-service-account-token");
    expect(readFileSync(join(dir, LOGINS_FILE)).includes(Buffer.from("ops_fake"))).toBe(false);
    store.setOnePasswordToken(null);
    expect(new LoginStore({ dataDir: dir }).onePasswordToken()).toBeNull();
  });

  it("rotates the vault key only after re-encrypting, and keeps logins readable", () => {
    const store = new LoginStore({ dataDir: dir, now: () => 1_000 });
    store.create({ host: "accounts.example.com", username: "alice@example.com", password: PASSWORD, source: "settings", bots: "all" });
    const before = vaultDataKeyOrNull("logins");
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    store.rotateEncryptionKey();
    const after = vaultDataKeyOrNull("logins");
    expect(after).toMatch(/^[0-9a-f]{64}$/);
    expect(after).not.toBe(before);
    const reopened = new LoginStore({ dataDir: dir });
    expect(reopened.usableFor("accounts.example.com", "any-bot")[0]).toMatchObject({ password: PASSWORD });
  });

  it("keeps the old key and ciphertext when the re-encrypt write fails mid-rotate (no data loss)", () => {
    const store = new LoginStore({ dataDir: dir, now: () => 1_000 });
    store.create({ host: "accounts.example.com", username: "alice@example.com", password: PASSWORD, source: "settings", bots: "all" });
    const before = vaultDataKeyOrNull("logins");
    expect(before).toBeTruthy();
    chmodSync(dir, 0o555);
    try {
      expect(() => store.rotateEncryptionKey()).toThrow();
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(vaultDataKeyOrNull("logins")).toBe(before);
    const reopened = new LoginStore({ dataDir: dir });
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.usableFor("accounts.example.com", "any-bot")[0]).toMatchObject({ password: PASSWORD });
  });

  it("restores the previous ciphertext when installVaultDataKey throws after a successful write (no data loss)", () => {
    const store = new LoginStore({ dataDir: dir, now: () => 1_000 });
    store.create({ host: "accounts.example.com", username: "alice@example.com", password: PASSWORD, source: "settings", bots: "all" });
    const before = vaultDataKeyOrNull("logins");
    expect(before).toBeTruthy();
    const previousBlob = readFileSync(join(dir, LOGINS_FILE));
    const spy = vi.spyOn(vaultKey, "installVaultDataKey").mockImplementation(() => {
      throw new Error("simulated crash after ciphertext write / during key install");
    });
    try {
      expect(() => store.rotateEncryptionKey()).toThrow(/simulated crash after ciphertext write/);
    } finally {
      spy.mockRestore();
    }
    expect(vaultDataKeyOrNull("logins")).toBe(before);
    // On-disk blob must match the pre-rotate ciphertext (restored), not the new-key seal.
    expect(Buffer.compare(readFileSync(join(dir, LOGINS_FILE)), previousBlob)).toBe(0);
    const reopened = new LoginStore({ dataDir: dir });
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.usableFor("accounts.example.com", "any-bot")[0]).toMatchObject({ password: PASSWORD });
    // Retry succeeds once install works again.
    reopened.rotateEncryptionKey();
    expect(vaultDataKeyOrNull("logins")).not.toBe(before);
    expect(new LoginStore({ dataDir: dir }).usableFor("accounts.example.com", "any-bot")[0]).toMatchObject({ password: PASSWORD });
  });

  it("2a: install throws then restore write throws — after restart logins are readable from durable backup", () => {
    const store = new LoginStore({ dataDir: dir, now: () => 1_000 });
    store.create({ host: "accounts.example.com", username: "alice@example.com", password: PASSWORD, source: "settings", bots: "all" });
    const before = vaultDataKeyOrNull("logins");
    expect(before).toBeTruthy();
    let loginFileWrites = 0;
    const realAtomic = atomicMod.writeFileAtomic;
    const atomicSpy = vi.spyOn(atomicMod, "writeFileAtomic").mockImplementation((path, data, opts) => {
      if (String(path).endsWith(LOGINS_FILE)) {
        loginFileWrites++;
        // 1 = swap to next ciphertext; 2 = restore of previous — fail the restore.
        if (loginFileWrites === 2) throw new Error("simulated restore write failure (double fault)");
      }
      return realAtomic(path, data, opts);
    });
    const installSpy = vi.spyOn(vaultKey, "installVaultDataKey").mockImplementation(() => {
      throw new Error("simulated install failure");
    });
    try {
      expect(() => store.rotateEncryptionKey()).toThrow(/simulated install failure/);
    } finally {
      atomicSpy.mockRestore();
      installSpy.mockRestore();
    }
    expect(existsSync(join(dir, LOGINS_PREV_ENC))).toBe(true);
    expect(existsSync(join(dir, LOGINS_PREV_REF))).toBe(true);
    expect(readVaultDataKeyPrev("logins")).toBe(before);
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".key") || name === "logins-key") expect.fail(`key material in data dir: ${name}`);
      if (name === LOGINS_PREV_REF) {
        const ref = readFileSync(join(dir, name), "utf8");
        expect(ref).not.toMatch(/[0-9a-f]{64}/);
      }
    }
    const reopened = new LoginStore({ dataDir: dir });
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.usableFor("accounts.example.com", "any-bot")[0]).toMatchObject({ password: PASSWORD });
    expect(existsSync(join(dir, LOGINS_PREV_ENC))).toBe(false);
    expect(existsSync(join(dir, LOGINS_PREV_REF))).toBe(false);
    expect(readVaultDataKeyPrev("logins")).toBeNull();
  });

  it("2b: install writes next then throws, key rollback throws — after restart logins are readable", () => {
    const store = new LoginStore({ dataDir: dir, now: () => 1_000 });
    store.create({ host: "accounts.example.com", username: "alice@example.com", password: PASSWORD, source: "settings", bots: "all" });
    const before = vaultDataKeyOrNull("logins")!;
    let installCalls = 0;
    const realInstall = vaultKey.installVaultDataKey;
    const installSpy = vi.spyOn(vaultKey, "installVaultDataKey").mockImplementation((purpose, key) => {
      installCalls++;
      if (installCalls === 1) {
        realInstall(purpose, key);
        throw new Error("simulated install verify failure after key write");
      }
      throw new Error("simulated key rollback failure (double fault)");
    });
    try {
      expect(() => store.rotateEncryptionKey()).toThrow(/simulated install verify failure/);
    } finally {
      installSpy.mockRestore();
    }
    expect(existsSync(join(dir, LOGINS_PREV_ENC))).toBe(true);
    expect(readVaultDataKeyPrev("logins")).toBe(before);
    const reopened = new LoginStore({ dataDir: dir });
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.usableFor("accounts.example.com", "any-bot")[0]).toMatchObject({ password: PASSWORD });
    expect(existsSync(join(dir, LOGINS_PREV_ENC))).toBe(false);
    expect(existsSync(join(dir, LOGINS_PREV_REF))).toBe(false);
    expect(readVaultDataKeyPrev("logins")).toBeNull();
  });

  it("removes the durable backup and prev key after a successful rotate", () => {
    const store = new LoginStore({ dataDir: dir, now: () => 1_000 });
    store.create({ host: "accounts.example.com", username: "alice@example.com", password: PASSWORD, source: "settings", bots: "all" });
    store.rotateEncryptionKey();
    expect(existsSync(join(dir, LOGINS_PREV_ENC))).toBe(false);
    expect(existsSync(join(dir, LOGINS_PREV_REF))).toBe(false);
    expect(readVaultDataKeyPrev("logins")).toBeNull();
    expect(readdirSync(dir)).toEqual([LOGINS_FILE]);
    expect(readdirSync(vaultDir).sort()).toEqual(["logins.key"]);
    expect(new LoginStore({ dataDir: dir }).usableFor("accounts.example.com", "any-bot")[0]).toMatchObject({ password: PASSWORD });
  });
});

describe("the held-secret scrubber", () => {
  it("masks a saved password in every form a page or a log can show it", () => {
    const store = new LoginStore({ dataDir: dir });
    store.create({ host: "example.com", username: "alice", password: PASSWORD, source: "settings", bots: "all" });
    const held = new HeldSecrets(store);
    const shown = [
      `value: ${PASSWORD}`,
      JSON.stringify({ result: PASSWORD }),
      `https://example.com/login?password=${encodeURIComponent(PASSWORD)}`,
      `<input value="${secretForms(PASSWORD)[2]}">`,
    ];
    for (const text of shown) {
      const scrubbed = held.scrub(text);
      expect(scrubbed, text).toContain("••••••");
      for (const form of secretForms(PASSWORD)) expect(scrubbed, text).not.toContain(form);
    }
    expect(held.scrub("alice signed in")).toBe("alice signed in");
  });
  it("masks a one-time code only as a whole number, and only for a few minutes", () => {
    let now = 0;
    const held = new HeldSecrets(new LoginStore({ dataDir: dir }), () => now);
    held.remember("492039", "code");
    expect(held.scrub("Code 492039 accepted")).toBe("Code •••••• accepted");
    expect(held.scrub("order 14920391")).toBe("order 14920391");
    now = 6 * 60_000;
    expect(held.scrub("Code 492039 accepted")).toBe("Code 492039 accepted");
  });

  it("masks a password filled from elsewhere for the rest of the run, and ignores values too short to be one", () => {
    const held = new HeldSecrets(new LoginStore({ dataDir: dir }));
    held.remember("fake-vault-pass", "password");
    held.remember("abc", "password");
    expect(held.scrub("x fake-vault-pass y abc")).toBe("x •••••• y abc");
  });

  it("runs inside every redaction once registered, short text included", () => {
    const store = new LoginStore({ dataDir: dir });
    store.create({ host: "example.com", username: "alice", password: "fake-hunter2", source: "settings", bots: "all" });
    const held = new HeldSecrets(store);
    const remove = addHeldSecretScrubber((text) => held.scrub(text));
    held.remember("555123", "code");
    try {
      expect(redactSecretsInText("My password is fake-hunter2, enjoy.")).toBe("My password is ••••••, enjoy.");
      expect(redactSecretsInText("555123")).toBe("••••••");
    } finally { remove(); }
    expect(redactSecretsInText("My password is fake-hunter2, enjoy.")).toBe("My password is fake-hunter2, enjoy.");
  });
});
