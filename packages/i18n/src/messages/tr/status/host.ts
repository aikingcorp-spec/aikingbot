import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Bu AIKINGBOT, WebRTC erişimi için kaydedildi.",
  "status.host.identityUpdated": "Sunucu kimliği güncellendi.",
  "status.host.starting": "WebRTC ana makinesi başlatılıyor…",
  "status.host.ready": "Bu AIKINGBOT, WebRTC bağlantıları için hazır.",
  "status.host.stopping": "Bu AIKINGBOT gizli yapılıyor…",
  "status.host.private": "Bu AIKINGBOT gizli.",
} as const satisfies PartialTranslation<typeof source>;
