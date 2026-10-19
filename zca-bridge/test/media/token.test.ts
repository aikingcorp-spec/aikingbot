import { describe, it, expect } from "vitest";
import { signMediaToken, verifyMediaToken } from "../../src/media/token.js";

const SECRET = "test-secret-key";

describe("media token", () => {
  it("round-trips a key through sign/verify", () => {
    const token = signMediaToken("1/user_84900/m1_x.jpg", SECRET);
    expect(verifyMediaToken(token, SECRET)).toEqual({ ok: true, key: "1/user_84900/m1_x.jpg" });
  });

  it("rejects a tampered token", () => {
    const token = signMediaToken("1/a/b.jpg", SECRET);
    expect(verifyMediaToken(token + "x", SECRET)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a token signed with a different secret", () => {
    const token = signMediaToken("1/a/b.jpg", SECRET);
    expect(verifyMediaToken(token, "other-secret")).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a malformed token with no separator", () => {
    expect(verifyMediaToken("garbage", SECRET)).toEqual({ ok: false, reason: "invalid" });
  });

  it("treats ttlDays=0 as never expiring", () => {
    const token = signMediaToken("k", SECRET, 0, 1_000);
    expect(verifyMediaToken(token, SECRET, 999_999_999_999)).toEqual({ ok: true, key: "k" });
  });

  it("expires a token past its ttl", () => {
    const issuedAt = 1_000;
    const token = signMediaToken("k", SECRET, 1, issuedAt); // +1 day
    const afterExpiry = issuedAt + 2 * 86_400_000;
    expect(verifyMediaToken(token, SECRET, afterExpiry)).toEqual({ ok: false, reason: "expired" });
  });
});
