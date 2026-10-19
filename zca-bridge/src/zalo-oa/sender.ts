import { request } from "undici";
import { Sender, ZaloThreadKind, QuoteSource, ZaloFileRejectedError } from "../zalo/types.js";
import { buildMultipart } from "../chatwoot/multipart.js";
import { compressImageUnder } from "./imageCompress.js";

// Zalo OA Message API v3.0 requires a message-type sub-path; the bare /v3.0/oa/message
// returns 404 "empty or invalid API". `cs` = consultation (tư vấn): the free reply to a
// user who messaged the OA within the 7-day customer-service window.
const MESSAGE_URL = "https://openapi.zalo.me/v3.0/oa/message/cs";
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
// Images we can safely re-encode to shrink. GIF is excluded (re-encoding drops animation);
// an oversized GIF goes to the OutboundHandler link fallback instead.
const COMPRESSIBLE_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp"]);
// Compress before upload when the source exceeds this; also the compression target.
// Conservative margin under Zalo OA's ~1MB image cap.
const IMAGE_COMPRESS_THRESHOLD = 900_000;

function imageContentType(ext: string): string {
  return ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";
}

// A few common document content-types; Zalo's /upload/file infers most from the
// filename, so anything unrecognised falls back to a generic binary type.
const FILE_CONTENT_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
};

function fileContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return FILE_CONTENT_TYPE[ext] ?? "application/octet-stream";
}

// Transient: retrying the same send with backoff can succeed.
//   -32  rate limit ("reached limit call api", application or OA)
//   -100 attachment_id expired (re-uploaded on the next attempt)
const OA_RETRYABLE_CODES = new Set([-32, -100]);
// Cannot reach this user right now / outside the interaction window — retrying the same send won't help.
//   -213 not followed · -217 blocked invite · -227 banned/inactive >45d · -230 no interaction 7d
//   -232 interaction expired · -234 night (22h-6h) · -244 user restricted this message type
const OA_WINDOW_CODES = new Set([-213, -217, -227, -230, -232, -234, -244]);

export class OaWindowError extends Error {}

/** Zalo accepted the request but rejected it for a transient reason (rate limit, expired id). Retry. */
export class OaSendError extends Error {
  constructor(public readonly code: number, message: string) { super(message); }
}

/** Zalo permanently rejected the send (bad param/token/quota/policy, or an unknown code). Do NOT retry. */
export class OaPermanentError extends Error {
  constructor(public readonly code: number, message: string) { super(message); }
}

export class OaSender implements Sender {
  constructor(private getAccessToken: () => Promise<string>) {}

  async sendText(threadId: string, _kind: ZaloThreadKind, text: string, quote?: QuoteSource): Promise<{ msgId: string }> {
    const recipient = { user_id: threadId };
    const qid = quote?.msgId?.trim();
    if (!qid) return this.send({ recipient, message: { text } });
    try {
      return await this.send({ recipient, message: { text, quote_message_id: qid } });
    } catch (err) {
      // An invalid quote_message_id surfaces as a param rejection (OaPermanentError) or a transient
      // OaSendError — either way, drop the quote and deliver the reply unquoted (once). Window errors
      // and transport failures are not quote problems, so let them propagate.
      if (err instanceof OaSendError || err instanceof OaPermanentError) {
        return this.send({ recipient, message: { text } });
      }
      throw err;
    }
  }

  async sendAttachment(threadId: string, _kind: ZaloThreadKind, file: { filename: string; data: Buffer }, caption: string): Promise<{ msgId: string }> {
    const ext = file.filename.split(".").pop()?.toLowerCase() ?? "";
    // Zalo OA has two upload paths: images go through /upload/image (png/jpeg/gif/webp
    // only) and are sent as a media template; every other file type goes through
    // /upload/file and is sent as a `file` attachment. Routing a non-image through the
    // image endpoint returns "-201 file is invalid. We only support png and jpeg".
    return IMAGE_EXTS.has(ext)
      ? this.sendImage(threadId, file, caption, ext)
      : this.sendFile(threadId, file, caption);
  }

  private async sendImage(threadId: string, file: { filename: string; data: Buffer }, caption: string, ext: string): Promise<{ msgId: string }> {
    let data = file.data;
    let filename = file.filename;
    let contentType = imageContentType(ext);
    // Zalo OA refuses images over ~1MB. Shrink oversized re-encodable images first so the
    // customer still gets a real inline image. If compression can't reach the target, upload
    // the original — the upload will be rejected and OutboundHandler's link fallback takes over.
    if (COMPRESSIBLE_IMAGE_EXTS.has(ext) && data.length > IMAGE_COMPRESS_THRESHOLD) {
      const out = await compressImageUnder(data, IMAGE_COMPRESS_THRESHOLD);
      if (out) {
        data = out.data;
        contentType = imageContentType(out.ext);
        // Keep the multipart filename extension in sync with the re-encoded format
        // (e.g. a no-alpha PNG becomes JPEG) so it agrees with the Content-Type.
        filename = /\.[^.]+$/.test(file.filename)
          ? file.filename.replace(/\.[^.]+$/, `.${out.ext}`)
          : `${file.filename}.${out.ext}`;
      }
    }
    const attachmentId = await this.upload("https://openapi.zalo.me/v2.0/oa/upload/image", filename, contentType, data, "attachment_id", "OA upload failed");
    return this.send({
      recipient: { user_id: threadId },
      message: { text: caption || undefined, attachment: { type: "template", payload: { template_type: "media", elements: [{ media_type: "image", attachment_id: attachmentId }] } } },
    });
  }

  private async sendFile(threadId: string, file: { filename: string; data: Buffer }, caption: string): Promise<{ msgId: string }> {
    const token = await this.upload("https://openapi.zalo.me/v2.0/oa/upload/file", file.filename, fileContentType(file.filename), file.data, "token", "OA file upload failed");
    return this.send({
      recipient: { user_id: threadId },
      message: { text: caption || undefined, attachment: { type: "file", payload: { token } } },
    });
  }

  // Upload one multipart file and return the identifier Zalo issues for it
  // (`attachment_id` for images, `token` for files).
  private async upload(url: string, filename: string, contentType: string, data: Buffer, idField: "attachment_id" | "token", errLabel: string): Promise<string> {
    const accessToken = await this.getAccessToken();
    const { body, contentType: multipartContentType } = buildMultipart(
      {},
      [{ name: "file", filename, contentType, content: data }],
    );
    const res = await request(url, {
      method: "POST",
      headers: { access_token: accessToken, "content-type": multipartContentType, "content-length": String(body.length) },
      body,
    });
    const json = (await res.body.json()) as any;
    const id = json?.data?.[idField];
    if (!id) throw new ZaloFileRejectedError(filename, `${errLabel}: ${json?.error} ${json?.message ?? ""}`.trim());
    return String(id);
  }

  private async send(payload: unknown): Promise<{ msgId: string }> {
    const token = await this.getAccessToken();
    const res = await request(MESSAGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", access_token: token },
      body: JSON.stringify(payload),
    });
    const json = (await res.body.json()) as any;
    const code = Number(json?.error ?? -1);
    if (code === 0) return { msgId: String(json?.data?.message_id ?? "") };
    const detail = `OA send failed: ${code} ${json?.message ?? ""}`.trim();
    if (OA_RETRYABLE_CODES.has(code)) throw new OaSendError(code, detail);
    if (OA_WINDOW_CODES.has(code)) throw new OaWindowError(detail);
    throw new OaPermanentError(code, detail);
  }
}
