import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Zarejestrowano ten AIKINGBOT do dostępu przez WebRTC.",
  "status.host.identityUpdated": "Zaktualizowano tożsamość serwera.",
  "status.host.starting": "Uruchamianie hosta WebRTC…",
  "status.host.ready": "Ten AIKINGBOT jest gotowy na połączenia WebRTC.",
  "status.host.stopping": "Ustawianie tego AIKINGBOTa jako prywatnego…",
  "status.host.private": "Ten AIKINGBOT jest prywatny.",
} as const satisfies PartialTranslation<typeof source>;
