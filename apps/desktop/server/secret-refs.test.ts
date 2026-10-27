import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetVaultKeyIoForTests } from "./vault-key.ts";
import {
  CustomSecretStore,
  formatCustomSecretRef,
  parseSecretRef,
  resolveSecretRefsInRecord,
} from "./secret-refs.ts";

const SENTINEL = "custom-leak-sentinel-NEVER-IN-LOGS-9f3c";

describe("secret-refs custom vault", () => {
  let dir: string;
  let vaultDir: string;
  let store: CustomSecretStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "custom-secrets-"));
    vaultDir = mkdtempSync(join(tmpdir(), "custom-secrets-vault-"));
    resetVaultKeyIoForTests();
    process.env.AIKING_VAULT_DIR = vaultDir;
    process.env.AIKING_VAULT_BACKEND = "fallback";
    store = new CustomSecretStore({ dataDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(vaultDir, { recursive: true, force: true });
    resetVaultKeyIoForTests();
    delete process.env.AIKING_VAULT_DIR;
    delete process.env.AIKING_VAULT_BACKEND;
  });

  it("refuses a bad name and stores a good one without echoing the value", () => {
    expect(() => store.put("Bad Name", SENTINEL)).toThrow(/invalid/i);
    const { ref } = store.put("zapier_webhook", SENTINEL);
    expect(ref).toBe("secret:custom/zapier_webhook");
    expect(store.has("zapier_webhook")).toBe(true);
    expect(store.get("zapier_webhook")).toBe(SENTINEL);
    expect(JSON.stringify(store.list())).not.toContain(SENTINEL);
    expect(parseSecretRef(ref)).toEqual({ kind: "custom", name: "zapier_webhook" });
    expect(parseSecretRef("secret:custom/../x")).toBeNull();
    expect(formatCustomSecretRef("zapier_webhook")).toBe(ref);
  });

  it("resolves refs in records and fails closed on missing", () => {
    store.put("hook", SENTINEL);
    const ok = resolveSecretRefsInRecord(store, {
      Authorization: "secret:custom/hook",
      plain: "ok",
    });
    expect(ok).toEqual({ ok: true, values: { Authorization: SENTINEL, plain: "ok" } });
    const missing = resolveSecretRefsInRecord(store, { Authorization: "secret:custom/missing" });
    expect(missing.ok).toBe(false);
  });

  it("revokes by name and never leaves the sentinel in listed metadata", () => {
    store.put("hook", SENTINEL);
    expect(store.remove("hook")).toBe(true);
    expect(store.has("hook")).toBe(false);
    expect(store.resolve("secret:custom/hook")).toBeNull();
  });
});
