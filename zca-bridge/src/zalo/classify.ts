export type MediaKind = "image" | "audio" | "video" | "file";

export type ClassifiedMessage =
  | { kind: "text"; text: string }
  | { kind: "media"; mediaType: MediaKind; href: string; filename: string; caption: string }
  | { kind: "fallback"; text: string };

export const MEDIA_LABEL: Record<MediaKind, string> = { image: "Ảnh", audio: "Ghi âm", video: "Video", file: "Tệp" };

function asObject(c: unknown): Record<string, any> {
  return c && typeof c === "object" ? (c as Record<string, any>) : {};
}

function parseParams(p: unknown): Record<string, any> {
  if (p && typeof p === "object") return p as Record<string, any>;
  if (typeof p === "string") { try { return JSON.parse(p); } catch { return {}; } }
  return {};
}

function nameFromUrl(href: string): string {
  return href.split("/").pop()?.split("?")[0] ?? "";
}

function ensureExt(name: string, ext: string): string {
  return /\.[A-Za-z0-9]+$/.test(name) ? name : `${name}.${ext}`;
}

function fetchable(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function media(href: string, mediaType: MediaKind, filename: string, caption: string): ClassifiedMessage {
  if (fetchable(href)) return { kind: "media", mediaType, href, filename, caption };
  return { kind: "fallback", text: `[${MEDIA_LABEL[mediaType]}]` };
}

export function classifyMessage(data: any): ClassifiedMessage {
  const msgType: string = typeof data?.msgType === "string" ? data.msgType : "";
  const content = data?.content;

  if (msgType === "webchat" || typeof content === "string") {
    return { kind: "text", text: typeof content === "string" ? content : "" };
  }

  const obj = asObject(content);
  const href = typeof obj.href === "string" ? obj.href : "";
  const title = typeof obj.title === "string" ? obj.title : "";
  const description = typeof obj.description === "string" ? obj.description : "";

  switch (msgType) {
    case "chat.photo":
    case "chat.gif":
    case "chat.doodle":
      return media(href, "image", title || nameFromUrl(href) || "image.jpg", "");
    case "chat.voice":
      return media(href, "audio", ensureExt(title || nameFromUrl(href) || "voice", "m4a"), "");
    case "chat.video.msg":
      return media(href, "video", ensureExt(title || nameFromUrl(href) || "video", "mp4"), description);
    case "share.file":
      return media(href, "file", title || nameFromUrl(href) || "file", "");
    case "chat.sticker":
      return { kind: "fallback", text: "[Sticker]" };
    case "chat.location.new": {
      const p = parseParams(obj.params);
      const lat = p.lat ?? p.latitude;
      const lon = p.lng ?? p.lon ?? p.longitude;
      if (lat != null && lon != null) {
        return { kind: "fallback", text: `📍 Vị trí: https://www.google.com/maps?q=${lat},${lon}` };
      }
      return { kind: "fallback", text: "📍 Vị trí" };
    }
    case "chat.recommended": {
      const p = parseParams(obj.params);
      const name = title || p.name || p.dName || "";
      const phone = p.phone || p.phoneNumber || "";
      const parts = [name, phone].filter(Boolean).join(" — ");
      return { kind: "fallback", text: parts ? `👤 Danh thiếp: ${parts}` : "👤 Danh thiếp" };
    }
    case "chat.link":
      return { kind: "fallback", text: href ? `🔗 ${title || href}\n${href}` : "🔗 Liên kết" };
    case "chat.todo": {
      const p = parseParams(obj.params);
      const todo = title || p.content || description || "";
      return { kind: "fallback", text: todo ? `☑️ Nhắc việc: ${todo}` : "☑️ Nhắc việc" };
    }
    default:
      return { kind: "fallback", text: `[Tin Zalo loại ${msgType || "không rõ"} — mở app để xem]` };
  }
}
