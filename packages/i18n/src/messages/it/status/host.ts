import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Questo AIKINGBOT è stato registrato per l'accesso WebRTC.",
  "status.host.identityUpdated": "Identità del server aggiornata.",
  "status.host.starting": "Avvio dell'host WebRTC…",
  "status.host.ready": "Questo AIKINGBOT è pronto per le connessioni WebRTC.",
  "status.host.stopping": "Questo AIKINGBOT sta diventando privato…",
  "status.host.private": "Questo AIKINGBOT è privato.",
} as const satisfies PartialTranslation<typeof source>;
