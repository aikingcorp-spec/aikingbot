import { describe, expect, it } from "vitest";
import { applyWorkspaceClientState, collectWorkspaceClientState } from "./workspace-backup-client";
import { SEND_KEY_KEY } from "./send-key";

function memory(values: Record<string, string>) {
  const entries = new Map(Object.entries(values));
  return { entries, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}

describe("full-backup browser state", () => {
  it("exports exact app drafts/preferences, never saved webhook credentials or auth/cache keys", () => {
    const storage = memory({ "aiking-drafts": "draft", "aiking-webhook-credentials": "private URL", "aiking-skin": "daylight", "auth-token": "secret", "aiking-connected-apps": "cached accounts", "aiking-email-gate": "identity", "aiking-pending-workspace-restore": "old" });
    expect(collectWorkspaceClientState(storage)).toEqual({ "aiking-drafts": "draft", "aiking-skin": "daylight" });
  });

  it("replaces only allowlisted keys and clears old drafts absent from the backup", () => {
    const storage = memory({ "aiking-drafts": "old", "aiking-draft-attachments": "old attachment", "auth-token": "keep", "aiking-webhook-credentials": "destination URL" });
    applyWorkspaceClientState({ "aiking-drafts": "restored", "aiking-show-threads": "false" }, storage);
    expect(Object.fromEntries(storage.entries)).toEqual({ "aiking-drafts": "restored", "aiking-show-threads": "false", "auth-token": "keep", "aiking-webhook-credentials": "destination URL" });
  });

  it("carries the run card visibility choice in a workspace backup", () => {
    const storage = memory({ "aiking-show-run-card": "0" });
    expect(collectWorkspaceClientState(storage)).toEqual({ "aiking-show-run-card": "0" });
    applyWorkspaceClientState({ "aiking-show-run-card": "1" }, storage);
    expect(storage.getItem("aiking-show-run-card")).toBe("1");
  });

  it("carries the send key choice in a workspace backup", () => {
    const storage = memory({ [SEND_KEY_KEY]: "mod-enter" });
    expect(collectWorkspaceClientState(storage)).toEqual({ "aiking-send-key": "mod-enter" });
    applyWorkspaceClientState({ "aiking-send-key": "enter" }, storage);
    expect(storage.getItem(SEND_KEY_KEY)).toBe("enter");
  });

  it("carries the message color choice and leaves older backups opted out", () => {
    const storage = memory({ "aiking-color-user-bubbles": "1" });
    expect(collectWorkspaceClientState(storage)).toEqual({ "aiking-color-user-bubbles": "1" });
    applyWorkspaceClientState({ "aiking-color-user-bubbles": "0" }, storage);
    expect(storage.getItem("aiking-color-user-bubbles")).toBe("0");
    applyWorkspaceClientState({}, storage);
    expect(storage.getItem("aiking-color-user-bubbles")).toBeNull();
  });

  it.each([null, [], { "auth-token": "injected" }, { "aiking-webhook-credentials": "source URL" }, { "aiking-drafts": 1 }])("rejects invalid client state before clearing anything (%j)", (value) => {
    const storage = memory({ "aiking-drafts": "old", "auth-token": "keep" });
    expect(() => applyWorkspaceClientState(value, storage)).toThrow("Invalid backup browser state");
    expect(Object.fromEntries(storage.entries)).toEqual({ "aiking-drafts": "old", "auth-token": "keep" });
  });

  it("rolls browser state back if restored values exceed storage quota", () => {
    const storage = memory({ "aiking-drafts": "old", "aiking-skin": "daylight", "auth-token": "keep" });
    const original = storage.setItem;
    storage.setItem = (key, value) => { if (value === "too large") throw new Error("quota"); original(key, value); };
    expect(() => applyWorkspaceClientState({ "aiking-drafts": "too large" }, storage)).toThrow("quota");
    expect(Object.fromEntries(storage.entries)).toEqual({ "aiking-drafts": "old", "aiking-skin": "daylight", "auth-token": "keep" });
  });
});
