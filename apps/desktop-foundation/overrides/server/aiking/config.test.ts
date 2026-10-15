// Copyright (c) 2026 AIKING.
import { describe, expect, it } from "vitest";
import { instanceConfigs, persistableInstanceConfigs, type AppConfig } from "../config.ts";

describe("Core credential routing", () => {
  it("exposes the real Core engine and injects the saved Anthropic key without freezing it in instance config", () => {
    const cfg: AppConfig = { anthropic: { key: "shared-fixture-key", everyClaudeBot: false } };
    expect(instanceConfigs(cfg).aikingCore?.driver).toBe("aiking-core");
    expect(instanceConfigs(cfg).aikingCore?.environment?.ANTHROPIC_API_KEY).toBe("shared-fixture-key");
    expect(persistableInstanceConfigs(cfg).aikingCore?.environment).toBeUndefined();
  });
  it("never sends the workspace key to a Core instance with its own endpoint or key", () => {
    const cfg: AppConfig = { anthropic: { key: "workspace-fixture-key" }, instances: { customCore: { driver: "aiking-core", environment: { ANTHROPIC_BASE_URL: "https://separate.example" } } } };
    expect(instanceConfigs(cfg).customCore?.environment?.ANTHROPIC_API_KEY).toBeUndefined();
    cfg.instances!.customCore!.environment!.ANTHROPIC_API_KEY = "account-fixture-key";
    expect(instanceConfigs(cfg).customCore?.environment?.ANTHROPIC_API_KEY).toBe("account-fixture-key");
  });
});
