import { describe, it, expect } from "vitest";
import {
  hashPassword, verifyPassword, deriveSessionSecret,
  signSession, verifySession, parseCookie,
} from "../../src/admin/auth.js";

describe("auth password", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const { hash, salt } = hashPassword("hunter2pw");
    expect(verifyPassword("hunter2pw", salt, hash)).toBe(true);
    expect(verifyPassword("wrong", salt, hash)).toBe(false);
  });
});

describe("auth session", () => {
  const secret = deriveSessionSecret(Buffer.alloc(32, 1));
  it("signs and verifies a session", () => {
    const sid = signSession("admin", secret, 1000);
    expect(verifySession(`sid=${sid}`, secret, 2000)?.username).toBe("admin");
  });
  it("rejects an expired session", () => {
    const sid = signSession("admin", secret, 1000);
    expect(verifySession(`sid=${sid}`, secret, 1000 + 8 * 86_400_000)).toBeNull();
  });
  it("rejects a tampered signature", () => {
    const sid = signSession("admin", secret, 1000);
    const bad = sid.slice(0, -1) + (sid.at(-1) === "A" ? "B" : "A");
    expect(verifySession(`sid=${bad}`, secret, 2000)).toBeNull();
  });
  it("returns null with no cookie", () => {
    expect(verifySession(undefined, secret)).toBeNull();
  });
  it("returns null (does not throw) on a malformed percent-encoded cookie", () => {
    expect(verifySession("sid=%gg", secret, 2000)).toBeNull();
  });
});

describe("parseCookie", () => {
  it("parses multiple cookies", () => {
    expect(parseCookie("a=1; sid=xyz")).toEqual({ a: "1", sid: "xyz" });
  });
  it("keeps a value with malformed percent-encoding instead of throwing", () => {
    expect(parseCookie("sid=%gg")).toEqual({ sid: "%gg" });
  });
});
