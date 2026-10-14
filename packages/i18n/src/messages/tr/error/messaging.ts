import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  // Errors of a Slack workspace connection, which the host sends.
  "error.messaging.notConnected": "Bu Slack çalışma alanı bağlı değil.",
  "error.messaging.unsupported": "Bu bilgisayar Slack'e bağlanamıyor.",
  "error.messaging.relayUnavailable":
    "AIKINGBOT bu bilgisayarda Slack etkinliklerini alamıyor. Oturum açın, bu bilgisayara bir ad verin ve tekrar deneyin.",
  // Bir Discord sunucusu bağlantısının ana makinenin gönderdiği hataları.
  "error.messaging.discordNotConnected": "Bu Discord sunucusu bağlı değil.",
  "error.messaging.discordUnsupported": "Bu bilgisayar Discord'a bağlanamıyor.",
  "error.messaging.discordRelayUnavailable":
    "AIKINGBOT bu bilgisayarda Discord etkinliklerini alamıyor. Oturum açın, bu bilgisayara bir ad verin ve tekrar deneyin.",
  "error.messaging.telegramNotConnected": "Bu Telegram sohbeti bağlı değil.",
  "error.messaging.telegramUnsupported": "Bu bilgisayar Telegram'a bağlanamıyor.",
  "error.messaging.telegramRelayUnavailable":
    "AIKINGBOT bu bilgisayarda Telegram'a ulaşamıyor. Oturum açın, bu bilgisayara bir ad verin ve tekrar deneyin.",
  "error.messaging.memoryLimit": "Bağlı bir çalışma alanı en fazla {limit} belleğe sahip olabilir. Önce birini silin.",
} as const satisfies PartialTranslation<typeof source>;
