import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Dieser AIKINGBOT wurde für den WebRTC-Zugriff registriert.",
  "status.host.identityUpdated": "Serveridentität aktualisiert.",
  "status.host.starting": "WebRTC-Host wird gestartet…",
  "status.host.ready": "Dieser AIKINGBOT ist für WebRTC-Verbindungen bereit.",
  "status.host.stopping": "Dieser AIKINGBOT wird auf privat gesetzt…",
  "status.host.private": "Dieser AIKINGBOT ist privat.",
} as const satisfies PartialTranslation<typeof source>;
