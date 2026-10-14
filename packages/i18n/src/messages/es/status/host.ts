import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Se registró este AIKINGBOT para el acceso WebRTC.",
  "status.host.identityUpdated": "Identidad del servidor actualizada.",
  "status.host.starting": "Iniciando el host WebRTC…",
  "status.host.ready": "Este AIKINGBOT está listo para conexiones WebRTC.",
  "status.host.stopping": "Haciendo privado este AIKINGBOT…",
  "status.host.private": "Este AIKINGBOT es privado.",
} as const satisfies PartialTranslation<typeof source>;
