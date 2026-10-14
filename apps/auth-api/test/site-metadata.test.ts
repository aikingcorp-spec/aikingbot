import { describe, expect, it } from "vitest";
import { AIKINGBOT_SECURITY_HEADERS, AIKINGBOT_SITE_URL, siteUrlForPage } from "../src/lib/site-metadata";

describe("site metadata", () => {
  it("defines production security headers", () => {
    expect(AIKINGBOT_SECURITY_HEADERS).toEqual({
      "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    });
  });

  it("names aikingbot.aikingx.com on a production host and the serving site on any other", () => {
    expect(siteUrlForPage(new URL("https://aikingbot.aikingx.com/guides/a-guide"))).toBe(AIKINGBOT_SITE_URL);
    expect(siteUrlForPage(new URL("https://api.aikingbot.aikingx.com/guides/a-guide"))).toBe(AIKINGBOT_SITE_URL);
    expect(siteUrlForPage(new URL("https://pr-451-aikingbot-landing-preview.example.workers.dev/guides/a-guide"))).toBe(
      "https://pr-451-aikingbot-landing-preview.example.workers.dev/",
    );
  });
});
