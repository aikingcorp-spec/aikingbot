import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encodeTokenBlob, decodeTokenBlob } from "../../src/store/oaTokenRepo.js";

describe("oa token blob", () => {
  const key = randomBytes(32);
  it("round-trips encrypted access+refresh tokens", () => {
    const blob = encodeTokenBlob({ accessToken: "AT", refreshToken: "RT" }, key);
    expect(blob).not.toContain("AT");
    expect(decodeTokenBlob(blob, key)).toEqual({ accessToken: "AT", refreshToken: "RT" });
  });
});
