import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ session: { defaultSession: { webRequest: { onBeforeRequest: vi.fn() } } } }));

import { guardFetch, HostedServiceDisabledError, hostedServicesEnabled, isHostedServiceUrl } from "./hosted-services";

describe("hosted services guard", () => {
  it("recognizes the hosted origins and their subdomains only", () => {
    expect(isHostedServiceUrl("https://api.aikingbot.aikingx.com/v1/me")).toBe(true);
    expect(isHostedServiceUrl("wss://signal.aikingbot.aikingx.com/v1/signal")).toBe(true);
    expect(isHostedServiceUrl("https://aikingbot.aikingx.com/join")).toBe(true);
    expect(isHostedServiceUrl("https://launch.aikingbot-sites.aikingx.com/")).toBe(true);
    expect(isHostedServiceUrl("https://aikingx.com/")).toBe(false);
    expect(isHostedServiceUrl("https://evil-aikingbot.aikingx.com.example/")).toBe(false);
    expect(isHostedServiceUrl("http://127.0.0.1:3100/")).toBe(false);
    expect(isHostedServiceUrl("https://api.openai.com/v1/models")).toBe(false);
    expect(isHostedServiceUrl("not a url")).toBe(false);
  });

  it("rejects a hosted request without sending it and passes every other request through", async () => {
    const send = vi.fn<typeof fetch>(async () => new Response("ok"));
    const guarded = guardFetch(send);

    await expect(guarded("https://api.aikingbot.aikingx.com/v1/me")).rejects.toBeInstanceOf(HostedServiceDisabledError);
    await expect(guarded(new URL("https://analytics.aikingbot.aikingx.com/api/track"))).rejects.toThrow(
      "local-only mode",
    );
    expect(send).not.toHaveBeenCalled();

    await expect(guarded("https://api.anthropic.com/v1/messages")).resolves.toBeInstanceOf(Response);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stays on unless the hosted services are explicitly enabled", () => {
    expect(hostedServicesEnabled({})).toBe(false);
    expect(hostedServicesEnabled({ AIKINGBOT_HOSTED_SERVICES: "true" })).toBe(false);
    expect(hostedServicesEnabled({ AIKINGBOT_HOSTED_SERVICES: "1" })).toBe(true);
  });
});
