import { describe, it, expect } from "vitest";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { buildProxyOptions, proxyUrl } from "../../src/zalo/proxyOptions.js";

describe("proxyUrl", () => {
  it("builds an unauthenticated url", () => {
    expect(proxyUrl({ protocol: "socks5", host: "1.2.3.4", port: 1080, username: null, password: null }))
      .toBe("socks5://1.2.3.4:1080");
  });
  it("embeds url-encoded credentials", () => {
    expect(proxyUrl({ protocol: "http", host: "h", port: 8080, username: "u@x", password: "p:w/d" }))
      .toBe("http://u%40x:p%3Aw%2Fd@h:8080");
  });
});

describe("buildProxyOptions", () => {
  it("returns {} when there is no proxy", () => {
    expect(buildProxyOptions(null)).toEqual({});
  });
  it("uses a SOCKS agent + node-fetch polyfill for socks5", () => {
    const opts = buildProxyOptions({ protocol: "socks5", host: "1.2.3.4", port: 1080, username: null, password: null });
    expect(opts.agent).toBeInstanceOf(SocksProxyAgent);
    expect(typeof opts.polyfill).toBe("function");
  });
  it("uses an HTTPS agent + node-fetch polyfill for http/https", () => {
    const http = buildProxyOptions({ protocol: "http", host: "h", port: 8080, username: null, password: null });
    const https = buildProxyOptions({ protocol: "https", host: "h", port: 8443, username: null, password: null });
    expect(http.agent).toBeInstanceOf(HttpsProxyAgent);
    expect(https.agent).toBeInstanceOf(HttpsProxyAgent);
    expect(typeof http.polyfill).toBe("function");
  });
});
