import { describe, expect, it } from "vitest";
import {
  createAIKINGBOTInviteUrl,
  createInviteUrl,
  createWebAppInvitePath,
  inviteUrlFromWebAppSearch,
  inviteUseCount,
  isCanonicalInviteUrl,
  isNeverExpiringInvite,
  isPermanentInvite,
  isValidRemoteApiUrl,
  PERMANENT_INVITE_EXPIRES_AT_MS,
  parseInviteUrl,
  permanentInviteExpiresAt,
  selfHostedApiOrigin,
  toAIKINGBOTInviteUrl,
} from "./invite-links";

const payload = {
  apiUrl: "https://studio-mac-k7m4q2pz-host.aikingbot.aikingx.com/",
  serverId: "00000000-0000-4000-8000-000000000000",
  fingerprint: "a".repeat(43),
  token: "b".repeat(43),
};
const missingTokenUrl = new URL(createInviteUrl(payload));
missingTokenUrl.searchParams.delete("invite");
const localDevelopmentPayload = {
  ...payload,
  apiUrl: "http://localhost:43123/",
};
const localDevelopmentOptions = { allowLocalDevelopmentApiUrl: true };

describe("AIKINGBOT invite links", () => {
  it("creates and parses the canonical HTTPS invitation", () => {
    const url = createInviteUrl(payload);
    expect(url).toMatch(/^https:\/\/aikingbot\.aikingx\.com\/join\?/u);
    expect(parseInviteUrl(url)).toEqual(payload);
    expect(isCanonicalInviteUrl(url)).toBe(true);
    expect(isCanonicalInviteUrl(createAIKINGBOTInviteUrl(payload))).toBe(false);
  });

  it("converts a canonical invitation to the desktop fallback scheme", () => {
    expect(toAIKINGBOTInviteUrl(createInviteUrl(payload))).toBe(createAIKINGBOTInviteUrl(payload));
    expect(parseInviteUrl(createAIKINGBOTInviteUrl(payload))).toEqual(payload);
    // Windows can pass the link to AIKINGBOT with a slash before the query.
    expect(
      parseInviteUrl(createAIKINGBOTInviteUrl(payload).replace("aikingbot://join?", "aikingbot://join/?")),
    ).toEqual(payload);
  });

  it("reads an invitation from the browser client's entry and refuses any other host", () => {
    const inviteUrl = createInviteUrl(payload);
    const path = createWebAppInvitePath(inviteUrl);
    expect(path.startsWith("/app?")).toBe(true);
    expect(inviteUrlFromWebAppSearch(new URL(path, "https://aikingbot.aikingx.com").search)).toBe(inviteUrl);
    expect(inviteUrlFromWebAppSearch(`${new URL(path, "https://aikingbot.aikingx.com").search}&agent=x`)).toBe(
      inviteUrl,
    );
    expect(inviteUrlFromWebAppSearch("?agent=x")).toBeNull();

    const foreign = new URL(path, "https://aikingbot.aikingx.com");
    foreign.searchParams.set("api", "https://example.com/");
    expect(inviteUrlFromWebAppSearch(foreign.search)).toBeNull();
    const repeated = new URL(path, "https://aikingbot.aikingx.com");
    repeated.searchParams.append("invite", "c".repeat(43));
    expect(inviteUrlFromWebAppSearch(repeated.search)).toBeNull();
  });

  it("accepts approved root tunnel URLs only", () => {
    expect(isValidRemoteApiUrl("https://api.aikingbot.aikingx.com/")).toBe(true);
    expect(isValidRemoteApiUrl("https://team-host.trycloudflare.com/")).toBe(true);
    expect(isValidRemoteApiUrl(payload.apiUrl)).toBe(true);
    expect(isValidRemoteApiUrl("http://team-host.trycloudflare.com/")).toBe(false);
    expect(isValidRemoteApiUrl("https://example.com/")).toBe(false);
    expect(isValidRemoteApiUrl(`${payload.apiUrl}path`)).toBe(false);
  });

  it("accepts only the configured self-hosted account service, through the app scheme", () => {
    const selfHosted = { ...payload, apiUrl: "https://api.example.com/" };
    const options = { selfHostedApiOrigin: selfHostedApiOrigin("https://api.example.com") };

    const url = createInviteUrl(selfHosted, options);
    expect(url).toBe(createAIKINGBOTInviteUrl(selfHosted, options));
    expect(parseInviteUrl(url, options)).toEqual(selfHosted);
    expect(() => parseInviteUrl(url)).toThrow("invalid");
    expect(() => parseInviteUrl(url, { selfHostedApiOrigin: "https://other.example.com" })).toThrow("invalid");
    expect(createInviteUrl(payload, options)).toMatch(/^https:\/\/aikingbot\.aikingx\.com\/join\?/u);
  });

  it.each([
    "https://api.aikingbot.aikingx.com",
    "https://aikingbot.aikingx.com",
    "https://team-host.trycloudflare.com",
    "http://api.example.com",
    "not a url",
    undefined,
  ])("treats %s as no self-hosted account service", (apiUrl) => {
    expect(selfHostedApiOrigin(apiUrl)).toBeUndefined();
  });

  it("supports localhost invitations only when local development is explicitly enabled", () => {
    expect(() => createInviteUrl(localDevelopmentPayload)).toThrow("invalid");
    expect(isValidRemoteApiUrl(localDevelopmentPayload.apiUrl)).toBe(false);

    const url = createInviteUrl(localDevelopmentPayload, localDevelopmentOptions);
    expect(parseInviteUrl(url, localDevelopmentOptions)).toEqual(localDevelopmentPayload);
    expect(isCanonicalInviteUrl(url, localDevelopmentOptions)).toBe(true);
    expect(() => parseInviteUrl(url)).toThrow("invalid");
    expect(isValidRemoteApiUrl(localDevelopmentPayload.apiUrl, localDevelopmentOptions)).toBe(true);
  });

  it.each(["http://localhost/", "https://localhost:43123/", "http://127.0.0.1:43123/", "http://localhost:43123/path"])(
    "rejects an unsafe local development API URL: %s",
    (apiUrl) => {
      expect(isValidRemoteApiUrl(apiUrl, localDevelopmentOptions)).toBe(false);
    },
  );

  it.each([
    "https://evil.example/join",
    "https://aikingbot.aikingx.com/other",
    "https://aikingbot.aikingx.com/join/",
    "https://aikingbot.aikingx.com:444/join",
    "https://user@aikingbot.aikingx.com/join",
    missingTokenUrl.toString(),
    `${createInviteUrl(payload)}#fragment`,
    `${createInviteUrl(payload)}&extra=value`,
    `${createInviteUrl(payload)}&invite=duplicate`,
  ])("rejects an invalid invitation: %s", (value) => {
    expect(() => parseInviteUrl(value)).toThrow("invalid");
  });

  it("marks the permanent deadline as never expiring", () => {
    expect(isNeverExpiringInvite(permanentInviteExpiresAt())).toBe(true);
    expect(isNeverExpiringInvite(new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString())).toBe(false);
    expect(isNeverExpiringInvite("not-a-date")).toBe(false);
  });

  it("decodes an invitation without the permanent flag or a valid count as an older sender meant it", () => {
    const tomorrow = Date.now() + 24 * 60 * 60 * 1_000;
    expect(isPermanentInvite(undefined, PERMANENT_INVITE_EXPIRES_AT_MS)).toBe(true);
    expect(isPermanentInvite(undefined, permanentInviteExpiresAt())).toBe(true);
    expect(isPermanentInvite(true, tomorrow)).toBe(true);
    expect(isPermanentInvite(false, tomorrow)).toBe(false);
    expect(isPermanentInvite(undefined, new Date(tomorrow).toISOString())).toBe(false);
    expect([undefined, -1, 1.5, "2"].map(inviteUseCount)).toEqual([0, 0, 0, 0]);
    expect(inviteUseCount(3)).toBe(3);
  });
});
