import { request } from "undici";
import type { AlertEvent, AlertNotifier } from "./types.js";

export class TelegramNotifier implements AlertNotifier {
  readonly channel = "telegram" as const;
  constructor(private botToken: string, private chatId: string) {}

  async send(alert: AlertEvent): Promise<void> {
    const text = alert.detail ? `${alert.title}\n${alert.detail}` : alert.title;
    const res = await request(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.chatId, text }),
    });
    if (res.statusCode >= 400) { res.body.dump(); throw new Error(`telegram sendMessage failed: ${res.statusCode}`); }
    res.body.dump();
  }
}
