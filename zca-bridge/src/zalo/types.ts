import { classifyMessage, ClassifiedMessage } from "./classify.js";
import { ThreadKind } from "../routing/sourceId.js";

export enum ZaloThreadKind { User = "user", Group = "group", OaUser = "oa-user" }

/** Single source of truth for ZaloThreadKind → routing ThreadKind. */
export function toRoutingKindOf(kind: ZaloThreadKind): ThreadKind {
  if (kind === ZaloThreadKind.Group) return ThreadKind.Group;
  if (kind === ZaloThreadKind.OaUser) return ThreadKind.OaUser;
  return ThreadKind.User;
}

// Everything zca-js needs to send this message back as a quoted reply later (Chatwoot → Zalo).
export interface QuoteSource {
  uidFrom: string;
  msgId: string;
  cliMsgId: string;
  msgType: string;
  ts: string;
  content: unknown;
  ttl: number;
}

/** Zalo refused a file (unsupported type / invalid / too large). Permanent — must not be retried. */
export class ZaloFileRejectedError extends Error {
  constructor(public readonly filename: string, message: string) { super(message); }
}

/** Transport-agnostic outbound sender. ZcaAdapter (personal) and OaSender (OA) implement it. */
export interface Sender {
  sendText(threadId: string, kind: ZaloThreadKind, text: string, quote?: QuoteSource): Promise<{ msgId: string }>;
  sendAttachment(threadId: string, kind: ZaloThreadKind, file: { filename: string; data: Buffer }, caption: string): Promise<{ msgId: string }>;
  sendAttachments?(threadId: string, kind: ZaloThreadKind, files: Array<{ filename: string; data: Buffer }>, caption: string): Promise<{ msgId: string }>;
  sendTyping?(threadId: string, kind: ZaloThreadKind): Promise<void>;
  sendReaction?(threadId: string, kind: ZaloThreadKind, msgId: string, cliMsgId: string, reaction: string): Promise<void>;
}

export interface IncomingMessage {
  kind: ZaloThreadKind;
  threadId: string;
  msgId: string;
  senderUid: string;
  senderName: string;
  text: string;                  // human-readable body (caption for media, text otherwise)
  classified: ClassifiedMessage; // drives rendering: text / media / fallback
  isSelf: boolean;
  quoteMsgId?: string;           // global id of the quoted message, when this is a reply
  quoteSrc: QuoteSource;         // fields to reconstruct a Zalo quote if this message is replied to
}

// A reaction (e.g. ❤️) the customer or operator placed on an existing message.
export interface ReactionEvent {
  kind: ZaloThreadKind;
  threadId: string;
  reactedMsgId: string;   // global id of the message being reacted to
  icon: string;           // raw zca-js Reactions code ("" = reaction removed)
  senderUid: string;
  senderName: string;
  isSelf: boolean;        // true when the logged-in (operator) account reacted
}

// A message recall ("thu hồi"). Only the operator's own recall is acted on (delete in Chatwoot).
export interface UndoEvent {
  kind: ZaloThreadKind;
  threadId: string;
  recalledMsgId: string;  // global id of the recalled message
  isSelf: boolean;
}

export interface UserProfile { uid: string; displayName: string; avatar?: string; phone?: string; }

export interface GroupProfile { groupId: string; name: string; avatar?: string; }

export interface ZaloCredentials { imei: string; cookie: unknown; userAgent: string; language?: string; }

export type QrEvent =
  | { type: "qr"; imageBase64: string }
  | { type: "scanned" }
  | { type: "loggedIn"; credentials: ZaloCredentials; uid: string }
  | { type: "expired" }
  | { type: "declined" };

/** Narrow interface the handlers depend on. zcaAdapter implements it. */
export interface ZaloApi {
  sendText(threadId: string, kind: ZaloThreadKind, text: string, quote?: QuoteSource): Promise<{ msgId: string }>;
  sendAttachment(threadId: string, kind: ZaloThreadKind, file: { filename: string; data: Buffer }, caption: string): Promise<{ msgId: string }>;
  sendAttachments?(threadId: string, kind: ZaloThreadKind, files: Array<{ filename: string; data: Buffer }>, caption: string): Promise<{ msgId: string }>;
  getUserInfo(uid: string): Promise<UserProfile>;
  getGroupInfo(groupId: string): Promise<GroupProfile>;
  onMessage(cb: (msg: IncomingMessage) => void): void;
  onReaction(cb: (evt: ReactionEvent) => void): void;
  onUndo(cb: (evt: UndoEvent) => void): void;
  onClosed(cb: (code: number, reason: string) => void): void;
  getSerializedCookie(): unknown;
  stop(): Promise<void>;
}

// zca-js: ThreadType.User = 0, ThreadType.Group = 1
export function toZcaThreadType(kind: ZaloThreadKind): number {
  return kind === ZaloThreadKind.Group ? 1 : 0;
}

export function normalizeIncoming(raw: any): IncomingMessage {
  const kind = raw.type === 1 ? ZaloThreadKind.Group : ZaloThreadKind.User;
  const data = raw.data ?? {};
  const classified = classifyMessage(data);
  const text = classified.kind === "media" ? classified.caption : classified.text;
  const quoteId = data.quote?.globalMsgId;
  return {
    kind,
    threadId: String(raw.threadId),
    msgId: String(data.msgId),
    senderUid: String(data.uidFrom ?? ""),
    senderName: String(data.dName ?? ""),
    text,
    classified,
    isSelf: raw.isSelf === true || data.uidFrom === "0",
    ...(quoteId != null ? { quoteMsgId: String(quoteId) } : {}),
    quoteSrc: {
      uidFrom: String(data.uidFrom ?? ""),
      msgId: String(data.msgId),
      cliMsgId: String(data.cliMsgId ?? ""),
      msgType: String(data.msgType ?? ""),
      ts: String(data.ts ?? ""),
      content: data.content,
      ttl: Number(data.ttl ?? 0),
    },
  };
}

function threadKindFrom(raw: any): ZaloThreadKind {
  return raw.isGroup === true || raw.type === 1 ? ZaloThreadKind.Group : ZaloThreadKind.User;
}

export function normalizeReaction(raw: any): ReactionEvent {
  const data = raw.data ?? {};
  const content = data.content ?? {};
  const reacted = Array.isArray(content.rMsg) ? content.rMsg[0] : undefined;
  return {
    kind: threadKindFrom(raw),
    threadId: String(raw.threadId),
    reactedMsgId: String(reacted?.gMsgID ?? ""),
    icon: typeof content.rIcon === "string" ? content.rIcon : "",
    senderUid: String(data.uidFrom ?? ""),
    senderName: String(data.dName ?? ""),
    isSelf: raw.isSelf === true || data.uidFrom === "0",
  };
}

export function normalizeUndo(raw: any): UndoEvent {
  const data = raw.data ?? {};
  const content = data.content ?? {};
  return {
    kind: threadKindFrom(raw),
    threadId: String(raw.threadId),
    recalledMsgId: String(content.globalMsgId ?? ""),
    isSelf: raw.isSelf === true || data.uidFrom === "0",
  };
}
