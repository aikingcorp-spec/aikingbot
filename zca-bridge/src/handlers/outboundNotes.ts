import type { OutgoingEvent } from "../chatwoot/webhookServer.js";

/** Filename portion of a Chatwoot attachment data_url (strips any query string). */
export function nameFromUrl(url: string): string {
  return url.split("/").pop()?.split("?")[0] || "tệp";
}

function snippet(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

/**
 * Identify which agent message a note refers to. A dead-letter note can appear in the
 * Chatwoot timeline long after — and far from — the original message (retries span up to
 * ~1.5h), so the note must carry its own reference: attachment filenames, else a content
 * snippet, plus the Chatwoot message id for admin/log correlation.
 */
export function messageRef(evt: OutgoingEvent): string {
  const files = evt.attachments.map((a) => nameFromUrl(a.dataUrl)).filter(Boolean);
  const ref = files.length
    ? `tệp ${files.map((f) => `«${f}»`).join(", ")}`
    : evt.content && evt.content.trim()
      ? `nội dung "${snippet(evt.content)}"`
      : "tin nhắn";
  return `${ref} (#${evt.chatwootMessageId})`;
}

/** Underlying failure reason, surfaced verbatim into the (agent-only) private note for debugging. */
export function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const noSessionNote = (evt: OutgoingEvent): string =>
  `⚠️ Tài khoản Zalo đang mất kết nối — chưa gửi được ${messageRef(evt)}. Hãy kết nối lại Zalo rồi gửi lại.`;

// These two already name the specific file, so they only need the message-id for correlation
// (not the full messageRef, which would repeat the filename).
export const downloadFailedNote = (evt: OutgoingEvent, name: string): string =>
  `⚠️ Không tải được tệp đính kèm «${name}» (#${evt.chatwootMessageId}) từ Chatwoot để gửi sang Zalo.`;

export const fileRejectedNote = (evt: OutgoingEvent, name: string, error: unknown): string =>
  `⚠️ Không gửi được tệp «${name}» (#${evt.chatwootMessageId}) sang Zalo.\nLý do: ${errorReason(error)}`;

export const linkSentNote = (name: string): string =>
  `ℹ️ Tệp «${name}» vượt giới hạn dung lượng Zalo OA — đã gửi link tải cho khách thay vì gửi trực tiếp.`;

// Covers the whole window/cannot-reach-user family (out-of-window, not-followed, blocked, banned,
// night, restricted); the verbatim Zalo reason (when provided) says which.
export const windowNote = (evt: OutgoingEvent, error?: unknown): string =>
  `⚠️ Không gửi được ${messageRef(evt)} sang Zalo OA — chưa thể nhắn cho người dùng này lúc này.` +
  (error ? `\nLý do: ${errorReason(error)}` : "");

export const permanentSendNote = (evt: OutgoingEvent, error: unknown): string =>
  `⚠️ Không gửi được ${messageRef(evt)} sang Zalo.\nLý do: ${errorReason(error)}`;

export const deadLetterNote = (evt: OutgoingEvent, error: unknown): string =>
  `⚠️ Không gửi được ${messageRef(evt)} sang Zalo (đã thử lại nhiều lần).\nLý do: ${errorReason(error)}`;
