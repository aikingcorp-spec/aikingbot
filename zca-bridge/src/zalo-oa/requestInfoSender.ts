import { request } from "undici";

export interface InfoCard {
  title: string;
  subtitle: string;
  imageUrl: string;
}

export interface InfoSendResult {
  ok: boolean;
  code: number;
  message: string;
}

// Same CS (tư vấn) endpoint used for text replies; request_user_info is a CS template.
const MESSAGE_URL = "https://openapi.zalo.me/v3.0/oa/message/cs";

export function buildRequestUserInfoPayload(userId: string, card: InfoCard): unknown {
  return {
    recipient: { user_id: userId },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "request_user_info",
          elements: [{ title: card.title, subtitle: card.subtitle, image_url: card.imageUrl }],
        },
      },
    },
  };
}

/**
 * Send the request_user_info card. Returns the Zalo result (never throws on a Zalo-level
 * error code, so the caller can distinguish "asked, Zalo refused" from a network failure,
 * which still throws).
 */
export async function sendRequestUserInfo(
  getAccessToken: () => Promise<string>,
  userId: string,
  card: InfoCard,
): Promise<InfoSendResult> {
  const token = await getAccessToken();
  const res = await request(MESSAGE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", access_token: token },
    body: JSON.stringify(buildRequestUserInfoPayload(userId, card)),
  });
  const json = (await res.body.json()) as any;
  const code = Number(json?.error ?? -1);
  return { ok: code === 0, code, message: String(json?.message ?? "") };
}
