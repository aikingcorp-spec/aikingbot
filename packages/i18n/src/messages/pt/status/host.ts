import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Este AIKINGBOT foi registrado para acesso por WebRTC.",
  "status.host.identityUpdated": "Identidade do servidor atualizada.",
  "status.host.starting": "Iniciando o computador anfitrião WebRTC…",
  "status.host.ready": "Este AIKINGBOT está pronto para conexões WebRTC.",
  "status.host.stopping": "Tornando este AIKINGBOT privado…",
  "status.host.private": "Este AIKINGBOT é privado.",
} as const satisfies PartialTranslation<typeof source>;
