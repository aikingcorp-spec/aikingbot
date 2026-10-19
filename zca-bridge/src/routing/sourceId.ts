export enum ThreadKind {
  User = "user",
  Group = "group",
  OaUser = "oa-user",
}

export interface DecodedThread {
  kind: ThreadKind;
  threadId: string;
}

export function encodeSourceId(kind: ThreadKind, threadId: string): string {
  if (!threadId) throw new Error("threadId is required to encode source_id");
  return `${kind}:${threadId}`;
}

export function decodeSourceId(sourceId: string): DecodedThread {
  const match = /^(oa-user|user|group):(.+)$/.exec(sourceId ?? "");
  if (!match) throw new Error(`Invalid Zalo source_id: ${sourceId}`);
  return { kind: match[1] as ThreadKind, threadId: match[2] };
}
