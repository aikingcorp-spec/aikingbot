import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerSettingsRoutes } from "../../src/admin/settingsRoutes.js";

function build(getAll: () => Promise<Record<string, string>>) {
  const app = Fastify();
  const settings = { getAll: vi.fn(getAll), setMany: vi.fn(async () => {}) };
  const onApply = vi.fn();
  registerSettingsRoutes(app, settings as any, async () => {}, onApply);
  return { app, settings, onApply };
}

describe("settings routes", () => {
  it("GET masks secrets and returns plain non-secrets", async () => {
    const { app } = build(async () => ({
      chatwoot_base_url: "http://chatwoot:3000",
      chatwoot_account_id: "1",
      chatwoot_api_access_token: "tok",
    }));
    const res = await app.inject({ method: "GET", url: "/admin/api/settings" });
    expect(res.json()).toEqual({
      chatwoot_base_url: "http://chatwoot:3000",
      chatwoot_account_id: "1",
      chatwoot_api_access_token: { set: true },
      zalo_oa_app_id: "",
      zalo_oa_app_secret: { set: false },
      zalo_oa_secret_key: { set: false },
      zalo_oa_oauth_redirect: "",
      alert_telegram_enabled: "",
      alert_telegram_bot_token: { set: false },
      alert_telegram_chat_id: "",
      alert_webhook_enabled: "",
      alert_webhook_url: "",
      alert_reconnecting_threshold_sec: "",
      alert_cooldown_sec: "",
    });
  });

  it("POST persists provided fields, skips empty secret, triggers onApply", async () => {
    const { app, settings, onApply } = build(async () => ({}));
    const res = await app.inject({
      method: "POST", url: "/admin/api/settings",
      payload: {
        chatwoot_base_url: "http://chatwoot:3000",
        chatwoot_account_id: "2",
        chatwoot_api_access_token: "",
        zalo_oa_app_secret: "newsecret",
      },
    });
    expect(res.json()).toMatchObject({ ok: true, restarting: true });
    expect(settings.setMany).toHaveBeenCalledWith([
      { key: "chatwoot_base_url", value: "http://chatwoot:3000", isSecret: false },
      { key: "chatwoot_account_id", value: "2", isSecret: false },
      { key: "zalo_oa_app_secret", value: "newsecret", isSecret: true },
    ]);
    expect(onApply).toHaveBeenCalled();
  });
});
