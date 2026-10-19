import { request } from "undici";

export interface RecentChat { userId: string; lastTimeMs: number }

// These OA conversation-read endpoints live under v2.0 (confirmed against the official Zalo
// PHP/.NET SDKs). v3.0 only hosts the message-send/user-detail APIs — calling v3.0 here returns
// Zalo error 404 "You are accessing an empty or invalid API".
const LIST_URL = "https://openapi.zalo.me/v2.0/oa/listrecentchat";
const CONV_URL = "https://openapi.zalo.me/v2.0/oa/conversation";

function encodeData(obj: unknown): string {
  return encodeURIComponent(JSON.stringify(obj));
}

async function getJson(url: string, getToken: () => Promise<string>): Promise<any> {
  const token = await getToken();
  const res = await request(url, { method: "GET", headers: { access_token: token } });
  const json = (await res.body.json()) as any;
  const code = Number(json?.error ?? 0);
  if (code !== 0) throw new Error(`Zalo history failed: ${code} ${json?.message ?? ""}`.trim());
  return json;
}

/** List recent conversations. Each entry's user party is the id that is not the OA. */
export async function listRecentChat(
  getToken: () => Promise<string>,
  oaId: string,
  offset: number,
  count: number,
): Promise<RecentChat[]> {
  const json = await getJson(`${LIST_URL}?data=${encodeData({ offset, count })}`, getToken);
  const rows: any[] = Array.isArray(json?.data) ? json.data : [];
  return rows
    .map((r) => {
      const from = String(r?.from_id ?? "");
      const to = String(r?.to_id ?? "");
      const userId = from && from !== oaId ? from : to;
      return { userId, lastTimeMs: Number(r?.time ?? 0) };
    })
    .filter((r) => r.userId);
}

/** Raw messages of one conversation (newest first). Parsed by backfillMessage. */
export async function getConversationMessages(
  getToken: () => Promise<string>,
  userId: string,
  offset: number,
  count: number,
): Promise<unknown[]> {
  const json = await getJson(`${CONV_URL}?data=${encodeData({ user_id: userId, offset, count })}`, getToken);
  return Array.isArray(json?.data) ? json.data : [];
}
