import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { verifyMac, computeMac } from "../../src/zalo-oa/verify.js";

describe("verifyMac", () => {
  const oaSecretKey = "OASECRET";
  const appId = "APP";
  const data = '{"event_name":"user_send_text"}';
  const ts = "1700000000";
  const good = createHash("sha256").update(appId + data + ts + oaSecretKey).digest("hex");

  it("accepts a correct mac", () => {
    expect(verifyMac({ appId, data, timestamp: ts, mac: good }, oaSecretKey)).toBe(true);
  });
  it("rejects a tampered mac", () => {
    expect(verifyMac({ appId, data, timestamp: ts, mac: "deadbeef" }, oaSecretKey)).toBe(false);
  });
  it("rejects an empty mac", () => {
    expect(verifyMac({ appId, data, timestamp: ts, mac: "" }, oaSecretKey)).toBe(false);
  });
  it("computeMac matches the reference SHA256(appId+data+ts+oaSecretKey)", () => {
    expect(computeMac(appId, data, ts, oaSecretKey)).toBe(good);
  });
});
