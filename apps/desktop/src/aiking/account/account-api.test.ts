// Copyright (c) 2026 AIKING.
import { describe, expect, it } from "vitest";
import { setLocale } from "../../lib/i18n";
import { lastSeenText, readAccountState } from "./account-api";

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

describe("account state in the browser", () => {
  it("is null without an account session or with a malformed answer", async () => {
    expect(await readAccountState(reply(401, { error: "sign in" }))).toBeNull();
    expect(await readAccountState(reply(200, { account: {} }))).toBeNull();
    expect(await readAccountState((async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
  });
  it("reads the server's workspace and computer lists as given", async () => {
    const state = { account: { email: "a@example.test" }, workspaces: [], devices: [], hostedComputers: "not-offered" };
    expect(await readAccountState(reply(200, state))).toEqual(state);
  });
  it("describes computer status", () => {
    const now = 10_000_000;
    expect(lastSeenText({ online: true, lastSeenAt: now }, now)).toBe("Online");
    expect(lastSeenText({ online: false, lastSeenAt: now - 5 * 60_000 }, now)).toBe("Offline · seen 5 min ago");
    expect(lastSeenText({ online: false, lastSeenAt: now - 3 * 3_600_000 }, now)).toBe("Offline · seen 3 h ago");
  });
});

it("localizes linked-computer status without changing the saved account", () => {
  try {
    setLocale("vi");
    expect(lastSeenText({ online: true, lastSeenAt: 0 }, 300000)).toBe("Trực tuyến");
    expect(lastSeenText({ online: false, lastSeenAt: 0 }, 300000)).toBe("Ngoại tuyến · hoạt động 5 phút trước");
  } finally { setLocale("en"); }
});
