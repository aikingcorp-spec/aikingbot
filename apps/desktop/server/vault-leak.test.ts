import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { addHeldSecretScrubber, redactSecretsInText } from "../shared/redact.ts";
import { HeldSecrets, LOGINS_PREV_ENC, LOGINS_PREV_REF, LoginStore } from "./login-store.ts";
import { CustomSecretStore } from "./secret-refs.ts";
import { readVaultDataKeyPrev, resetVaultKeyIoForTests } from "./vault-key.ts";

const SENTINEL = "leak-sentinel-VAULT-9f3c2a1b-never-in-logs";

describe("vault leak guard", () => {
  let dir: string;
  let vaultDir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vault-leak-"));
    vaultDir = mkdtempSync(join(tmpdir(), "vault-leak-keys-"));
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

  it("never leaves a seeded login password in redacted chat or log text", () => {
    const store = new LoginStore({ dataDir: dir });
    store.create({ host: "example.test", username: "bot", password: SENTINEL, source: "settings", bots: "all" });
    const held = new HeldSecrets(store);
    addHeldSecretScrubber((text) => held.scrub(text));
    const chat = `I saved the password ${SENTINEL} for you`;
    const log = `decrypt failed near ${SENTINEL} while opening logins`;
    expect(redactSecretsInText(chat)).not.toContain(SENTINEL);
    expect(redactSecretsInText(log)).not.toContain(SENTINEL);
    expect(JSON.stringify(store.list())).not.toContain(SENTINEL);
  });

  it("never parks raw vault key material next to the data dir across rotate", () => {
    const store = new LoginStore({ dataDir: dir });
    store.create({ host: "example.test", username: "bot", password: SENTINEL, source: "settings", bots: "all" });
    store.rotateEncryptionKey();
    expect(existsSync(join(dir, LOGINS_PREV_ENC))).toBe(false);
    expect(existsSync(join(dir, LOGINS_PREV_REF))).toBe(false);
    expect(readVaultDataKeyPrev("logins")).toBeNull();
    for (const name of readdirSync(dir)) {
      expect(name.endsWith(".key")).toBe(false);
      expect(name).not.toBe("logins-key");
      const body = readFileSync(join(dir, name));
      expect(body.includes(Buffer.from(SENTINEL))).toBe(false);
      expect(body.toString("utf8")).not.toMatch(/^[0-9a-f]{64}$/m);
    }
  });

  it("never leaves a custom vault secret in redacted chat or log text", () => {
    const customs = new CustomSecretStore({ dataDir: dir });
    customs.put("zapier_hook", SENTINEL);
    const held = new HeldSecrets({
      get version() { return customs.version; },
      secretValues: () => customs.secretValues(),
    });
    addHeldSecretScrubber((text) => held.scrub(text));
    expect(redactSecretsInText(`webhook token ${SENTINEL} saved`)).not.toContain(SENTINEL);
    expect(JSON.stringify(customs.list())).not.toContain(SENTINEL);
  });
});
