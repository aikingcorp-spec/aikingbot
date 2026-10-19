import { IncomingMessage, ZaloThreadKind } from "../zalo/types.js";
import { ClassifiedMessage } from "../zalo/classify.js";

const IMAGE_TYPES = new Set(["photo", "image", "gif", "sticker"]);
const FILE_TYPES = new Set(["file", "doc"]);

function fetchable(href: string): boolean { return /^https?:\/\//i.test(href); }

function classify(type: string, text: string, url: string): ClassifiedMessage {
  if (IMAGE_TYPES.has(type) && fetchable(url)) {
    return { kind: "media", mediaType: "image", href: url, filename: url.split("/").pop()?.split("?")[0] || "image.jpg", caption: text };
  }
  if (FILE_TYPES.has(type) && fetchable(url)) {
    return { kind: "media", mediaType: "file", href: url, filename: url.split("/").pop()?.split("?")[0] || "file", caption: "" };
  }
  if (text) return { kind: "text", text };
  return { kind: "fallback", text: `[${type || "tin"}]` };
}

/**
 * Convert one raw conversation-API message into an IncomingMessage. Defensive about field
 * names (the Zalo history shape is not fully documented). Returns null when the message has
 * no id (cannot be deduped/relayed safely).
 */
export function toIncomingMessage(raw: unknown, userId: string): { msg: IncomingMessage; timeMs: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const msgId = String(r.message_id ?? r.msg_id ?? "");
  if (!msgId) return null;
  const timeMs = Number(r.time ?? r.timestamp ?? 0);
  const isSelf = Number(r.src) === 0;
  const type = String(r.type ?? "text");
  const text = typeof r.message === "string" ? r.message : (typeof r.text === "string" ? r.text : "");
  const url = typeof r.url === "string" ? r.url : (typeof r.href === "string" ? r.href : "");
  const classified = classify(type, text, url);
  const body = classified.kind === "media" ? classified.caption : (classified.kind === "text" ? classified.text : text);
  const msg: IncomingMessage = {
    kind: ZaloThreadKind.OaUser,
    threadId: userId,
    msgId,
    senderUid: userId,
    senderName: "",
    text: body,
    classified,
    isSelf,
    quoteSrc: { uidFrom: userId, msgId, cliMsgId: "", msgType: type, ts: String(timeMs), content: text, ttl: 0 },
  };
  return { msg, timeMs };
}
