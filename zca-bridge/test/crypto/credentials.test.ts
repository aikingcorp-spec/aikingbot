import { describe, it, expect } from "vitest";
import { encryptCredentials, decryptCredentials } from "../../src/crypto/credentials.js";

const key = Buffer.alloc(32, 7); // deterministic 32-byte key for tests

describe("credential encryption", () => {
  it("round-trips an object", () => {
    const creds = { imei: "abc", userAgent: "UA", cookie: [{ name: "x", value: "y" }] };
    const blob = encryptCredentials(creds, key);
    expect(typeof blob).toBe("string");
    expect(blob).not.toContain("abc"); // ciphertext, not plaintext
    expect(decryptCredentials(blob, key)).toEqual(creds);
  });

  it("fails to decrypt with the wrong key", () => {
    const blob = encryptCredentials({ a: 1 }, key);
    const wrong = Buffer.alloc(32, 9);
    expect(() => decryptCredentials(blob, wrong)).toThrow();
  });

  it("produces different ciphertext each call (random IV)", () => {
    const a = encryptCredentials({ a: 1 }, key);
    const b = encryptCredentials({ a: 1 }, key);
    expect(a).not.toBe(b);
  });
});
