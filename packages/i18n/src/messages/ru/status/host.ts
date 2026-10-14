import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Этот AIKINGBOT зарегистрирован для доступа через WebRTC.",
  "status.host.identityUpdated": "Идентификатор сервера обновлён.",
  "status.host.starting": "Запуск хоста WebRTC…",
  "status.host.ready": "Этот AIKINGBOT готов к подключениям WebRTC.",
  "status.host.stopping": "Делаю этот AIKINGBOT приватным…",
  "status.host.private": "Этот AIKINGBOT приватный.",
} as const satisfies PartialTranslation<typeof source>;
