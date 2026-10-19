import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { SettingsRepo } from "../store/settingsRepo.js";

type Pre = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** The editable settings and whether each is a secret (masked on read). */
const FIELDS: Array<{ key: string; secret: boolean }> = [
  { key: "chatwoot_base_url", secret: false },
  { key: "chatwoot_account_id", secret: false },
  { key: "chatwoot_api_access_token", secret: true },
  { key: "zalo_oa_app_id", secret: false },
  { key: "zalo_oa_app_secret", secret: true },
  { key: "zalo_oa_secret_key", secret: true },
  { key: "zalo_oa_oauth_redirect", secret: false },
  { key: "alert_telegram_enabled", secret: false },
  { key: "alert_telegram_bot_token", secret: true },
  { key: "alert_telegram_chat_id", secret: false },
  { key: "alert_webhook_enabled", secret: false },
  { key: "alert_webhook_url", secret: false },
  { key: "alert_reconnecting_threshold_sec", secret: false },
  { key: "alert_cooldown_sec", secret: false },
];

export function registerSettingsRoutes(
  app: FastifyInstance,
  settings: Pick<SettingsRepo, "getAll" | "setMany">,
  guard: Pre,
  onApply: () => void,
  requireWrite: Pre = guard,
): void {
  app.get("/admin/api/settings", { preHandler: guard }, async () => {
    const all = await settings.getAll();
    const out: Record<string, unknown> = {};
    for (const f of FIELDS) {
      out[f.key] = f.secret ? { set: !!all[f.key] } : (all[f.key] ?? "");
    }
    return out;
  });

  app.post<{ Body: Record<string, string> }>("/admin/api/settings", { preHandler: requireWrite }, async (req, reply) => {
    const body = req.body ?? {};
    const entries: Array<{ key: string; value: string; isSecret: boolean }> = [];
    for (const f of FIELDS) {
      const v = body[f.key];
      if (typeof v !== "string" || v === "") continue; // empty/absent → keep existing value
      entries.push({ key: f.key, value: v, isSecret: f.secret });
    }
    if (entries.length) await settings.setMany(entries);
    reply.send({ ok: true, restarting: true });
    onApply();
  });
}
