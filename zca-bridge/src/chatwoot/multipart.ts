import { randomBytes } from "node:crypto";

export interface MultipartFile {
  name: string; // form field name, e.g. "attachments[]"
  filename: string;
  contentType: string;
  content: Buffer;
}

/**
 * Build a multipart/form-data body as a single Buffer with a known boundary.
 *
 * undici streams a `FormData` instance with Transfer-Encoding: chunked (no
 * Content-Length), which Chatwoot's Rack/Puma stack rejects by closing the
 * connection ("other side closed"). Sending a pre-built Buffer lets the caller
 * set an explicit Content-Length, which Chatwoot accepts.
 */
export function buildMultipart(
  fields: Record<string, string>,
  files: MultipartFile[],
): { body: Buffer; contentType: string } {
  const boundary = "----zcaBridge" + randomBytes(16).toString("hex");
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ));
  }
  for (const f of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\n` +
      `Content-Type: ${f.contentType}\r\n\r\n`,
    ));
    chunks.push(f.content);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}
