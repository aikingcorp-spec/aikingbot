import { describe, expect, it } from "vitest";

import {
  CREDENTIAL_TARGETS,
  FIXED_CREDENTIAL_TARGET_IDS,
  credentialConfigPatch,
  credentialGateTarget,
  credentialIsConfigured,
  credentialResumeOutcome,
  isCustomCredentialName,
  isPendingCredentialRequest,
  isCredentialTargetId,
  parseCustomCredentialLabel,
  type CredentialConfig,
  type CredentialTargetId,
} from "../shared/credential-request.ts";

const MAPPINGS: Array<[CredentialTargetId, CredentialConfig]> = [
  ["xaiApiKey", { xai: { key: "secret" } }],
  ["boxToken", { box: { token: "secret" } }],
  ["opencodeGoApiKey", { opencodeGo: { apiKey: "secret" } }],
  ["ttsKey", { tts: { key: "secret" } }],
  ["fishAudioKey", { tts: { fishKey: "secret" } }],
  ["openaiImageApiKey", { imageGen: { key: "secret" } }],
];

describe("credential request allowlist", () => {
  it("accepts only declared own ids", () => {
    expect(isCredentialTargetId("xaiApiKey")).toBe(true);
    expect(isCredentialTargetId("composioApiKey")).toBe(false);
    expect(isCredentialTargetId("__proto__")).toBe(false);
    expect(isCredentialTargetId({ toString: () => "xaiApiKey" })).toBe(false);
  });

  it("maps each fixed id to a fixed config location", () => {
    expect(MAPPINGS.map(([id]) => id).sort()).toEqual([...FIXED_CREDENTIAL_TARGET_IDS].sort());
    for (const [id, patch] of MAPPINGS) {
      expect(credentialConfigPatch(id, "secret")).toEqual(patch);
      expect(credentialIsConfigured(patch, id)).toBe(true);
      expect(credentialIsConfigured({}, id)).toBe(false);
    }
    expect(() => credentialConfigPatch("custom", "secret")).toThrow(/vault/i);
    expect(credentialIsConfigured({}, "custom")).toBe(false);
  });

  it("checks configured state without exposing values", () => {
    expect(credentialIsConfigured({ tts: { key: "secret" } }, "ttsKey")).toBe(true);
    expect(credentialIsConfigured({ tts: { key: "" } }, "ttsKey")).toBe(false);
    expect(credentialIsConfigured({ tts: { fishKey: "secret" } }, "fishAudioKey")).toBe(true);
    expect(credentialIsConfigured({ tts: { fishKey: "" } }, "fishAudioKey")).toBe(false);
    expect(FIXED_CREDENTIAL_TARGET_IDS).toHaveLength(6);
    expect(Object.keys(CREDENTIAL_TARGETS)).toHaveLength(7);
    expect(isCredentialTargetId("custom")).toBe(true);
  });

  // The key becomes OPENCODE_API_KEY, which only OpenCode Zen and Go read: the
  // card must not promise other providers a key it never reaches.
  it("says the OpenCode key is for Zen and Go only", () => {
    expect(CREDENTIAL_TARGETS.opencodeGoApiKey.description).toBe("Used for OpenCode Zen and Go.");
  });

  it("supersedes open room cards only for the bot that requested them", () => {
    const card = {
      kind: "secret",
      secret: { target: "xaiApiKey" },
      from: { botId: "atlas" },
    };
    expect(isPendingCredentialRequest(card, "xaiApiKey", "atlas", true)).toBe(true);
    expect(isPendingCredentialRequest(card, "xaiApiKey", "pixel", true)).toBe(false);
    expect(isPendingCredentialRequest(card, "xaiApiKey", "pixel", false)).toBe(true);
    expect(isPendingCredentialRequest({ ...card, secret: { ...card.secret, provided: true } }, "xaiApiKey", "atlas", true)).toBe(false);
    expect(isPendingCredentialRequest({ ...card, secret: { ...card.secret, dismissed: true } }, "xaiApiKey", "atlas", true)).toBe(false);
    expect(isPendingCredentialRequest({ ...card, secret: { ...card.secret, superseded: true } }, "xaiApiKey", "atlas", true)).toBe(false);
  });

  it("preserves the original save or decline outcome when retrying", () => {
    expect(credentialResumeOutcome({ provided: true })).toBe("provided");
    expect(credentialResumeOutcome({ dismissed: true })).toBe("dismissed");
    expect(credentialResumeOutcome({})).toBeNull();
    expect(credentialResumeOutcome({ provided: true, dismissed: true })).toBeNull();
  });

  it("validates custom credential name and label", () => {
    expect(isCustomCredentialName("zapier_webhook")).toBe(true);
    expect(isCustomCredentialName("Bad Name")).toBe(false);
    expect(isCustomCredentialName("")).toBe(false);
    expect(isCustomCredentialName("a".repeat(41))).toBe(false);
    expect(parseCustomCredentialLabel("  Zapier key  ")).toBe("Zapier key");
    expect(parseCustomCredentialLabel("")).toBeNull();
    expect(parseCustomCredentialLabel("x".repeat(80))!.length).toBe(60);
    expect(credentialGateTarget("custom", "zapier")).toBe("custom/zapier");
    expect(credentialGateTarget("xaiApiKey")).toBe("xaiApiKey");
  });

  it("supersedes custom cards only for the same name", () => {
    const card = {
      kind: "secret",
      secret: { target: "custom" as const, customName: "zapier" },
      from: { botId: "atlas" },
    };
    expect(isPendingCredentialRequest(card, "custom", "atlas", true, "zapier")).toBe(true);
    expect(isPendingCredentialRequest(card, "custom", "atlas", true, "other")).toBe(false);
  });
});
