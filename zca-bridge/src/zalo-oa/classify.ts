import { ClassifiedMessage, MediaKind } from "../zalo/classify.js";
import { IncomingMessage, ZaloThreadKind, QuoteSource } from "../zalo/types.js";

interface OaAttachment { type?: string; payload?: any }
interface OaEvent {
  event_name?: string;
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: string | number;
  message?: { msg_id?: string; text?: string; quote_msg_id?: string; attachments?: OaAttachment[] };
}

function fetchable(href: string): boolean { return /^https?:\/\//i.test(href); }

function mediaOf(type: MediaKind, href: string, filename: string, caption: string): ClassifiedMessage {
  if (fetchable(href)) return { kind: "media", mediaType: type, href, filename, caption };
  return { kind: "fallback", text: `[${type}]` };
}

function classifyContent(eventName: string, message: OaEvent["message"]): ClassifiedMessage {
  const text = typeof message?.text === "string" ? message.text : "";
  const att = message?.attachments?.[0];
  const url = typeof att?.payload?.url === "string" ? att.payload.url : "";
  switch (eventName) {
    case "user_send_text":
    case "user_send_link":
    case "oa_send_text":
      return { kind: "text", text: text || (url ? url : "") };
    case "user_send_image":
    case "user_send_gif":
    case "user_send_sticker":
    case "oa_send_image":
      return mediaOf("image", url, url.split("/").pop()?.split("?")[0] || "image.jpg", text);
    case "user_send_audio":
      return mediaOf("audio", url, "audio.m4a", "");
    case "user_send_video":
      return mediaOf("video", url, "video.mp4", text);
    case "user_send_file":
    case "oa_send_file":
      return mediaOf("file", url, att?.payload?.name || url.split("/").pop()?.split("?")[0] || "file", "");
    case "user_send_location": {
      const c = att?.payload?.coordinates ?? {};
      const lat = c.latitude, lon = c.longitude;
      if (lat != null && lon != null) return { kind: "fallback", text: `📍 Vị trí: https://www.google.com/maps?q=${lat},${lon}` };
      return { kind: "fallback", text: "📍 Vị trí" };
    }
    default:
      return { kind: "fallback", text: `[Tin OA loại ${eventName || "không rõ"} — mở app để xem]` };
  }
}

export function classifyOaMessage(event: OaEvent, isSelf: boolean): IncomingMessage {
  const eventName = String(event.event_name ?? "");
  // The conversation thread is always the *user*: their id is the sender on inbound,
  // and the recipient on oa_send_* (OA-side) events.
  const userId = isSelf ? String(event.recipient?.id ?? "") : String(event.sender?.id ?? "");
  const msgId = String(event.message?.msg_id ?? "");
  const classified = classifyContent(eventName, event.message);
  const text = classified.kind === "media" ? classified.caption : classified.text;
  const quoteSrc: QuoteSource = {
    uidFrom: userId, msgId, cliMsgId: "", msgType: eventName, ts: String(event.timestamp ?? ""),
    content: event.message?.text ?? "", ttl: 0,
  };
  // When the user replies quoting another message, Zalo includes quote_msg_id (the OA msg id
  // of the quoted message). Surfacing it lets InboundHandler route the reply through the
  // Application API with in_reply_to, so Chatwoot shows the quoted context (parity with personal).
  const quotedMsgId = event.message?.quote_msg_id;
  return {
    kind: ZaloThreadKind.OaUser,
    threadId: userId,
    msgId,
    senderUid: userId,
    senderName: "",
    text,
    classified,
    isSelf,
    quoteSrc,
    ...(quotedMsgId ? { quoteMsgId: String(quotedMsgId) } : {}),
  };
}
