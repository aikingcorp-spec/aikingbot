import { createAIKINGBOTInviteUrl, createInviteUrl } from "@aikingbot/contracts/invite-links";
import { createMobileConnectUrl } from "@aikingbot/contracts/mobile-connect";
import { describe, expect, it } from "vitest";
import {
  forgetIncomingLink,
  parseIncomingLink,
  pendingSignInLinkId,
  readIncomingLink,
  redirectIncomingLink,
} from "./incoming-links";

const payload = {
  apiUrl: "https://api.aikingbot.aikingx.com",
  serverId: "11111111-1111-4111-8111-111111111111",
  fingerprint: "f".repeat(43),
  token: "t".repeat(32),
};

const templateId = "AbCdEfGhIjKlMnOpQrSt_-";

function requestId(path: string): string {
  return new URL(path, "https://aikingbot.aikingx.com").searchParams.get("request") ?? "";
}

describe("incoming mobile links", () => {
  it.each([createInviteUrl(payload), createAIKINGBOTInviteUrl(payload)])(
    "keeps invitation secrets out of the route",
    (url) => {
      const path = redirectIncomingLink(url);
      expect(path).toMatch(/^\/incoming-link\?request=\d+$/u);
      expect(path).not.toContain(payload.token);
      const id = requestId(path);
      expect(readIncomingLink(id)).toEqual({ kind: "invite", url });
      expect(pendingSignInLinkId()).toBe(id);
      forgetIncomingLink(id);
      expect(readIncomingLink(id)).toEqual({ kind: "invalid" });
    },
  );

  it("retains an invitation while a Mobile Connect link starts sign-in", () => {
    const id = requestId(redirectIncomingLink(createInviteUrl(payload)));
    const url = createMobileConnectUrl({
      apiUrl: payload.apiUrl,
      ticket: "c".repeat(32),
      host: { hostId: payload.serverId, fingerprint: payload.fingerprint },
    });
    const pairingId = requestId(redirectIncomingLink(url));
    expect(readIncomingLink(pairingId)).toEqual({ kind: "pairing", url });
    forgetIncomingLink(pairingId);
    expect(pendingSignInLinkId()).toBe(id);
    forgetIncomingLink(id);
  });

  it("opens only a validated plugin page", () => {
    expect(parseIncomingLink("aikingbot://plugins/my-plugin")).toEqual({
      kind: "plugin",
      url: "https://aikingbot.aikingx.com/plugins/my-plugin",
    });
    expect(parseIncomingLink("https://aikingbot.aikingx.com/plugins/my-plugin")).toEqual({
      kind: "plugin",
      url: "https://aikingbot.aikingx.com/plugins/my-plugin",
    });
  });

  it.each([
    `aikingbot://agents/${templateId}`,
    `https://aikingbot.aikingx.com/agents/${templateId}`,
    `/agents/${templateId}`,
  ])("routes an agent link in each form to one preview request", (url) => {
    const id = requestId(redirectIncomingLink(url));
    expect(readIncomingLink(id)).toEqual({
      kind: "template",
      url: `https://aikingbot.aikingx.com/agents/${templateId}`,
      templateId,
    });
    expect(pendingSignInLinkId()).toBe(id);
    forgetIncomingLink(id);
  });

  it.each([
    `aikingbot://agents/${templateId}?install=1`,
    `https://aikingbot.aikingx.com/agents/${templateId}#install`,
    `https://aikingbot.aikingx.com.evil.test/agents/${templateId}`,
    `https://aikingbot.aikingx.com/agents/${templateId}/extra`,
    "aikingbot://agents/short",
    `aikingbot://user:pass@agents/${templateId}`,
    `/agents/${templateId}?install=1`,
  ])("rejects a malformed agent link: %s", (url) => {
    expect(readIncomingLink(requestId(redirectIncomingLink(url)))).toEqual({ kind: "invalid" });
  });

  it("routes a self-hosted invitation only through the app scheme", () => {
    const selfHosted = { ...payload, apiUrl: "https://api.example.com/" };
    const options = { selfHostedApiOrigin: "https://api.example.com" };
    const url = createAIKINGBOTInviteUrl(selfHosted, options);
    expect(parseIncomingLink(url)).toEqual({ kind: "invite", url });
    expect(parseIncomingLink(url.replace("aikingbot://join", "https://aikingbot.aikingx.com/join"))).toEqual({
      kind: "invalid",
    });
  });

  it.each([
    "aikingbot://join?invite=bad",
    "https://aikingbot.aikingx.com.evil.test/join",
    "aikingbot://plugins/my-plugin?install=1",
    "aikingbot://mcp-auth?code=secret&state=secret",
    "not a URL",
    `aikingbot://user:pass@mobile-connect?api=https://api.aikingbot.aikingx.com&ticket=${"c".repeat(32)}`,
  ])("rejects unsupported and invalid links without retaining their secrets", (url) => {
    expect(parseIncomingLink(url)).toEqual({ kind: "invalid" });
  });

  it("handles a relative invitation but keeps ordinary internal routes", () => {
    const url = createInviteUrl(payload);
    const path = redirectIncomingLink(url.replace("https://aikingbot.aikingx.com", ""));
    expect(readIncomingLink(requestId(path))).toEqual({ kind: "invite", url });
    forgetIncomingLink(requestId(path));
    expect(redirectIncomingLink("/connected")).toBe("/connected");
    expect(redirectIncomingLink("exp://localhost:8081/--/connected")).toBe("exp://localhost:8081/--/connected");
  });

  it("coalesces repeated delivery without copying the bearer token into navigation", () => {
    const first = redirectIncomingLink(createInviteUrl(payload));
    expect(redirectIncomingLink(createInviteUrl(payload))).toBe(first);
    forgetIncomingLink(requestId(first));
    expect(redirectIncomingLink("aikingbot://")).toBe("/");
  });

  it("bounds retained links and rejects evicted requests", () => {
    const first = requestId(redirectIncomingLink(createInviteUrl(payload)));
    const ids = Array.from({ length: 8 }, (_, index) =>
      requestId(redirectIncomingLink(createInviteUrl({ ...payload, token: String(index).repeat(32) }))),
    );
    expect(readIncomingLink(first)).toEqual({ kind: "invalid" });
    for (const id of ids) forgetIncomingLink(id);
  });
});
