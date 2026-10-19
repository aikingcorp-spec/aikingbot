import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config/env.js";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/zca",
  CHATWOOT_BASE_URL: "http://chatwoot:3000",
  CREDENTIALS_KEY: "0".repeat(64), // 32 bytes hex
  PORT: "4000",
};

describe("loadConfig", () => {
  it("parses a valid environment", () => {
    const cfg = loadConfig(base);
    expect(cfg.chatwootBaseUrl).toBe("http://chatwoot:3000");
    expect(cfg.port).toBe(4000);
    expect(cfg.credentialsKey).toHaveLength(32); // decoded to Buffer of 32 bytes
  });

  it("throws when a required var is missing", () => {
    const { DATABASE_URL, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/);
  });

  it("throws when CREDENTIALS_KEY is not 32 bytes hex", () => {
    expect(() => loadConfig({ ...base, CREDENTIALS_KEY: "abcd" })).toThrow(/CREDENTIALS_KEY/);
  });

  it("parses WEBHOOK_SECRET when present", () => {
    const cfg = loadConfig({ ...base, WEBHOOK_SECRET: "my-secret" });
    expect(cfg.webhookSecret).toBe("my-secret");
  });

  it("defaults webhookSecret to null when absent", () => {
    const cfg = loadConfig(base);
    expect(cfg.webhookSecret).toBeNull();
  });

  it("defaults mediaArchiveRoot, mediaTokenTtlDays, and maxAttachmentBytes when absent", () => {
    const cfg = loadConfig(base);
    expect(cfg.mediaArchiveRoot).toBe("/archive");
    expect(cfg.mediaTokenTtlDays).toBe(0);
    expect(cfg.maxAttachmentBytes).toBe(40 * 1024 * 1024);
  });

  it("parses cfg.oa when all three OA vars are present", () => {
    const cfg = loadConfig({
      ...base,
      ZALO_OA_APP_ID: "123456",
      ZALO_OA_APP_SECRET: "mysecret",
      ZALO_OA_OAUTH_REDIRECT: "https://bridge.example.com/oa/oauth/callback",
    });
    expect(cfg.oa).toEqual({
      appId: "123456",
      appSecret: "mysecret",
      redirectUri: "https://bridge.example.com/oa/oauth/callback",
    });
  });

  it("leaves cfg.oa undefined when OA vars are not configured", () => {
    const cfg = loadConfig(base);
    expect(cfg.oa).toBeUndefined();
  });
});
