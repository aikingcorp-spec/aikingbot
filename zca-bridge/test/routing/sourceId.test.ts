import { describe, it, expect } from "vitest";
import { encodeSourceId, decodeSourceId, ThreadKind } from "../../src/routing/sourceId.js";

describe("sourceId codec", () => {
  it("encodes a user thread", () => {
    expect(encodeSourceId(ThreadKind.User, "84901234567")).toBe("user:84901234567");
  });

  it("encodes a group thread", () => {
    expect(encodeSourceId(ThreadKind.Group, "123456789")).toBe("group:123456789");
  });

  it("round-trips a user thread", () => {
    expect(decodeSourceId("user:84901234567")).toEqual({ kind: ThreadKind.User, threadId: "84901234567" });
  });

  it("round-trips a group thread", () => {
    expect(decodeSourceId("group:999")).toEqual({ kind: ThreadKind.Group, threadId: "999" });
  });

  it("throws on malformed source_id", () => {
    expect(() => decodeSourceId("nonsense")).toThrow(/source_id/);
    expect(() => decodeSourceId("user:")).toThrow(/source_id/);
  });

  it("encodes and decodes an OA user source id", () => {
    const sid = encodeSourceId(ThreadKind.OaUser, "u123");
    expect(sid).toBe("oa-user:u123");
    expect(decodeSourceId(sid)).toEqual({ kind: ThreadKind.OaUser, threadId: "u123" });
  });
});
