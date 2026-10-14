import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "AIKINGBOT Yerel Ana Makine",
  "window.localClientTitle": "AIKINGBOT Yerel İstemci",
  "window.computerUsePermissionTitle": "Bilgisayar Kullanımını Aç",
} as const satisfies PartialTranslation<typeof source>;
