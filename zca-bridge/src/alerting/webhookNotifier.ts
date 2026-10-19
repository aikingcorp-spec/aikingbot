import { request } from "undici";
import type { AlertEvent, AlertNotifier } from "./types.js";

export class WebhookNotifier implements AlertNotifier {
  readonly channel = "webhook" as const;
  constructor(private url: string) {}

  async send(alert: AlertEvent): Promise<void> {
    const res = await request(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: alert.kind, accountId: alert.accountId, title: alert.title, detail: alert.detail, ts: alert.ts }),
    });
    if (res.statusCode >= 400) { res.body.dump(); throw new Error(`webhook POST failed: ${res.statusCode}`); }
    res.body.dump();
  }
}
