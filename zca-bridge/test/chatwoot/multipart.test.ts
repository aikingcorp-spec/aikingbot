import { describe, it, expect } from "vitest";
import { buildMultipart } from "../../src/chatwoot/multipart.js";

describe("buildMultipart", () => {
  it("builds a multipart body with a boundary, fields, and file parts", () => {
    const { body, contentType } = buildMultipart(
      { content: "hello", message_type: "outgoing" },
      [{ name: "attachments[]", filename: "a.jpg", contentType: "image/jpeg", content: Buffer.from([1, 2, 3]) }],
    );
    const m = contentType.match(/^multipart\/form-data; boundary=(.+)$/);
    expect(m).toBeTruthy();
    const boundary = m![1];
    const s = body.toString("latin1");
    expect(s).toContain(`--${boundary}\r\n`);
    expect(s).toContain('Content-Disposition: form-data; name="content"\r\n\r\nhello\r\n');
    expect(s).toContain('Content-Disposition: form-data; name="message_type"\r\n\r\noutgoing\r\n');
    expect(s).toContain('name="attachments[]"; filename="a.jpg"');
    expect(s).toContain("Content-Type: image/jpeg\r\n\r\n");
    expect(s.endsWith(`--${boundary}--\r\n`)).toBe(true);
    // raw file bytes present
    expect(body.includes(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it("produces a unique boundary per call", () => {
    const a = buildMultipart({}, []);
    const b = buildMultipart({}, []);
    expect(a.contentType).not.toEqual(b.contentType);
  });
});
