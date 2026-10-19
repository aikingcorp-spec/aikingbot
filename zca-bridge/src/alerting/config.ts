import type { AlertNotifier } from "./types.js";
import { TelegramNotifier } from "./telegramNotifier.js";
import { WebhookNotifier } from "./webhookNotifier.js";

export interface AlertConfig {
  telegram: { enabled: boolean; botToken?: string; chatId?: string };
  webhook: { enabled: boolean; url?: string };
  reconnectingThresholdMs: number;
  cooldownMs: number;
}

interface SettingsSource { getAll(): Promise<Record<string, string>>; }

export async function loadAlertConfig(settings: SettingsSource): Promise<AlertConfig> {
  let db: Record<string, string> = {};
  try { db = await settings.getAll(); } catch { db = {}; }
  const sec = (key: string, def: number): number => {
    const v = Number(db[key]);
    return Number.isFinite(v) && v > 0 ? v * 1000 : def * 1000;
  };
  return {
    telegram: {
      enabled: db["alert_telegram_enabled"] === "true",
      botToken: db["alert_telegram_bot_token"] || undefined,
      chatId: db["alert_telegram_chat_id"] || undefined,
    },
    webhook: {
      enabled: db["alert_webhook_enabled"] === "true",
      url: db["alert_webhook_url"] || undefined,
    },
    reconnectingThresholdMs: sec("alert_reconnecting_threshold_sec", 300),
    cooldownMs: sec("alert_cooldown_sec", 600),
  };
}

export function buildNotifiers(config: AlertConfig): AlertNotifier[] {
  const out: AlertNotifier[] = [];
  if (config.telegram.enabled && config.telegram.botToken && config.telegram.chatId) {
    out.push(new TelegramNotifier(config.telegram.botToken, config.telegram.chatId));
  }
  if (config.webhook.enabled && config.webhook.url) {
    out.push(new WebhookNotifier(config.webhook.url));
  }
  return out;
}
