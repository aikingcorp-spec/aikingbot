import { describe, it, expect } from "vitest";
import { parseRecord, buildContext } from "../../src/logging/dbLogStream.js";

const line = (o: Record<string, unknown>) => JSON.stringify(o);

describe("parseRecord filter", () => {
  it("drops an info record with no event", () => {
    expect(parseRecord(line({ level: 30, time: 1, msg: "req" }))).toBeNull();
  });
  it("keeps an info record that carries an event", () => {
    const r = parseRecord(line({ level: 30, time: 1700000000000, msg: "relayed", event: "inbound_relayed", accountId: 3 }));
    expect(r).toMatchObject({ level: 30, event: "inbound_relayed", accountId: 3, msg: "relayed" });
    expect(r!.ts.toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });
  it("keeps a warn record without an event", () => {
    expect(parseRecord(line({ level: 40, time: 1, msg: "warn" }))?.event).toBeNull();
  });
  it("keeps an error record", () => {
    expect(parseRecord(line({ level: 50, time: 1, msg: "err" }))?.level).toBe(50);
  });
  it("returns null on malformed JSON", () => {
    expect(parseRecord("{not json")).toBeNull();
  });
  it("reads account_id alias and numeric-string account ids", () => {
    expect(parseRecord(line({ level: 50, time: 1, msg: "x", account_id: 7 }))?.accountId).toBe(7);
    expect(parseRecord(line({ level: 50, time: 1, msg: "x", accountId: "9" }))?.accountId).toBe(9);
    expect(parseRecord(line({ level: 50, time: 1, msg: "x" }))?.accountId).toBeNull();
  });
});

describe("buildContext redaction", () => {
  it("redacts sensitive keys and keeps the rest", () => {
    const ctx = buildContext({
      level: 50, time: 1, msg: "m", pid: 1, hostname: "h", event: "e", accountId: 3,
      access_token: "AAA", mac: "deadbeef", appSecret: "s", reqId: "r1", oaId: "12",
    });
    expect(ctx).toEqual({ access_token: "[redacted]", mac: "[redacted]", appSecret: "[redacted]", reqId: "r1", oaId: "12" });
  });

  it("redacts sensitive keys nested in objects", () => {
    expect(buildContext({ nested: { access_token: "XYZ", ok: 1 } })).toEqual({ nested: { access_token: "[redacted]", ok: 1 } });
  });

  it("redacts sensitive keys inside arrays of objects", () => {
    expect(buildContext({ items: [{ token: "T" }, "plain"] })).toEqual({ items: [{ token: "[redacted]" }, "plain"] });
  });

  it("omits stack traces and keeps the rest of a serialized error", () => {
    expect(buildContext({ err: { type: "Error", message: "boom", stack: "at foo (x.js:1)" } }))
      .toEqual({ err: { type: "Error", message: "boom", stack: "[omitted]" } });
  });

  it("caps recursion depth so pathological objects cannot hang the sink", () => {
    const deep = { a: { b: { c: { d: { e: "too deep" } } } } };
    const out = buildContext({ deep }) as any;
    // 4 levels are walked; beyond MAX_REDACT_DEPTH the value is replaced.
    expect(out.deep.a.b.c.d).toBe("[depth-limited]");
  });
});
